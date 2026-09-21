import "server-only";
import { calculateCosts, type DomainState } from "@/lib/domain";
import { dbBatch, dbQuery } from "./db";
import type { Principal } from "./auth";

type OrganizationRow = { id: string; name: string; currency: string; revision: number };
type MaterialRow = {
  id: string; name: string; supplier: string; purchase_unit: string; version: number;
  price_minor: number | null; source: string | null; effective_date: string | null;
};
type ProductRow = {
  id: string; name: string; lot_units: number; sale_price_minor: number;
  sales_variable_minor: number; labor_lot_minor: number; production_hours_milli: number; version: number;
};
type ComponentRow = { product_id: string; material_id: string; quantity_milli: number };
type ExpenseRow = {
  id: string; name: string; period: string; amount_minor: number;
  allocation_basis: "hours" | "units"; version: number;
};

export async function ensureOrganization(principal: Principal): Promise<void> {
  await dbBatch([
    { sql: "INSERT OR IGNORE INTO organizations (id) VALUES (?)", params: [principal.organizationId] },
    { sql: "INSERT INTO memberships (organization_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT (organization_id, user_id) DO UPDATE SET role=excluded.role", params: [principal.organizationId, principal.userId, principal.role] },
  ]);
}

export async function loadState(principal: Principal): Promise<DomainState> {
  await ensureOrganization(principal);
  const org = principal.organizationId;
  const [organizations, materials, products, components, expenses] = await dbBatch<OrganizationRow | MaterialRow | ProductRow | ComponentRow | ExpenseRow>([
    { sql: "SELECT id, name, currency, revision FROM organizations WHERE id=?", params: [org] },
    { sql: "SELECT m.id, m.name, m.supplier, m.purchase_unit, m.version, p.amount_minor AS price_minor, p.source, p.effective_date FROM materials m LEFT JOIN material_prices p ON p.material_id=m.id AND p.version=m.version WHERE m.organization_id=? ORDER BY m.name", params: [org] },
    { sql: "SELECT id, name, lot_units, sale_price_minor, sales_variable_minor, labor_lot_minor, production_hours_milli, version FROM products WHERE organization_id=? ORDER BY name", params: [org] },
    { sql: "SELECT pm.product_id, pm.material_id, pm.quantity_milli FROM product_materials pm JOIN products p ON p.id=pm.product_id WHERE p.organization_id=?", params: [org] },
    { sql: "SELECT id, name, period, amount_minor, allocation_basis, version FROM shared_expenses WHERE organization_id=? ORDER BY name", params: [org] },
  ]);
  const organization = organizations[0] as OrganizationRow | undefined;
  if (!organization) throw new Error("Organization was not provisioned");
  return {
    revision: organization.revision,
    activePeriod: (expenses as ExpenseRow[]).map((row) => row.period).sort().at(-1) ?? new Date().toISOString().slice(0, 7),
    organization: { id: organization.id, name: organization.name, currency: organization.currency },
    materials: (materials as MaterialRow[]).map((row) => ({
      id: row.id, name: row.name, supplier: row.supplier, purchaseUnit: row.purchase_unit,
      version: row.version, priceMinor: row.price_minor, source: row.source, effectiveDate: row.effective_date,
    })),
    products: (products as ProductRow[]).map((row) => ({
      id: row.id, name: row.name, lotUnits: row.lot_units, salePriceMinor: row.sale_price_minor,
      salesVariableMinor: row.sales_variable_minor, laborLotMinor: row.labor_lot_minor,
      productionHoursMilli: row.production_hours_milli, version: row.version,
    })),
    components: (components as ComponentRow[]).map((row) => ({
      productId: row.product_id, materialId: row.material_id, quantityMilli: row.quantity_milli,
    })),
    expenses: (expenses as ExpenseRow[]).map((row) => ({
      id: row.id, name: row.name, period: row.period, amountMinor: row.amount_minor,
      allocationBasis: row.allocation_basis, version: row.version,
    })),
  };
}

export async function loadDashboard(principal: Principal) {
  const [state, alerts] = await Promise.all([
    loadState(principal),
    dbQuery<{ id: string; material_id: string; message: string; first_detected_at: string }>(
      "SELECT id, material_id, message, first_detected_at FROM cost_alerts WHERE organization_id=? AND status='open' ORDER BY first_detected_at DESC LIMIT 50",
      [principal.organizationId],
    ),
  ]);
  return { ...state, costs: calculateCosts(state), alerts };
}

export async function loadRecentChanges(principal: Principal) {
  return dbQuery<{ action: string; entity_id: string | null; created_at: string }>(
    "SELECT action, entity_id, created_at FROM audit_events WHERE organization_id=? ORDER BY created_at DESC LIMIT 20",
    [principal.organizationId],
  );
}
