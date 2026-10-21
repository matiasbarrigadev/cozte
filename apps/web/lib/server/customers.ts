import "server-only";
import { z } from "zod";
import { buildCustomerList, customerKey, customerMonths, customersFromHistory, customerStats, zoneFromAddress, type Customer, type CustomerAddress, type CustomerRow, type CustomerSale, type CustomerStats } from "@/lib/customers";
import { monthsBack } from "@/lib/business-analytics";
import { ApiError, type Principal } from "./auth";
import { dbBatch, dbQuery, type SqlStatement } from "./db";
import { organizationToday } from "./business";

/**
 * Customers with their addresses. Built once from the names already typed in sales; from then on each sale finds or
 * creates its customer by name, and each new delivery address is kept in the customer's record.
 */

type CustomerRowDb = { id: string; name: string; phone: string; email: string; notes: string; source: string; created_at: string };
type AddressRowDb = { id: string; customer_id: string; label: string; address: string; zone: string; recipient: string; contact: string; notes: string; is_default: number };
type SaleRowDb = { id: string; customer_id: string | null; sold_on: string; channel_name: string; total_minor: number; variable_cost_minor: number | null; selling_cost_minor: number; delivery_cost_minor: number; items: string | null; delivery_status: string | null; delivery_address: string | null; paid_minor: number };

function assertEditor(principal: Principal) {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para cambiar clientes");
}

const audit = (principal: Principal, action: string, entityId: string, details: unknown): SqlStatement => ({
  sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?)",
  params: [crypto.randomUUID(), principal.organizationId, principal.userId, action, entityId, JSON.stringify(details)],
});

const toAddress = (row: AddressRowDb): CustomerAddress => ({ id: row.id, label: row.label, address: row.address, zone: row.zone, recipient: row.recipient, contact: row.contact, notes: row.notes, isDefault: row.is_default === 1 });
const toSale = (row: SaleRowDb): CustomerSale => ({
  id: row.id, customerId: row.customer_id, soldOn: row.sold_on, channelName: row.channel_name, items: row.items ?? "",
  totalMinor: row.total_minor, variableCostMinor: row.variable_cost_minor, sellingCostMinor: row.selling_cost_minor, deliveryCostMinor: row.delivery_cost_minor,
  deliveryStatus: row.delivery_status, deliveryAddress: row.delivery_address, paidMinor: row.paid_minor,
});

const SALE_COLUMNS = `s.id, s.customer_id, s.sold_on, s.channel_name, s.total_minor, s.variable_cost_minor, s.selling_cost_minor, s.delivery_cost_minor, s.paid_minor,
  (SELECT group_concat(CASE WHEN si.quantity_milli % 1000 = 0 THEN CAST(si.quantity_milli / 1000 AS TEXT) ELSE CAST(si.quantity_milli / 1000.0 AS TEXT) END || ' × ' || si.product_name, ', ') FROM sale_items si WHERE si.sale_id=s.id) AS items,
  d.status AS delivery_status, d.address AS delivery_address`;

/**
 * Builds the customers from the names typed in sales and the addresses of their deliveries, once per organization.
 * The first request claims the import, so two at the same time never duplicate it.
 */
export async function ensureCustomersImported(principal: Principal): Promise<void> {
  const org = principal.organizationId;
  const [claimed] = await dbBatch<{ id: string }>([{ sql: "UPDATE organizations SET customers_imported_at=CURRENT_TIMESTAMP WHERE id=? AND customers_imported_at IS NULL RETURNING id", params: [org] }]);
  if (!claimed.length) return;
  const rows = await dbQuery<{ customer: string; sold_on: string; recipient: string | null; address: string | null; contact: string | null }>(
    "SELECT s.customer, s.sold_on, d.recipient, d.address, d.contact FROM sales s LEFT JOIN deliveries d ON d.sale_id=s.id AND d.archived_at IS NULL WHERE s.organization_id=? AND s.archived_at IS NULL AND trim(s.customer) <> '' ORDER BY s.sold_on DESC LIMIT 5000", [org]);
  const imported = customersFromHistory(rows.map((row) => ({ customer: row.customer, soldOn: row.sold_on, recipient: row.recipient, address: row.address, contact: row.contact })));
  if (!imported.length) return;
  const existing = new Map((await dbQuery<{ id: string; name_key: string }>("SELECT id, name_key FROM customers WHERE organization_id=? AND archived_at IS NULL", [org])).map((row) => [row.name_key, row.id]));
  const statements: SqlStatement[] = [];
  for (const entry of imported) {
    const known = existing.get(entry.key);
    const id = known ?? crypto.randomUUID();
    if (!known) {
      statements.push({ sql: "INSERT OR IGNORE INTO customers (id, organization_id, name, name_key, phone, source) VALUES (?, ?, ?, ?, ?, 'import')", params: [id, org, entry.name, entry.key, entry.phone] });
      for (const address of entry.addresses) statements.push({ sql: "INSERT INTO customer_addresses (id, organization_id, customer_id, address, zone, recipient, contact, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), org, id, address.address, address.zone, address.recipient, address.contact, address.isDefault ? 1 : 0] });
    }
    statements.push({ sql: `UPDATE sales SET customer_id=? WHERE organization_id=? AND customer_id IS NULL AND archived_at IS NULL AND customer IN (${entry.names.map(() => "?").join(", ")})`, params: [id, org, ...entry.names] });
  }
  for (let index = 0; index < statements.length; index += 60) await dbBatch(statements.slice(index, index + 60));
}

/** The customer of a name: the existing one (however it was written) or a new one. Null for sales without customer. */
export async function resolveCustomer(principal: Principal, name: string | undefined | null, source: "user" | "cozte"): Promise<string | null> {
  return (await resolveCustomerEntry(principal, name, source))?.id ?? null;
}

/** The customer of a name, saying whether it was created now. */
export async function resolveCustomerEntry(principal: Principal, name: string | undefined | null, source: "user" | "cozte"): Promise<{ id: string; created: boolean } | null> {
  const clean = name?.trim() ?? "";
  const key = customerKey(clean);
  if (!key) return null;
  await ensureCustomersImported(principal);
  const find = async () => (await dbQuery<{ id: string }>("SELECT id FROM customers WHERE organization_id=? AND name_key=? AND archived_at IS NULL", [principal.organizationId, key]))[0]?.id ?? null;
  const found = await find();
  if (found) return { id: found, created: false };
  const id = crypto.randomUUID();
  await dbBatch([{ sql: "INSERT OR IGNORE INTO customers (id, organization_id, name, name_key, source) VALUES (?, ?, ?, ?, ?)", params: [id, principal.organizationId, clean.slice(0, 120), key, source] }]);
  const stored = await find() ?? id;
  return { id: stored, created: stored === id };
}

/** A customer's address to deliver to: the given one (kept in their record if new) or their default one. */
export async function customerAddressFor(principal: Principal, customerId: string, given: { address?: string; recipient?: string; contact?: string }): Promise<{ id: string; address: string; zone: string; recipient: string; contact: string } | null> {
  const addresses = await dbQuery<AddressRowDb>("SELECT id, customer_id, label, address, zone, recipient, contact, notes, is_default FROM customer_addresses WHERE organization_id=? AND customer_id=? AND archived_at IS NULL ORDER BY is_default DESC, created_at DESC", [principal.organizationId, customerId]);
  const address = given.address?.trim() ?? "";
  if (!address) {
    const main = addresses[0];
    return main ? { id: main.id, address: main.address, zone: main.zone, recipient: main.recipient, contact: main.contact } : null;
  }
  const same = addresses.find((row) => customerKey(row.address) === customerKey(address));
  if (same) return { id: same.id, address: same.address, zone: same.zone, recipient: given.recipient ?? same.recipient, contact: given.contact ?? same.contact };
  const id = crypto.randomUUID();
  await dbBatch([{ sql: "INSERT INTO customer_addresses (id, organization_id, customer_id, address, zone, recipient, contact, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", params: [id, principal.organizationId, customerId, address.slice(0, 200), zoneFromAddress(address), given.recipient?.trim().slice(0, 120) ?? "", given.contact?.trim().slice(0, 120) ?? "", addresses.length ? 0 : 1] }]);
  return { id, address, zone: zoneFromAddress(address), recipient: given.recipient ?? "", contact: given.contact ?? "" };
}

async function loadRecords(principal: Principal, customerId?: string): Promise<{ customers: Customer[]; sales: CustomerSale[] }> {
  await ensureCustomersImported(principal);
  const org = principal.organizationId;
  const scope = customerId ? " AND id=?" : "";
  const [customers, addresses, sales] = await dbBatch<CustomerRowDb | AddressRowDb | SaleRowDb>([
    { sql: `SELECT id, name, phone, email, notes, source, created_at FROM customers WHERE organization_id=? AND archived_at IS NULL${scope} ORDER BY name`, params: customerId ? [org, customerId] : [org] },
    { sql: `SELECT id, customer_id, label, address, zone, recipient, contact, notes, is_default FROM customer_addresses WHERE organization_id=? AND archived_at IS NULL${customerId ? " AND customer_id=?" : ""} ORDER BY is_default DESC, created_at DESC`, params: customerId ? [org, customerId] : [org] },
    { sql: `SELECT ${SALE_COLUMNS} FROM sales s LEFT JOIN deliveries d ON d.sale_id=s.id AND d.archived_at IS NULL WHERE s.organization_id=? AND s.archived_at IS NULL AND s.customer_id IS NOT NULL${customerId ? " AND s.customer_id=?" : ""} ORDER BY s.sold_on DESC LIMIT 5000`, params: customerId ? [org, customerId] : [org] },
  ], { retrySafe: true });
  const byCustomer = new Map<string, CustomerAddress[]>();
  for (const row of addresses as AddressRowDb[]) byCustomer.set(row.customer_id, [...(byCustomer.get(row.customer_id) ?? []), toAddress(row)]);
  return {
    customers: (customers as CustomerRowDb[]).map((row) => ({ id: row.id, name: row.name, phone: row.phone, email: row.email, notes: row.notes, source: row.source === "cozte" || row.source === "import" ? row.source : "user", createdAt: row.created_at, addresses: byCustomer.get(row.id) ?? [] })),
    sales: (sales as SaleRowDb[]).map(toSale),
  };
}

/** Every customer with their stats, the most recent buyer first. */
export async function loadCustomers(principal: Principal): Promise<{ customers: CustomerRow[]; today: string }> {
  const [records, today] = await Promise.all([loadRecords(principal), organizationToday(principal)]);
  return { customers: buildCustomerList(records.customers, records.sales, today), today };
}

export type CustomerDetail = { customer: Customer; stats: CustomerStats; months: { month: string; revenue: number; sales: number }[]; sales: CustomerSale[]; today: string };

/** One customer: their data, addresses, stats, each month's purchases and their latest sales. */
export async function loadCustomer(principal: Principal, id: string): Promise<CustomerDetail> {
  const [records, today] = await Promise.all([loadRecords(principal, id), organizationToday(principal)]);
  const customer = records.customers[0];
  if (!customer) throw new ApiError(404, "Cliente no encontrado");
  return { customer, stats: customerStats(records.sales, today), months: customerMonths(records.sales, monthsBack(today.slice(0, 7), 12)), sales: records.sales.slice(0, 60), today };
}

/** Finds a customer by id or by name as someone writes it. */
export async function findCustomer(principal: Principal, reference: string): Promise<{ id: string; name: string } | null> {
  await ensureCustomersImported(principal);
  const rows = await dbQuery<{ id: string; name: string }>("SELECT id, name FROM customers WHERE organization_id=? AND archived_at IS NULL AND (id=? OR name_key=?)", [principal.organizationId, reference, customerKey(reference)]);
  return rows[0] ?? null;
}

export const customerInputSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(60).optional(),
  email: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});

/** Creates a customer or corrects one. Renaming keeps their sales pointing to them and updates the name they show. */
export async function saveCustomer(principal: Principal, input: z.input<typeof customerInputSchema>, source: "user" | "cozte"): Promise<{ id: string; created: boolean; done: string[] }> {
  assertEditor(principal);
  const value = customerInputSchema.parse(input);
  await ensureCustomersImported(principal);
  const org = principal.organizationId;
  if (!value.id) {
    if (!value.name) throw new ApiError(400, "Escribe el nombre del cliente");
    const key = customerKey(value.name);
    const [taken] = await dbQuery<{ id: string }>("SELECT id FROM customers WHERE organization_id=? AND name_key=? AND archived_at IS NULL", [org, key]);
    if (taken) throw new ApiError(409, `Ya hay un cliente llamado ${value.name}`);
    const id = crypto.randomUUID();
    await dbBatch([
      { sql: "INSERT INTO customers (id, organization_id, name, name_key, phone, email, notes, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", params: [id, org, value.name, key, value.phone ?? "", value.email ?? "", value.notes ?? "", source] },
      audit(principal, "create-customer", id, { ...value, source }),
    ]);
    return { id, created: true, done: [`Cliente creado: ${value.name}`] };
  }
  const [current] = await dbQuery<{ name: string }>("SELECT name FROM customers WHERE id=? AND organization_id=? AND archived_at IS NULL", [value.id, org]);
  if (!current) throw new ApiError(404, "Cliente no encontrado");
  const statements: SqlStatement[] = [];
  const done: string[] = [];
  if (value.name !== undefined && value.name !== current.name) {
    const key = customerKey(value.name);
    const [taken] = await dbQuery<{ id: string }>("SELECT id FROM customers WHERE organization_id=? AND name_key=? AND archived_at IS NULL AND id<>?", [org, key, value.id]);
    if (taken) throw new ApiError(409, `Ya hay un cliente llamado ${value.name}: si es el mismo, únelos`);
    statements.push({ sql: "UPDATE customers SET name=?, name_key=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?", params: [value.name, key, value.id, org] });
    statements.push({ sql: "UPDATE sales SET customer=? WHERE organization_id=? AND customer_id=?", params: [value.name, org, value.id] });
    done.push(`Cliente renombrado: ${current.name} → ${value.name}`);
  }
  const fields = (["phone", "email", "notes"] as const).filter((field) => value[field] !== undefined);
  if (fields.length) {
    statements.push({ sql: `UPDATE customers SET ${fields.map((field) => `${field}=?`).join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`, params: [...fields.map((field) => value[field] ?? ""), value.id, org] });
    done.push("Datos del cliente actualizados");
  }
  if (!statements.length) return { id: value.id, created: false, done: [] };
  statements.push(audit(principal, "update-customer", value.id, { before: current, patch: value, source }));
  await dbBatch(statements);
  return { id: value.id, created: false, done };
}

export const addressInputSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  customerId: z.string().min(1).max(120),
  label: z.string().trim().max(60).optional(),
  address: z.string().trim().min(3).max(200).optional(),
  zone: z.string().trim().max(60).optional(),
  recipient: z.string().trim().max(120).optional(),
  contact: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
  isDefault: z.boolean().optional(),
});

/** Adds or corrects one of a customer's addresses; making it the default unmarks the others. */
export async function saveCustomerAddress(principal: Principal, input: z.input<typeof addressInputSchema>, source: "user" | "cozte"): Promise<{ id: string; created: boolean; done: string[] }> {
  assertEditor(principal);
  const value = addressInputSchema.parse(input);
  const org = principal.organizationId;
  const [customer] = await dbQuery<{ name: string; addresses: number }>("SELECT name, (SELECT COUNT(*) FROM customer_addresses a WHERE a.customer_id=c.id AND a.archived_at IS NULL) AS addresses FROM customers c WHERE c.id=? AND c.organization_id=? AND c.archived_at IS NULL", [value.customerId, org]);
  if (!customer) throw new ApiError(404, "Cliente no encontrado");
  const statements: SqlStatement[] = [];
  const makeDefault = value.isDefault === true || (!value.id && customer.addresses === 0);
  if (makeDefault) statements.push({ sql: "UPDATE customer_addresses SET is_default=0 WHERE organization_id=? AND customer_id=?", params: [org, value.customerId] });
  let id = value.id;
  if (!id) {
    if (!value.address) throw new ApiError(400, "Escribe la dirección");
    id = crypto.randomUUID();
    statements.push({ sql: "INSERT INTO customer_addresses (id, organization_id, customer_id, label, address, zone, recipient, contact, notes, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [id, org, value.customerId, value.label ?? "", value.address, value.zone ?? zoneFromAddress(value.address), value.recipient ?? "", value.contact ?? "", value.notes ?? "", makeDefault ? 1 : 0] });
  } else {
    const fields = (["label", "address", "zone", "recipient", "contact", "notes"] as const).filter((field) => value[field] !== undefined);
    const sets = [...fields.map((field) => `${field}=?`), ...(value.isDefault !== undefined ? ["is_default=?"] : [])];
    if (sets.length) statements.push({ sql: `UPDATE customer_addresses SET ${sets.join(", ")} WHERE id=? AND organization_id=? AND customer_id=?`, params: [...fields.map((field) => value[field] ?? ""), ...(value.isDefault !== undefined ? [value.isDefault ? 1 : 0] : []), id, org, value.customerId] });
  }
  if (!statements.length) return { id, created: false, done: [] };
  statements.push(audit(principal, value.id ? "update-customer-address" : "create-customer-address", id, { ...value, source }));
  await dbBatch(statements);
  return { id, created: !value.id, done: [value.id ? `Dirección de ${customer.name} actualizada` : `Dirección agregada a ${customer.name}`] };
}

export async function archiveCustomerAddress(principal: Principal, customerId: string, id: string): Promise<void> {
  assertEditor(principal);
  const org = principal.organizationId;
  await dbBatch([
    { sql: "UPDATE customer_addresses SET archived_at=CURRENT_TIMESTAMP, is_default=0 WHERE id=? AND organization_id=? AND customer_id=?", params: [id, org, customerId] },
    // The newest remaining address becomes the default when the default one leaves.
    { sql: "UPDATE customer_addresses SET is_default=1 WHERE id=(SELECT id FROM customer_addresses WHERE organization_id=? AND customer_id=? AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1) AND NOT EXISTS (SELECT 1 FROM customer_addresses WHERE organization_id=? AND customer_id=? AND archived_at IS NULL AND is_default=1)", params: [org, customerId, org, customerId] },
    audit(principal, "archive-customer-address", id, { customerId }),
  ]);
}

/** Joins a duplicate into another customer: its sales and new addresses move over and the duplicate is archived. */
export async function mergeCustomers(principal: Principal, fromId: string, intoId: string): Promise<{ done: string[] }> {
  assertEditor(principal);
  if (fromId === intoId) throw new ApiError(400, "Elige otro cliente para unir");
  const org = principal.organizationId;
  const rows = await dbQuery<{ id: string; name: string }>("SELECT id, name FROM customers WHERE organization_id=? AND archived_at IS NULL AND id IN (?, ?)", [org, fromId, intoId]);
  const from = rows.find((row) => row.id === fromId);
  const into = rows.find((row) => row.id === intoId);
  if (!from || !into) throw new ApiError(404, "Cliente no encontrado");
  const addresses = await dbQuery<AddressRowDb>("SELECT id, customer_id, label, address, zone, recipient, contact, notes, is_default FROM customer_addresses WHERE organization_id=? AND customer_id IN (?, ?) AND archived_at IS NULL", [org, fromId, intoId]);
  const kept = new Set(addresses.filter((row) => row.customer_id === intoId).map((row) => customerKey(row.address)));
  const statements: SqlStatement[] = [
    { sql: "UPDATE sales SET customer_id=?, customer=? WHERE organization_id=? AND customer_id=?", params: [intoId, into.name, org, fromId] },
    ...addresses.filter((row) => row.customer_id === fromId).map((row): SqlStatement => kept.has(customerKey(row.address))
      ? { sql: "UPDATE customer_addresses SET archived_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?", params: [row.id, org] }
      : { sql: "UPDATE customer_addresses SET customer_id=?, is_default=0 WHERE id=? AND organization_id=?", params: [intoId, row.id, org] }),
    { sql: "UPDATE customers SET archived_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?", params: [fromId, org] },
    audit(principal, "merge-customers", intoId, { from: from.name, into: into.name }),
  ];
  await dbBatch(statements);
  return { done: [`${from.name} quedó unido a ${into.name}`] };
}

/** Archives a customer: their sales keep the name, and the record leaves the list. */
export async function archiveCustomer(principal: Principal, id: string): Promise<void> {
  assertEditor(principal);
  await dbBatch([
    { sql: "UPDATE customers SET archived_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?", params: [id, principal.organizationId] },
    { sql: "UPDATE sales SET customer_id=NULL WHERE organization_id=? AND customer_id=?", params: [principal.organizationId, id] },
    audit(principal, "archive-customer", id, {}),
  ]);
}
