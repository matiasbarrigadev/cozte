import "server-only";
import { z } from "zod";
import { emptyTally, tallyDelivery, type DeliveryTally } from "@/lib/delivery-zones";
import { SUPPLIER_KINDS, materialPrices, sortSuppliers, supplierKey, supplierMonths, supplierStats, suppliersFromHistory, type Supplier, type SupplierKind, type SupplierPurchase, type SupplierRow } from "@/lib/suppliers";
import { monthsBack } from "@/lib/business-analytics";
import type { DeliveryStatus } from "@/lib/business";
import { ApiError, type Principal } from "./auth";
import { dbBatch, dbQuery, type SqlStatement } from "./db";
import { organizationToday } from "./business";

/**
 * Suppliers. Built once from the names already typed in purchases, supplies and carrier zones; from then on each
 * purchase finds or creates its supplier by name, and each carrier zone points to its logistics supplier.
 */

type SupplierRowDb = { id: string; name: string; kind: SupplierKind; contact_name: string; phone: string; email: string; notes: string; source: string; created_at: string; name_key: string };
type PurchaseRowDb = { id: string; supplier_id: string | null; purchased_on: string; description: string; kind: SupplierPurchase["kind"]; amount_minor: number; material_id: string | null; material_name: string | null; quantity_milli: number | null; purchase_unit: string | null };
type DeliveryRowDb = { status: DeliveryStatus; scheduled_on: string; delivered_on: string | null; carrier: string; zone_id: string | null; cost: number };

const SUPPLIER_COLUMNS = "id, name, name_key, kind, contact_name, phone, email, notes, source, created_at";
const PURCHASE_SELECT = "SELECT p.id, p.supplier_id, p.purchased_on, p.description, p.kind, p.amount_minor, p.material_id, m.name AS material_name, p.quantity_milli, m.purchase_unit FROM purchases p LEFT JOIN materials m ON m.id=p.material_id";

const toSupplier = (row: SupplierRowDb): Supplier => ({
  id: row.id, name: row.name, kind: row.kind, contactName: row.contact_name, phone: row.phone, email: row.email, notes: row.notes,
  source: row.source === "cozte" || row.source === "import" ? row.source : "user", createdAt: row.created_at,
});
const toPurchase = (row: PurchaseRowDb): SupplierPurchase => ({
  id: row.id, supplierId: row.supplier_id, purchasedOn: row.purchased_on, description: row.description, kind: row.kind, amountMinor: row.amount_minor,
  materialId: row.material_id, materialName: row.material_name, quantityMilli: row.quantity_milli, purchaseUnit: row.purchase_unit,
});

const audit = (principal: Principal, action: string, entityId: string, details: unknown): SqlStatement => ({
  sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?)",
  params: [crypto.randomUUID(), principal.organizationId, principal.userId, action, entityId, JSON.stringify(details)],
});

function assertEditor(principal: Principal) {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para cambiar proveedores");
}

/**
 * Builds the suppliers from the names typed in purchases, the usual supplier of each supply and the carriers of the
 * delivery zones, once per organization. The first request claims the import, so two at the same time never duplicate it.
 */
export async function ensureSuppliersImported(principal: Principal): Promise<void> {
  const org = principal.organizationId;
  const [claimed] = await dbBatch<{ id: string }>([{ sql: "UPDATE organizations SET suppliers_imported_at=CURRENT_TIMESTAMP WHERE id=? AND suppliers_imported_at IS NULL RETURNING id", params: [org] }]);
  if (!claimed.length) return;
  const [purchases, materials, zones] = await dbBatch<{ supplier: string; kind: string; purchased_on: string } | { supplier: string } | { carrier: string }>([
    { sql: "SELECT supplier, kind, purchased_on FROM purchases WHERE organization_id=? AND archived_at IS NULL AND trim(supplier) <> '' ORDER BY purchased_on DESC LIMIT 5000", params: [org] },
    { sql: "SELECT supplier FROM materials WHERE organization_id=? AND archived_at IS NULL AND trim(supplier) <> ''", params: [org] },
    { sql: "SELECT carrier FROM delivery_zones WHERE organization_id=? AND archived_at IS NULL AND mode='carrier' AND trim(carrier) <> ''", params: [org] },
  ], { retrySafe: true });
  const imported = suppliersFromHistory([
    ...(purchases as { supplier: string; kind: string; purchased_on: string }[]).map((row) => ({ name: row.supplier, kind: (row.kind === "material" ? "materials" : "services") as SupplierKind, on: row.purchased_on })),
    ...(materials as { supplier: string }[]).map((row) => ({ name: row.supplier, kind: "materials" as SupplierKind })),
    ...(zones as { carrier: string }[]).map((row) => ({ name: row.carrier, kind: "logistics" as SupplierKind })),
  ]);
  if (!imported.length) return;
  const existing = new Map((await dbQuery<{ id: string; name_key: string }>("SELECT id, name_key FROM suppliers WHERE organization_id=? AND archived_at IS NULL", [org])).map((row) => [row.name_key, row.id]));
  const statements: SqlStatement[] = [];
  for (const entry of imported) {
    const id = existing.get(entry.key) ?? crypto.randomUUID();
    if (!existing.has(entry.key)) statements.push({ sql: "INSERT OR IGNORE INTO suppliers (id, organization_id, name, name_key, kind, source) VALUES (?, ?, ?, ?, ?, 'import')", params: [id, org, entry.name, entry.key, entry.kind] });
    const names = entry.names.map(() => "?").join(", ");
    statements.push({ sql: `UPDATE purchases SET supplier_id=? WHERE organization_id=? AND supplier_id IS NULL AND supplier IN (${names})`, params: [id, org, ...entry.names] });
    statements.push({ sql: `UPDATE delivery_zones SET supplier_id=? WHERE organization_id=? AND supplier_id IS NULL AND mode='carrier' AND carrier IN (${names})`, params: [id, org, ...entry.names] });
  }
  for (let index = 0; index < statements.length; index += 60) await dbBatch(statements.slice(index, index + 60));
}

/** The supplier of a name: the existing one (however it was written) or a new one of the given kind. Null for no name. */
export async function resolveSupplier(principal: Principal, name: string | undefined | null, kind: SupplierKind, source: "user" | "cozte"): Promise<string | null> {
  const clean = name?.trim() ?? "";
  const key = supplierKey(clean);
  if (!key) return null;
  await ensureSuppliersImported(principal);
  const find = async () => (await dbQuery<{ id: string }>("SELECT id FROM suppliers WHERE organization_id=? AND name_key=? AND archived_at IS NULL", [principal.organizationId, key]))[0]?.id ?? null;
  const found = await find();
  if (found) return found;
  const id = crypto.randomUUID();
  await dbBatch([{ sql: "INSERT OR IGNORE INTO suppliers (id, organization_id, name, name_key, kind, source) VALUES (?, ?, ?, ?, ?, ?)", params: [id, principal.organizationId, clean.slice(0, 120), key, kind, source] }]);
  return await find() ?? id;
}

export async function findSupplier(principal: Principal, reference: string): Promise<{ id: string; name: string } | null> {
  await ensureSuppliersImported(principal);
  const rows = await dbQuery<{ id: string; name: string }>("SELECT id, name FROM suppliers WHERE organization_id=? AND archived_at IS NULL AND (id=? OR name_key=?)", [principal.organizationId, reference, supplierKey(reference)]);
  return rows[0] ?? null;
}

const monthsBefore = (today: string, count: number) => { const date = new Date(`${today}T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() - count); return date.toISOString().slice(0, 10); };

/** Suppliers with their purchases of the last two years, the supplies they sell, their zones and deliveries. */
async function loadRecords(principal: Principal, supplierId?: string) {
  await ensureSuppliersImported(principal);
  const org = principal.organizationId;
  const today = await organizationToday(principal);
  const scope = supplierId ? " AND id=?" : "";
  const [suppliers, purchases, materials, zones, deliveries] = await dbBatch<SupplierRowDb | PurchaseRowDb | { name: string; supplier: string } | { id: string; name: string; supplier_id: string | null } | DeliveryRowDb>([
    { sql: `SELECT ${SUPPLIER_COLUMNS} FROM suppliers WHERE organization_id=? AND archived_at IS NULL${scope} ORDER BY name`, params: supplierId ? [org, supplierId] : [org] },
    { sql: `${PURCHASE_SELECT} WHERE p.organization_id=? AND p.archived_at IS NULL AND p.supplier_id IS NOT NULL AND p.purchased_on >= ?${supplierId ? " AND p.supplier_id=?" : ""} ORDER BY p.purchased_on DESC LIMIT 5000`, params: supplierId ? [org, monthsBefore(today, 24), supplierId] : [org, monthsBefore(today, 24)] },
    { sql: "SELECT name, supplier FROM materials WHERE organization_id=? AND archived_at IS NULL AND trim(supplier) <> ''", params: [org] },
    { sql: "SELECT id, name, supplier_id FROM delivery_zones WHERE organization_id=? AND archived_at IS NULL", params: [org] },
    { sql: "SELECT d.status, d.scheduled_on, d.delivered_on, d.carrier, d.zone_id, s.delivery_cost_minor AS cost FROM deliveries d JOIN sales s ON s.id=d.sale_id WHERE d.organization_id=? AND d.archived_at IS NULL AND s.archived_at IS NULL AND d.scheduled_on >= ? LIMIT 5000", params: [org, monthsBefore(today, 6)] },
  ], { retrySafe: true });
  const zoneList = zones as { id: string; name: string; supplier_id: string | null }[];
  const rows = (suppliers as SupplierRowDb[]).map((row): SupplierRow => {
    const own = (purchases as PurchaseRowDb[]).filter((item) => item.supplier_id === row.id).map(toPurchase);
    const prices = materialPrices(own);
    const usual = (materials as { name: string; supplier: string }[]).filter((item) => supplierKey(item.supplier) === row.name_key).map((item) => item.name);
    const served = zoneList.filter((zone) => zone.supplier_id === row.id);
    const servedIds = new Set(served.map((zone) => zone.id));
    // A carrier's deliveries: the ones of its zones or with its name as who took them.
    const carried = (deliveries as DeliveryRowDb[]).filter((item) => (item.zone_id && servedIds.has(item.zone_id)) || (item.carrier && supplierKey(item.carrier) === row.name_key));
    let tally: DeliveryTally | null = null;
    if (carried.length) { tally = emptyTally(); for (const item of carried) tallyDelivery(tally, { status: item.status, scheduledOn: item.scheduled_on, deliveredOn: item.delivered_on }, item.cost, today); }
    return {
      ...toSupplier(row), stats: supplierStats(own, today), prices,
      materials: [...new Set([...prices.map((price) => price.name), ...usual])],
      zones: served.map((zone) => zone.name), deliveries: tally,
    };
  });
  return { rows, purchases: (purchases as PurchaseRowDb[]).map(toPurchase), today };
}

export async function loadSuppliers(principal: Principal): Promise<{ suppliers: SupplierRow[]; today: string }> {
  const { rows, today } = await loadRecords(principal);
  return { suppliers: sortSuppliers(rows), today };
}

/** One supplier: data, what it sells with its prices, what was bought month by month and its latest purchases. */
export async function loadSupplier(principal: Principal, id: string) {
  const { rows, purchases, today } = await loadRecords(principal, id);
  const supplier = rows[0];
  if (!supplier) throw new ApiError(404, "Proveedor no encontrado");
  return { supplier, months: supplierMonths(purchases, monthsBack(today.slice(0, 7), 12)), purchases: purchases.slice(0, 60), today };
}

export const supplierInputSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(SUPPLIER_KINDS as [SupplierKind, ...SupplierKind[]]).optional(),
  contactName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(60).optional(),
  email: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});

/** Creates a supplier or corrects its data; a new name is also written on its purchases and carrier zones. */
export async function saveSupplier(principal: Principal, input: z.input<typeof supplierInputSchema>, source: "user" | "cozte"): Promise<{ id: string; created: boolean; done: string[] }> {
  assertEditor(principal);
  const value = supplierInputSchema.parse(input);
  const org = principal.organizationId;
  await ensureSuppliersImported(principal);
  const nameKey = value.name ? supplierKey(value.name) : null;
  if (value.name !== undefined && !nameKey) throw new ApiError(400, "Escribe el nombre del proveedor");
  if (nameKey) {
    const [taken] = await dbQuery<{ id: string; name: string }>("SELECT id, name FROM suppliers WHERE organization_id=? AND name_key=? AND archived_at IS NULL", [org, nameKey]);
    if (taken && taken.id !== value.id) throw new ApiError(409, `Ya hay un proveedor llamado ${taken.name}${value.id ? ": si es el mismo, únelos" : ""}`);
  }
  if (!value.id) {
    if (!value.name) throw new ApiError(400, "Escribe el nombre del proveedor");
    const id = crypto.randomUUID();
    await dbBatch([
      { sql: "INSERT INTO suppliers (id, organization_id, name, name_key, kind, contact_name, phone, email, notes, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [id, org, value.name, nameKey!, value.kind ?? "materials", value.contactName ?? "", value.phone ?? "", value.email ?? "", value.notes ?? "", source] },
      audit(principal, "create-supplier", id, { ...value, source }),
    ]);
    return { id, created: true, done: [`Proveedor creado: ${value.name}`] };
  }
  const [current] = await dbQuery<{ name: string }>("SELECT name FROM suppliers WHERE id=? AND organization_id=? AND archived_at IS NULL", [value.id, org]);
  if (!current) throw new ApiError(404, "Proveedor no encontrado");
  const fields = ([["name", value.name], ["kind", value.kind], ["contact_name", value.contactName], ["phone", value.phone], ["email", value.email], ["notes", value.notes]] as const).filter(([, field]) => field !== undefined);
  if (!fields.length) return { id: value.id, created: false, done: [] };
  const statements: SqlStatement[] = [{ sql: `UPDATE suppliers SET ${fields.map(([column]) => `${column}=?`).join(", ")}${nameKey ? ", name_key=?" : ""}, updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`, params: [...fields.map(([, field]) => field as string), ...(nameKey ? [nameKey] : []), value.id, org] }];
  const renamed = value.name && value.name !== current.name;
  if (renamed) {
    statements.push({ sql: "UPDATE purchases SET supplier=? WHERE organization_id=? AND supplier_id=?", params: [value.name!, org, value.id] });
    statements.push({ sql: "UPDATE delivery_zones SET carrier=? WHERE organization_id=? AND supplier_id=?", params: [value.name!, org, value.id] });
  }
  statements.push(audit(principal, "update-supplier", value.id, { ...value, source }));
  await dbBatch(statements);
  return { id: value.id, created: false, done: [renamed ? `Proveedor renombrado: ${current.name} → ${value.name}` : `Datos de ${value.name ?? current.name} actualizados`] };
}

/** Joins a duplicate into another supplier: its purchases and zones move over and the duplicate is archived. */
export async function mergeSuppliers(principal: Principal, fromId: string, intoId: string): Promise<{ done: string[] }> {
  assertEditor(principal);
  if (fromId === intoId) throw new ApiError(400, "Elige otro proveedor para unir");
  const org = principal.organizationId;
  const rows = await dbQuery<{ id: string; name: string }>("SELECT id, name FROM suppliers WHERE organization_id=? AND archived_at IS NULL AND id IN (?, ?)", [org, fromId, intoId]);
  const from = rows.find((row) => row.id === fromId), into = rows.find((row) => row.id === intoId);
  if (!from || !into) throw new ApiError(404, "Proveedor no encontrado");
  await dbBatch([
    { sql: "UPDATE purchases SET supplier_id=?, supplier=? WHERE organization_id=? AND supplier_id=?", params: [intoId, into.name, org, fromId] },
    { sql: "UPDATE delivery_zones SET supplier_id=?, carrier=? WHERE organization_id=? AND supplier_id=?", params: [intoId, into.name, org, fromId] },
    { sql: "UPDATE suppliers SET archived_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?", params: [fromId, org] },
    audit(principal, "merge-suppliers", intoId, { fromId, from: from.name }),
  ]);
  return { done: [`${from.name} quedó unido a ${into.name}`] };
}

/** Archives a supplier; its purchases keep the name as typed. */
export async function archiveSupplier(principal: Principal, id: string): Promise<void> {
  assertEditor(principal);
  const org = principal.organizationId;
  await dbBatch([
    { sql: "UPDATE suppliers SET archived_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?", params: [id, org] },
    { sql: "UPDATE purchases SET supplier_id=NULL WHERE organization_id=? AND supplier_id=?", params: [org, id] },
    { sql: "UPDATE delivery_zones SET supplier_id=NULL WHERE organization_id=? AND supplier_id=?", params: [org, id] },
    audit(principal, "archive-supplier", id, {}),
  ]);
}
