import "server-only";
import { calculateCosts, type DomainState } from "@/lib/domain";
import { convertNativeMilli, isCurrency, type Currency, type FxQuote } from "@/lib/currency";
import { calculateProductionCosts, evaluableProfileProducts, productionProfileSchema } from "@/lib/production-profile";
import { dbBatch, dbQuery } from "./db";
import type { Principal } from "./auth";
import { officialFxTable, quotesFor } from "./fx";

type OrganizationRow = { id: string; name: string; currency: string; revision: number };
type MaterialRow = {
  id: string; name: string; supplier: string; purchase_unit: string; category: string; version: number;
  price_minor: number | null; source: string | null; effective_date: string | null;
  currency: string | null; native_amount_milli: number | null;
};
type ProductRow = {
  id: string; name: string; lot_units: number; sale_price_minor: number;
  sales_variable_minor: number; labor_lot_minor: number; production_hours_milli: number; batches_per_month_milli: number | null; version: number;
};
type ComponentRow = { product_id: string; material_id: string; quantity_milli: number };
type ExpenseRow = {
  id: string; name: string; period: string; amount_minor: number;
  allocation_basis: "hours" | "units"; allocation_mode: "automatic" | "manual"; allocation_shares_json: string; category: string; version: number;
  currency: string | null; native_amount_milli: number | null;
};
type CategoryRow = { id: string; name: string };

export async function ensureOrganization(principal: Principal): Promise<void> {
  await dbBatch([
    { sql: "INSERT OR IGNORE INTO organizations (id) VALUES (?)", params: [principal.organizationId] },
    { sql: "INSERT INTO memberships (organization_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT (organization_id, user_id) DO UPDATE SET role=excluded.role", params: [principal.organizationId, principal.userId, principal.role] },
    { sql: "INSERT OR IGNORE INTO cost_categories (id, organization_id, name) SELECT ?, ?, 'Materia prima' WHERE NOT EXISTS (SELECT 1 FROM cost_categories WHERE organization_id=?) UNION ALL SELECT ?, ?, 'Gastos generales' WHERE NOT EXISTS (SELECT 1 FROM cost_categories WHERE organization_id=?)", params: [crypto.randomUUID(), principal.organizationId, principal.organizationId, crypto.randomUUID(), principal.organizationId, principal.organizationId] },
  ], { retrySafe: true }); // Idempotent upserts.
}

export async function loadState(principal: Principal): Promise<DomainState> {
  await ensureOrganization(principal);
  return loadStateForOrganization(principal.organizationId);
}

export async function loadStateForOrganization(org: string): Promise<DomainState> {
  const [organizations, materials, products, components, expenses, categories] = await dbBatch<OrganizationRow | MaterialRow | ProductRow | ComponentRow | ExpenseRow | CategoryRow>([
    { sql: "SELECT id, name, currency, revision FROM organizations WHERE id=?", params: [org] },
    { sql: "SELECT m.id, m.name, m.supplier, m.purchase_unit, m.category, m.version, p.amount_minor AS price_minor, p.source, p.effective_date, p.currency, p.native_amount_milli FROM materials m LEFT JOIN material_prices p ON p.material_id=m.id AND p.version=m.version WHERE m.organization_id=? AND m.archived_at IS NULL ORDER BY m.name", params: [org] },
    { sql: "SELECT id, name, lot_units, sale_price_minor, sales_variable_minor, labor_lot_minor, production_hours_milli, batches_per_month_milli, version FROM products WHERE organization_id=? AND archived_at IS NULL ORDER BY name", params: [org] },
    { sql: "SELECT pm.product_id, pm.material_id, pm.quantity_milli FROM product_materials pm JOIN products p ON p.id=pm.product_id JOIN materials m ON m.id=pm.material_id WHERE p.organization_id=? AND p.archived_at IS NULL AND m.archived_at IS NULL", params: [org] },
    { sql: "SELECT id, name, period, amount_minor, allocation_basis, allocation_mode, allocation_shares_json, category, version, currency, native_amount_milli FROM shared_expenses WHERE organization_id=? ORDER BY name", params: [org] },
    { sql: "SELECT id, name FROM cost_categories WHERE organization_id=? ORDER BY name", params: [org] },
  ]);
  const organization = organizations[0] as OrganizationRow | undefined;
  if (!organization) throw new Error("Organization was not provisioned");
  const base: Currency = isCurrency(organization.currency) ? organization.currency : "CLP";
  let fxQuotes: Partial<Record<Currency, FxQuote>> = {};
  try { fxQuotes = quotesFor(base, await officialFxTable()); } catch (error) { console.error("FX lookup failed", error); }
  const normalize = (amountMilli: number, currency: Currency) => currency === base ? Math.round(amountMilli / 1000) : fxQuotes[currency] ? convertNativeMilli(amountMilli, fxQuotes[currency]) : null;
  return {
    revision: organization.revision,
    activePeriod: (expenses as ExpenseRow[]).map((row) => row.period).sort().at(-1) ?? new Date().toISOString().slice(0, 7),
    organization: { id: organization.id, name: organization.name, currency: base },
    fxQuotes,
    categories: categories as CategoryRow[],
    materials: (materials as MaterialRow[]).map((row) => ({
      id: row.id, name: row.name, supplier: row.supplier, purchaseUnit: row.purchase_unit, category: row.category,
      version: row.version, priceMinor: row.price_minor === null ? null : normalize(row.native_amount_milli ?? row.price_minor * 1000, isCurrency(row.currency ?? "") ? row.currency as Currency : base), source: row.source, effectiveDate: row.effective_date,
      currency: isCurrency(row.currency ?? "") ? row.currency as Currency : base, nativeAmountMilli: row.price_minor === null ? null : row.native_amount_milli ?? row.price_minor * 1000,
    })),
    products: (products as ProductRow[]).map((row) => ({
      id: row.id, name: row.name, lotUnits: row.lot_units, salePriceMinor: row.sale_price_minor,
      salesVariableMinor: row.sales_variable_minor, laborLotMinor: row.labor_lot_minor,
      productionHoursMilli: row.production_hours_milli, batchesPerMonthMilli: row.batches_per_month_milli, version: row.version,
    })),
    components: (components as ComponentRow[]).map((row) => ({
      productId: row.product_id, materialId: row.material_id, quantityMilli: row.quantity_milli,
    })),
    expenses: (expenses as ExpenseRow[]).map((row) => ({
      id: row.id, name: row.name, period: row.period, amountMinor: normalize(row.native_amount_milli ?? row.amount_minor * 1000, isCurrency(row.currency ?? "") ? row.currency as Currency : base) ?? row.amount_minor,
      allocationBasis: row.allocation_mode === "manual" ? "manual" : row.allocation_basis, allocationShares: JSON.parse(row.allocation_shares_json), category: row.category, version: row.version,
      currency: isCurrency(row.currency ?? "") ? row.currency as Currency : base, nativeAmountMilli: row.native_amount_milli ?? row.amount_minor * 1000,
      fxMissing: isCurrency(row.currency ?? "") && row.currency !== base && !fxQuotes[row.currency as Currency],
    })),
  };
}

export async function loadDashboard(principal: Principal) {
  const statePromise = loadState(principal);
  const [state, alerts, profileRows] = await Promise.all([
    statePromise,
    dbQuery<{ id: string; material_id: string; message: string; first_detected_at: string }>(
      "SELECT id, material_id, message, first_detected_at FROM cost_alerts WHERE organization_id=? AND status='open' ORDER BY first_detected_at DESC LIMIT 50",
      [principal.organizationId],
    ),
    dbQuery<{ confirmed_json: string | null; draft_json: string | null }>(
      "SELECT confirmed_json, draft_json FROM production_profiles WHERE organization_id=?",
      [principal.organizationId],
    ),
  ]);
  const profileRow = profileRows[0];
  const workingProfile = profileRow?.draft_json
    ? productionProfileSchema.parse(JSON.parse(profileRow.draft_json))
    : profileRow?.confirmed_json
      ? productionProfileSchema.parse(JSON.parse(profileRow.confirmed_json))
      : null;
  const productionWork = workingProfile?.products.length ? {
    isDraft: Boolean(profileRow?.draft_json),
    products: workingProfile.products.map(({ name, finishedUnit, goodUnitsPerBatch, startedUnitsPerBatch, normalScrapUnitsPerBatch, batchesPerMonth, hoursPerBatch }) => ({ name, finishedUnit, goodUnitsPerBatch, startedUnitsPerBatch, normalScrapUnitsPerBatch, batchesPerMonth, hoursPerBatch })),
    costs: calculateProductionCosts(workingProfile, state.organization.currency, state.fxQuotes).map(({ product, unitMinor }) => ({ product, unitMinor })),
    evaluableProducts: evaluableProfileProducts(workingProfile, state.organization.currency, state.fxQuotes),
    inputs: workingProfile.inputs.map(({ name, consumptionUnit, usage }) => ({ name, consumptionUnit, usage })),
    recurringCosts: workingProfile.recurringCosts.map(({ name, allocation, shares }) => ({ name, allocation, shares })),
  } : null;
  return { ...state, costs: calculateCosts(state), alerts, productionWork };
}

export async function loadRecentChanges(principal: Principal) {
  return dbQuery<{ action: string; entity_id: string | null; created_at: string }>(
    "SELECT action, entity_id, created_at FROM audit_events WHERE organization_id=? ORDER BY created_at DESC LIMIT 20",
    [principal.organizationId],
  );
}
