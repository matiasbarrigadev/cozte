import "server-only";
import { calculateCosts, COST_AREAS, type CostArea, type DomainState, type Investment } from "@/lib/domain";
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
  currency: string | null; native_amount_milli: number | null; area: string | null;
};
type CategoryRow = { id: string; name: string };
type InvestmentRow = { id: string; description: string; amount_minor: number; purchased_on: string; useful_life_months: number | null; area: string; include_in_unit_cost: number; allocation_basis: string };

/** The name placed on a new organization until its real one is known. */
export const DEFAULT_ORGANIZATION_NAME = "Mi empresa";

const clerkNames = new Map<string, { name: string | null; at: number }>();
const CLERK_NAME_TTL_MS = 10 * 60_000;

/**
 * The organization's name as the person set it in the account (Clerk), remembered for a few minutes per instance so
 * a rename shows up soon without asking on every request. Null when the account is not configured or unreachable.
 */
async function clerkOrganizationName(organizationId: string): Promise<string | null> {
  if (!process.env.CLERK_SECRET_KEY) return null;
  const cached = clerkNames.get(organizationId);
  if (cached && Date.now() - cached.at < CLERK_NAME_TTL_MS) return cached.name;
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const organization = await (await clerkClient()).organizations.getOrganization({ organizationId });
    const name = organization.name?.trim().slice(0, 120) || null;
    clerkNames.set(organizationId, { name, at: Date.now() });
    return name;
  } catch (error) {
    console.error("Organization name lookup failed", error);
    clerkNames.set(organizationId, { name: cached?.name ?? null, at: Date.now() - CLERK_NAME_TTL_MS + 60_000 });
    return cached?.name ?? null;
  }
}

export async function ensureOrganization(principal: Principal): Promise<void> {
  const name = await clerkOrganizationName(principal.organizationId);
  await dbBatch([
    { sql: "INSERT OR IGNORE INTO organizations (id) VALUES (?)", params: [principal.organizationId] },
    ...(name ? [{ sql: "UPDATE organizations SET name=? WHERE id=? AND name<>?", params: [name, principal.organizationId, name] }] : []),
    { sql: "INSERT INTO memberships (organization_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT (organization_id, user_id) DO UPDATE SET role=excluded.role", params: [principal.organizationId, principal.userId, principal.role] },
    { sql: "INSERT OR IGNORE INTO cost_categories (id, organization_id, name) SELECT ?, ?, 'Materia prima' WHERE NOT EXISTS (SELECT 1 FROM cost_categories WHERE organization_id=?) UNION ALL SELECT ?, ?, 'Gastos generales' WHERE NOT EXISTS (SELECT 1 FROM cost_categories WHERE organization_id=?)", params: [crypto.randomUUID(), principal.organizationId, principal.organizationId, crypto.randomUUID(), principal.organizationId, principal.organizationId] },
  ], { retrySafe: true }); // Idempotent upserts.
}

export async function loadState(principal: Principal): Promise<DomainState> {
  await ensureOrganization(principal);
  return loadStateForOrganization(principal.organizationId);
}

export async function loadStateForOrganization(org: string): Promise<DomainState> {
  const [organizations, materials, products, components, expenses, categories, investments] = await dbBatch<OrganizationRow | MaterialRow | ProductRow | ComponentRow | ExpenseRow | CategoryRow | InvestmentRow>([
    { sql: "SELECT id, name, currency, revision FROM organizations WHERE id=?", params: [org] },
    { sql: "SELECT m.id, m.name, m.supplier, m.purchase_unit, m.category, m.version, p.amount_minor AS price_minor, p.source, p.effective_date, p.currency, p.native_amount_milli FROM materials m LEFT JOIN material_prices p ON p.material_id=m.id AND p.version=m.version WHERE m.organization_id=? AND m.archived_at IS NULL ORDER BY m.name", params: [org] },
    { sql: "SELECT id, name, lot_units, sale_price_minor, sales_variable_minor, labor_lot_minor, production_hours_milli, batches_per_month_milli, version FROM products WHERE organization_id=? AND archived_at IS NULL ORDER BY name", params: [org] },
    { sql: "SELECT pm.product_id, pm.material_id, pm.quantity_milli FROM product_materials pm JOIN products p ON p.id=pm.product_id JOIN materials m ON m.id=pm.material_id WHERE p.organization_id=? AND p.archived_at IS NULL AND m.archived_at IS NULL", params: [org] },
    { sql: "SELECT id, name, period, amount_minor, allocation_basis, allocation_mode, allocation_shares_json, category, version, currency, native_amount_milli, area FROM shared_expenses WHERE organization_id=? ORDER BY name", params: [org] },
    { sql: "SELECT id, name FROM cost_categories WHERE organization_id=? ORDER BY name", params: [org] },
    { sql: "SELECT id, description, amount_minor, purchased_on, useful_life_months, area, include_in_unit_cost, allocation_basis FROM purchases WHERE organization_id=? AND kind='investment' AND archived_at IS NULL ORDER BY purchased_on", params: [org] },
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
    investments: (investments as InvestmentRow[]).filter((row) => row.useful_life_months).map((row): Investment => ({
      id: row.id, name: row.description, amountMinor: row.amount_minor, purchasedOn: row.purchased_on, usefulLifeMonths: row.useful_life_months!,
      area: (COST_AREAS as string[]).includes(row.area) ? row.area as CostArea : "production", includeInUnitCost: row.include_in_unit_cost === 1,
      allocationBasis: row.allocation_basis === "units" ? "units" : "hours",
    })),
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
      id: row.id, name: row.name, period: row.period, area: (COST_AREAS as string[]).includes(row.area ?? "") ? row.area as CostArea : "production", amountMinor: normalize(row.native_amount_milli ?? row.amount_minor * 1000, isCurrency(row.currency ?? "") ? row.currency as Currency : base) ?? row.amount_minor,
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
