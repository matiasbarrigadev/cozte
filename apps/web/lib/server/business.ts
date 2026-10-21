import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { supportedCurrencies, toNativeMilli, type Currency } from "@/lib/currency";
import { formatMoney, roundMoney } from "@/lib/money";
import { calculateCosts, convertToOrganizationCurrency, type CostArea, type DomainState, type ProductCost } from "@/lib/domain";
import { convertNativeMilli } from "@/lib/currency";
import { costsAsOf } from "@/lib/cost-snapshots";
import type { SnapshotRow } from "@/lib/cost-analysis";
import { fxTableNear, quotesFor } from "./fx";
import { AREA_LABELS, DELIVERY_STATUSES, DELIVERY_STATUS_LABELS, DIRECT_CHANNEL, PAYMENT_METHODS, PURCHASE_KIND_LABELS, buildBusinessView, initialPayment, nextPayment, type PaymentMethod, buildCustomerDirectory, businessToday, describeHistoryEvent, type HistoryEvent, byProximity, initialDeliveryStatus, needsDelivery, priceSale, repriceSale, saleItemsText, type Delivery, type DeliveryStatus, type Purchase, type PurchaseKind, type Sale, type SaleItem, type SalesChannel } from "@/lib/business";
import { ApiError, type Principal } from "./auth";
import { dbBatch, dbQuery, type SqlStatement, type SqlValue } from "./db";
import { customerAddressFor, loadCustomers, resolveCustomer, resolveCustomerEntry } from "./customers";
import { directoryFromCustomers } from "@/lib/customers";
import { nextDeliveryDay, zoneCost, zoneDeliveryFields, type DeliveryZone } from "@/lib/delivery-zones";
import { deliveryZoneFor, loadZones } from "./delivery-zones";
import { resolveSupplier } from "./suppliers";
import { kindForPurchase } from "@/lib/suppliers";
import { commitMutation, type Mutation } from "./mutations";
import { loadState } from "./state";

const areaSchema = z.enum(["production", "delivery", "sales", "admin"]);
const amount = z.number().nonnegative().max(1_000_000_000_000);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const channelInputSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().trim().min(2).max(80),
  deliveryMethod: z.string().trim().max(80).default(""),
  commissionPercent: z.number().min(0).max(100).default(0),
  feePerOrder: amount.default(0),
  deliveryCostPerOrder: amount.default(0),
  unitsPerOrder: z.number().positive().max(1_000_000).default(1),
  priceAdjustmentPercent: z.number().min(-90).max(100).default(0),
});

export const purchaseInputSchema = z.object({
  purchasedOn: z.iso.date(),
  description: z.string().trim().min(2).max(200),
  supplier: z.string().trim().max(120).default(""),
  amount,
  currency: z.enum(supportedCurrencies).optional(),
  kind: z.enum(["material", "expense", "fixed_payment", "investment"]),
  area: areaSchema.optional(),
  materialId: z.string().min(1).max(120).optional(),
  quantity: z.number().positive().max(1_000_000_000).optional(),
  updateMaterialPrice: z.boolean().default(true),
  /** For a purchase in another currency: organization currency per unit of it, as on the invoice. */
  exchangeRate: z.number().positive().max(1_000_000_000).optional(),
  expenseId: z.string().min(1).max(120).optional(),
  usefulLifeMonths: z.number().int().min(1).max(600).optional(),
  /** Workshop investments: spread their monthly share into each unit's cost (the person's decision). */
  includeInUnitCost: z.boolean().optional(),
  allocationBasis: z.enum(["hours", "units"]).optional(),
  documentId: z.string().min(1).max(120).optional(),
});

const deliveryStatus = z.enum(DELIVERY_STATUSES as [DeliveryStatus, ...DeliveryStatus[]]);
const text = (max: number) => z.string().trim().max(max);

/** Logistics details of a delivery; every field is optional so a correction can change just one. */
export const deliveryFieldsSchema = z.object({
  scheduledOn: z.iso.date().optional(),
  timeWindow: text(60).optional(),
  status: deliveryStatus.optional(),
  method: text(80).optional(),
  carrier: text(120).optional(),
  recipient: text(120).optional(),
  address: text(300).optional(),
  contact: text(120).optional(),
  tracking: text(120).optional(),
  note: text(500).optional(),
  deliveredOn: z.iso.date().nullable().optional(),
  /** The delivery zone; null for none. Without it, the zone comes from the address. */
  zoneId: z.string().min(1).max(120).nullable().optional(),
});

export const deliveryInputSchema = deliveryFieldsSchema.extend({
  /** An existing delivery to change, or the sale to create one for. */
  id: z.string().min(1).max(120).optional(),
  saleId: z.string().min(1).max(120).optional(),
  /** What delivering cost; stored on the sale so the month's result follows it. */
  cost: amount.optional(),
});

export const saleInputSchema = z.object({
  soldOn: z.iso.date(),
  channelId: z.string().min(1).max(120).nullable().optional(),
  items: z.array(z.object({ productId: z.string().min(1).max(120), quantity: z.number().positive().max(1_000_000_000), unitPrice: amount.optional() })).min(1).max(40),
  deliveryCost: amount.optional(),
  customer: z.string().trim().max(120).default(""),
  note: z.string().trim().max(500).default(""),
  documentId: z.string().min(1).max(120).optional(),
  /** Delivery details; without them a delivery is still created when the channel delivers. */
  delivery: deliveryFieldsSchema.optional(),
  /** What was collected; without it the sale is paid in full. 0 when the customer owes it all. */
  paidAmount: amount.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
});

export const purchasePatchSchema = z.object({
  purchasedOn: z.iso.date().optional(),
  description: z.string().trim().min(2).max(200).optional(),
  supplier: text(120).optional(),
  amount: amount.optional(),
  area: areaSchema.optional(),
  usefulLifeMonths: z.number().int().min(1).max(600).optional(),
});

export const salePatchSchema = z.object({
  soldOn: z.iso.date().optional(),
  channelId: z.string().min(1).max(120).nullable().optional(),
  customer: text(120).optional(),
  note: text(500).optional(),
  items: z.array(z.object({ productId: z.string().min(1).max(120), quantity: z.number().positive().max(1_000_000_000), unitPrice: amount.optional() })).min(1).max(40).optional(),
  deliveryCost: amount.optional(),
  fillMissingCosts: z.boolean().optional(),
  /** Collected in full now. */
  markPaid: z.boolean().optional(),
  /** Everything collected so far (not what is added now). */
  paidAmount: amount.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
});

export type ChannelInput = z.input<typeof channelInputSchema>;
export type PurchaseInput = z.input<typeof purchaseInputSchema>;
export type SaleInput = z.input<typeof saleInputSchema>;
export type SalePatchInput = z.input<typeof salePatchSchema>;
export type PurchasePatchInput = z.input<typeof purchasePatchSchema>;
export type DeliveryInput = z.input<typeof deliveryInputSchema>;
type RecordOptions = { source: "user" | "cozte"; idempotencyKey: string };

/** A second deterministic uuid for a derived write (the price update a purchase triggers). */
function derivedKey(key: string, suffix: string): string {
  const bytes = createHash("sha256").update(`${key}:${suffix}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Applies a costing change against the latest state, once per key, retrying revision races. */
async function commitOnce(principal: Principal, key: string, source: "user" | "cozte", build: (state: DomainState) => Omit<Mutation, "expectedRevision" | "idempotencyKey">) {
  const applied = await dbQuery("SELECT 1 AS found FROM change_sets WHERE organization_id=? AND idempotency_key=?", [principal.organizationId, key]);
  if (applied.length) return;
  for (let attempt = 0; ; attempt++) {
    const state = await loadState(principal);
    try {
      await commitMutation(principal, { ...build(state), expectedRevision: state.revision, idempotencyKey: key } as Mutation, { source });
      return;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409 || attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
    }
  }
}

function assertEditor(principal: Principal) {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para registrar movimientos");
}

function monthBounds(value: string): [string, string] {
  const [year, monthNumber] = value.split("-").map(Number);
  const next = monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
  return [`${value}-01`, `${next}-01`];
}

type ChannelRow = { id: string; name: string; delivery_method: string; commission_bps: number; fee_per_order_minor: number; delivery_cost_per_order_minor: number; units_per_order_milli: number; price_adjustment_bps: number };
type PurchaseRow = { id: string; purchased_on: string; description: string; supplier: string; supplier_id: string | null; amount_minor: number; kind: PurchaseKind; area: CostArea; material_name: string | null; quantity_milli: number | null; expense_id: string | null; expense_name: string | null; useful_life_months: number | null; include_in_unit_cost: number; document_id: string | null; source: "user" | "cozte" };
type SaleRow = { id: string; sold_on: string; channel_id: string | null; channel_name: string; customer: string; customer_id?: string | null; note: string; total_minor: number; selling_cost_minor: number; delivery_cost_minor: number; variable_cost_minor: number | null; production_cost_minor: number | null; document_id: string | null; source: "user" | "cozte"; paid_minor: number; payment_method: PaymentMethod | null; paid_on: string | null };
type SaleDeliveryRow = { sale_id: string; id: string; status: DeliveryStatus; scheduled_on: string; delivered_on: string | null; zone_id: string | null; zone_name: string | null; carrier: string };
type DeliveryRow = { id: string; sale_id: string; scheduled_on: string; time_window: string; status: DeliveryStatus; method: string; carrier: string; recipient: string; address: string; contact: string; tracking: string; note: string; delivered_on: string | null; zone_id: string | null; zone_name: string | null; route_position: number | null; source: "user" | "cozte"; sold_on: string; channel_id: string | null; channel_name: string; customer: string; total_minor: number; delivery_cost_minor: number };
type SaleItemRow = { sale_id: string; product_id: string; product_name: string; quantity_milli: number; unit_price_minor: number; unit_variable_cost_minor: number | null; unit_cost_minor: number | null };

const toChannel = (row: ChannelRow): SalesChannel => ({ id: row.id, name: row.name, deliveryMethod: row.delivery_method, commissionBps: row.commission_bps, feePerOrderMinor: row.fee_per_order_minor, deliveryCostPerOrderMinor: row.delivery_cost_per_order_minor, unitsPerOrderMilli: row.units_per_order_milli, priceAdjustmentBps: row.price_adjustment_bps });
const toPurchase = (row: PurchaseRow): Purchase => ({ id: row.id, purchasedOn: row.purchased_on, description: row.description, supplier: row.supplier, supplierId: row.supplier_id, amountMinor: row.amount_minor, kind: row.kind, area: row.area, materialName: row.material_name, quantityMilli: row.quantity_milli, expenseId: row.expense_id, expenseName: row.expense_name, usefulLifeMonths: row.useful_life_months, includeInUnitCost: row.include_in_unit_cost === 1, documentId: row.document_id, source: row.source });

const SALE_COLUMNS = "id, sold_on, channel_id, channel_name, customer, customer_id, note, total_minor, selling_cost_minor, delivery_cost_minor, variable_cost_minor, production_cost_minor, document_id, source, paid_minor, payment_method, paid_on";

const toSale = (row: SaleRow, items: SaleItem[], delivery: Sale["delivery"] = null): Sale => ({
  id: row.id, soldOn: row.sold_on, channelId: row.channel_id, channelName: row.channel_name, customer: row.customer, customerId: row.customer_id ?? null, note: row.note,
  totalMinor: row.total_minor, sellingCostMinor: row.selling_cost_minor, deliveryCostMinor: row.delivery_cost_minor,
  variableCostMinor: row.variable_cost_minor, productionCostMinor: row.production_cost_minor, documentId: row.document_id, source: row.source,
  paidMinor: row.paid_minor, paymentMethod: row.payment_method, paidOn: row.paid_on,
  items, delivery,
});

/** Most sales with something owed listed at once, the oldest first. */
const OWED_LIMIT = 500;

const PURCHASE_COLUMNS = "p.id, p.purchased_on, p.description, p.supplier, p.supplier_id, p.amount_minor, p.kind, p.area, m.name AS material_name, p.quantity_milli, p.expense_id, e.name AS expense_name, p.useful_life_months, p.include_in_unit_cost, p.document_id, p.source FROM purchases p LEFT JOIN materials m ON m.id=p.material_id LEFT JOIN shared_expenses e ON e.id=p.expense_id";

export async function loadChannels(principal: Principal): Promise<SalesChannel[]> {
  const rows = await dbQuery<ChannelRow>("SELECT id, name, delivery_method, commission_bps, fee_per_order_minor, delivery_cost_per_order_minor, units_per_order_milli, price_adjustment_bps FROM sales_channels WHERE organization_id=? AND archived_at IS NULL ORDER BY created_at", [principal.organizationId]);
  return rows.map(toChannel);
}

/** Most sales or purchases of one month read for its result; beyond it the result says its totals may be short. */
const MONTH_RECORDS_LIMIT = 5000;

/** Channels, the month's purchases and sales, and every investment still being spread. */
export async function loadBusinessRecords(principal: Principal, forMonth: string) {
  const [from, to] = monthBounds(month.parse(forMonth));
  const org = principal.organizationId;
  const owedWhere = "s.organization_id=? AND s.archived_at IS NULL AND s.paid_minor < s.total_minor";
  const [channels, purchases, investments, sales, items, deliveries, owed, owedItems, owedDeliveries] = await dbBatch<ChannelRow | PurchaseRow | SaleRow | SaleItemRow | SaleDeliveryRow>([
    { sql: "SELECT id, name, delivery_method, commission_bps, fee_per_order_minor, delivery_cost_per_order_minor, units_per_order_milli, price_adjustment_bps FROM sales_channels WHERE organization_id=? AND archived_at IS NULL ORDER BY created_at", params: [org] },
    { sql: `SELECT ${PURCHASE_COLUMNS} WHERE p.organization_id=? AND p.archived_at IS NULL AND p.purchased_on >= ? AND p.purchased_on < ? ORDER BY p.purchased_on DESC, p.created_at DESC LIMIT ${MONTH_RECORDS_LIMIT + 1}`, params: [org, from, to] },
    // Every investment whose useful life may still reach this month (bought on or before it).
    { sql: `SELECT ${PURCHASE_COLUMNS} WHERE p.organization_id=? AND p.archived_at IS NULL AND p.kind='investment' AND p.purchased_on < ? ORDER BY p.purchased_on DESC LIMIT 2000`, params: [org, to] },
    { sql: `SELECT ${SALE_COLUMNS} FROM sales WHERE organization_id=? AND archived_at IS NULL AND sold_on >= ? AND sold_on < ? ORDER BY sold_on DESC, created_at DESC LIMIT ${MONTH_RECORDS_LIMIT + 1}`, params: [org, from, to] },
    { sql: "SELECT si.sale_id, si.product_id, si.product_name, si.quantity_milli, si.unit_price_minor, si.unit_variable_cost_minor, si.unit_cost_minor FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.organization_id=? AND s.archived_at IS NULL AND s.sold_on >= ? AND s.sold_on < ?", params: [org, from, to] },
    { sql: "SELECT d.sale_id, d.id, d.status, d.scheduled_on, d.delivered_on, d.zone_id, z.name AS zone_name, d.carrier FROM deliveries d JOIN sales s ON s.id=d.sale_id LEFT JOIN delivery_zones z ON z.id=d.zone_id AND z.organization_id=d.organization_id WHERE s.organization_id=? AND s.archived_at IS NULL AND d.archived_at IS NULL AND s.sold_on >= ? AND s.sold_on < ?", params: [org, from, to] },
    // Sales of any month with something still owed: what customers owe is not a month's matter.
    { sql: `SELECT ${SALE_COLUMNS.split(", ").map((column) => `s.${column}`).join(", ")} FROM sales s WHERE ${owedWhere} ORDER BY s.sold_on ASC, s.created_at ASC LIMIT ${OWED_LIMIT}`, params: [org] },
    { sql: `SELECT si.sale_id, si.product_id, si.product_name, si.quantity_milli, si.unit_price_minor, si.unit_variable_cost_minor, si.unit_cost_minor FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE ${owedWhere}`, params: [org] },
    { sql: `SELECT d.sale_id, d.id, d.status, d.scheduled_on, d.delivered_on, d.zone_id, z.name AS zone_name, d.carrier FROM deliveries d JOIN sales s ON s.id=d.sale_id LEFT JOIN delivery_zones z ON z.id=d.zone_id AND z.organization_id=d.organization_id WHERE ${owedWhere} AND d.archived_at IS NULL`, params: [org] },
  ], { retrySafe: true });
  const deliveryBySale = new Map([...deliveries as SaleDeliveryRow[], ...owedDeliveries as SaleDeliveryRow[]].map((row) => [row.sale_id, { id: row.id, status: row.status, scheduledOn: row.scheduled_on, deliveredOn: row.delivered_on, zoneId: row.zone_id, zoneName: row.zone_name ?? "", carrier: row.carrier }]));
  const itemsBySale = new Map<string, SaleItem[]>();
  const seenItems = new Set<string>();
  for (const row of [...items as SaleItemRow[], ...owedItems as SaleItemRow[]]) {
    // A sale of this month with something owed comes in both lists.
    const key = `${row.sale_id}|${row.product_id}`;
    if (seenItems.has(key)) continue;
    seenItems.add(key);
    const list = itemsBySale.get(row.sale_id) ?? [];
    list.push({ productId: row.product_id, productName: row.product_name, quantityMilli: row.quantity_milli, unitPriceMinor: row.unit_price_minor, unitVariableCostMinor: row.unit_variable_cost_minor, unitCostMinor: row.unit_cost_minor });
    itemsBySale.set(row.sale_id, list);
  }
  const capped = purchases.length > MONTH_RECORDS_LIMIT || sales.length > MONTH_RECORDS_LIMIT;
  return {
    capped,
    channels: (channels as ChannelRow[]).map(toChannel),
    purchases: (purchases as PurchaseRow[]).slice(0, MONTH_RECORDS_LIMIT).map(toPurchase),
    investments: (investments as PurchaseRow[]).map(toPurchase),
    sales: (sales as SaleRow[]).slice(0, MONTH_RECORDS_LIMIT).map((row) => toSale(row, itemsBySale.get(row.id) ?? [], deliveryBySale.get(row.id) ?? null)),
    owed: (owed as SaleRow[]).map((row) => toSale(row, itemsBySale.get(row.id) ?? [], deliveryBySale.get(row.id) ?? null)),
  };
}

export async function loadBusinessView(principal: Principal, forMonth: string) {
  const [state, records] = await Promise.all([loadState(principal), loadBusinessRecords(principal, forMonth)]);
  return buildBusinessView(state, records, forMonth);
}

export async function saveChannel(principal: Principal, input: ChannelInput): Promise<{ id: string; created: boolean; channel: SalesChannel }> {
  assertEditor(principal);
  const value = channelInputSchema.parse(input);
  const [channels, place] = await Promise.all([loadChannels(principal), organizationPlace(principal)]);
  const clash = channels.find((item) => item.id !== value.id && item.name.toLocaleLowerCase("es") === value.name.toLocaleLowerCase("es"));
  if (clash) throw new ApiError(400, `Ya existe el canal ${clash.name}`);
  if (value.id && !channels.some((item) => item.id === value.id)) throw new ApiError(404, "Canal no encontrado");
  const channel: SalesChannel = {
    id: value.id ?? crypto.randomUUID(), name: value.name, deliveryMethod: value.deliveryMethod,
    commissionBps: Math.round(value.commissionPercent * 100), feePerOrderMinor: roundMoney(value.feePerOrder, place.currency),
    deliveryCostPerOrderMinor: roundMoney(value.deliveryCostPerOrder, place.currency), unitsPerOrderMilli: Math.max(1, Math.round(value.unitsPerOrder * 1000)),
    priceAdjustmentBps: Math.round(value.priceAdjustmentPercent * 100),
  };
  const fields = [channel.name, channel.deliveryMethod, channel.commissionBps, channel.feePerOrderMinor, channel.deliveryCostPerOrderMinor, channel.unitsPerOrderMilli, channel.priceAdjustmentBps];
  await dbBatch([
    value.id
      ? { sql: "UPDATE sales_channels SET name=?, delivery_method=?, commission_bps=?, fee_per_order_minor=?, delivery_cost_per_order_minor=?, units_per_order_milli=?, price_adjustment_bps=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?", params: [...fields, channel.id, principal.organizationId] }
      : { sql: "INSERT INTO sales_channels (id, organization_id, name, delivery_method, commission_bps, fee_per_order_minor, delivery_cost_per_order_minor, units_per_order_milli, price_adjustment_bps) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [channel.id, principal.organizationId, ...fields] },
    audit(principal, value.id ? "update-channel" : "create-channel", channel.id, channel),
  ]);
  return { id: channel.id, created: !value.id, channel };
}

function audit(principal: Principal, action: string, entityId: string, details: unknown): SqlStatement {
  return { sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), principal.organizationId, principal.userId, action, entityId, JSON.stringify(details)] };
}

/** Archives a channel, purchase or sale: it leaves every view and total, and the audit trail keeps it. */
export async function archiveRecord(principal: Principal, kind: "channel" | "purchase" | "sale" | "delivery", id: string, reason = ""): Promise<void> {
  assertEditor(principal);
  if (kind === "purchase") {
    const [row] = await dbQuery<{ include_in_unit_cost: number }>("SELECT include_in_unit_cost FROM purchases WHERE id=? AND organization_id=? AND kind='investment' AND archived_at IS NULL", [id, principal.organizationId]);
    if (row?.include_in_unit_cost === 1) await commitOnce(principal, crypto.randomUUID(), "user", () => ({ action: "set-investment-cost", id, include: false }));
  }
  // A sale left without its delivery is not delivered: it stops carrying a delivery cost in the month's result.
  const [owner] = kind === "delivery" ? await dbQuery<{ sale_id: string; delivery_cost_minor: number }>("SELECT d.sale_id, s.delivery_cost_minor FROM deliveries d JOIN sales s ON s.id=d.sale_id AND s.organization_id=d.organization_id WHERE d.id=? AND d.organization_id=? AND d.archived_at IS NULL", [id, principal.organizationId]) : [];
  const table = { channel: "sales_channels", purchase: "purchases", sale: "sales", delivery: "deliveries" }[kind];
  const [rows] = await dbBatch<{ id: string }>([
    { sql: `UPDATE ${table} SET archived_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND archived_at IS NULL RETURNING id`, params: [id, principal.organizationId] },
    ...(owner?.delivery_cost_minor ? [{ sql: "UPDATE sales SET delivery_cost_minor=0 WHERE id=? AND organization_id=? AND archived_at IS NULL", params: [owner.sale_id, principal.organizationId] }] : []),
    audit(principal, `archive-${kind}`, id, { reason, ...(owner?.delivery_cost_minor ? { saleId: owner.sale_id, deliveryCostBefore: owner.delivery_cost_minor, deliveryCost: 0 } : {}) }),
  ]);
  if (!rows.length) throw new ApiError(404, { channel: "Canal no encontrado", purchase: "Compra no encontrada", sale: "Venta no encontrada", delivery: "Entrega no encontrada" }[kind]);
  // A voided sale takes its delivery with it.
  if (kind === "sale") await dbBatch([{ sql: "UPDATE deliveries SET archived_at=CURRENT_TIMESTAMP WHERE sale_id=? AND organization_id=? AND archived_at IS NULL", params: [id, principal.organizationId] }]);
}

async function documentBelongs(principal: Principal, documentId: string | undefined) {
  if (!documentId) return null;
  const rows = await dbQuery<{ id: string }>("SELECT id FROM source_documents WHERE id=? AND organization_id=?", [documentId, principal.organizationId]);
  if (!rows.length) throw new ApiError(404, "No encontré ese comprobante");
  return documentId;
}

function toOrganizationAmount(state: DomainState, value: number, currency: Currency): number {
  const converted = convertToOrganizationCurrency(state, toNativeMilli(value), currency);
  if (converted === null) throw new ApiError(503, `Falta cotización vigente de ${currency} a ${state.organization.currency}`);
  return converted;
}

/**
 * What a purchase in another currency cost in the organization's: at the rate on its invoice when the person gives it,
 * else at the rate published closest to its date, else (a date before the app kept rates) at today's. Accounting books
 * a purchase at its own date's rate, not at the rate of the day it was typed in.
 */
async function purchaseAmount(state: DomainState, value: number, currency: Currency, purchasedOn: string, exchangeRate?: number): Promise<{ amountMinor: number; rate: string }> {
  const base = state.organization.currency;
  if (currency === base) return { amountMinor: roundMoney(value, base), rate: "misma moneda" };
  if (exchangeRate) return { amountMinor: roundMoney(value * exchangeRate, base), rate: `${exchangeRate} indicado en la factura` };
  const table = await fxTableNear(purchasedOn).catch(() => null);
  const quote = table ? quotesFor(base, table)[currency] : undefined;
  if (quote) return { amountMinor: convertNativeMilli(toNativeMilli(value), quote), rate: `${quote.ratePpm / 1_000_000} (${quote.source}, ${quote.asOf.slice(0, 10)})` };
  return { amountMinor: toOrganizationAmount(state, value, currency), rate: "cotización de hoy (no hay una guardada de esa fecha)" };
}

/**
 * The costs a sale carries: as they stood on its date when that day is past (each product's latest complete snapshot
 * then), today's otherwise or for a product without one. A sale typed in late keeps the cost of the day it happened.
 */
async function saleCostsOn(principal: Principal, state: DomainState, soldOn: string, productIds: string[]): Promise<ProductCost[]> {
  const costs = calculateCosts(state);
  const ids = [...new Set(productIds)];
  if (!ids.length || soldOn >= businessToday(state.organization)) return costs;
  const rows = await dbQuery<SnapshotRow>(
    `SELECT product_id, total_lot_minor, unit_minor, lines_json, warnings_json, context_json, created_at FROM (SELECT product_id, total_lot_minor, unit_minor, lines_json, warnings_json, context_json, created_at, ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY created_at DESC) AS position FROM cost_snapshots WHERE organization_id=? AND product_id IN (${ids.map(() => "?").join(", ")}) AND created_at <= ? AND unit_minor IS NOT NULL AND warnings_json='[]') WHERE position=1`,
    [principal.organizationId, ...ids, `${soldOn} 23:59:59`],
  );
  return costsAsOf(costs, rows, soldOn, state.organization.currency);
}

export type RecordedPurchase = { id: string; duplicate: boolean; purchase: Purchase; priceUpdated: { material: string; unitPrice: number; currency: Currency } | null };

/**
 * Records a purchase once (the idempotency key makes retries safe). A supply bought with its quantity also
 * updates that material's current price per purchase unit, through the normal costing change.
 */
export async function recordPurchase(principal: Principal, input: PurchaseInput, options: RecordOptions): Promise<RecordedPurchase> {
  assertEditor(principal);
  const value = purchaseInputSchema.parse(input);
  const existing = await dbQuery<PurchaseRow>(`SELECT ${PURCHASE_COLUMNS} WHERE p.organization_id=? AND p.idempotency_key=?`, [principal.organizationId, options.idempotencyKey]);
  if (existing[0]) return { id: existing[0].id, duplicate: true, purchase: toPurchase(existing[0]), priceUpdated: null };

  const state = await loadState(principal);
  const currency = value.currency ?? state.organization.currency;
  const material = value.materialId ? state.materials.find((item) => item.id === value.materialId) : undefined;
  if (value.materialId && !material) throw new ApiError(404, "Insumo no encontrado");
  const expense = value.expenseId ? state.expenses.find((item) => item.id === value.expenseId) : undefined;
  if (value.expenseId && !expense) throw new ApiError(404, "Gasto no encontrado");
  if (value.kind === "material" && !material) throw new ApiError(400, "Indica qué insumo se compró");
  if (value.kind === "fixed_payment" && !expense) throw new ApiError(400, "Indica qué gasto mensual se pagó");
  if (value.kind === "investment" && !value.usefulLifeMonths) throw new ApiError(400, "Indica cuántos meses se va a usar la inversión");
  const area: CostArea | undefined = value.area ?? (value.kind === "material" ? "production" : value.kind === "fixed_payment" ? expense?.area ?? "production" : undefined);
  if (!area) throw new ApiError(400, "Indica a qué área corresponde: producción, entregas, ventas o administración");
  const { amountMinor, rate } = await purchaseAmount(state, value.amount, currency, value.purchasedOn, value.exchangeRate);
  const documentId = await documentBelongs(principal, value.documentId);
  const supplierId = await resolveSupplier(principal, value.supplier, kindForPurchase(value.kind), options.source);

  let priceUpdated: RecordedPurchase["priceUpdated"] = null;
  if (value.kind === "material" && material && value.quantity && value.updateMaterialPrice) {
    const unitPrice = Math.round(value.amount / value.quantity * 1000) / 1000;
    await commitOnce(principal, derivedKey(options.idempotencyKey, "price"), options.source, (latest) => ({
      action: "bulk-prices", materials: [{ id: material.id, amount: unitPrice, currency }], expenses: [],
      expectedFxRates: Object.fromEntries([...new Set([...latest.materials, ...latest.expenses, { currency }].map((item) => item.currency ?? latest.organization.currency))]
        .filter((code) => code !== latest.organization.currency).flatMap((code) => latest.fxQuotes?.[code] ? [[code, latest.fxQuotes[code]!.ratePpm]] : [])),
      source: `Compra${value.supplier ? ` a ${value.supplier}` : ""} del ${value.purchasedOn}`.slice(0, 200), effectiveDate: value.purchasedOn,
    }));
    priceUpdated = { material: material.name, unitPrice, currency };
  }

  const id = crypto.randomUUID();
  const lifeMonths = value.kind === "investment" ? value.usefulLifeMonths ?? null : null;
  await dbBatch([
    { sql: "INSERT INTO purchases (id, organization_id, purchased_on, description, supplier, supplier_id, amount_minor, currency, native_amount_milli, kind, area, material_id, quantity_milli, expense_id, useful_life_months, document_id, source, actor_id, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [
      id, principal.organizationId, value.purchasedOn, value.description, value.supplier, supplierId, amountMinor, currency, toNativeMilli(value.amount), value.kind, area,
      material?.id ?? null, value.quantity ? Math.round(value.quantity * 1000) : null, expense?.id ?? null, lifeMonths, documentId, options.source, principal.userId, options.idempotencyKey,
    ] },
    audit(principal, "record-purchase", id, { ...value, amountMinor, area, ...(currency !== state.organization.currency ? { exchangeRate: rate } : {}), source: options.source }),
  ]);
  const includeInUnitCost = value.kind === "investment" && area === "production" && Boolean(value.includeInUnitCost);
  if (includeInUnitCost) await commitOnce(principal, derivedKey(options.idempotencyKey, "investment"), options.source, () => ({ action: "set-investment-cost", id, include: true, allocationBasis: value.allocationBasis ?? "hours" }));
  return {
    id, duplicate: false, priceUpdated,
    purchase: { id, purchasedOn: value.purchasedOn, description: value.description, supplier: value.supplier, supplierId, amountMinor, kind: value.kind, area, materialName: material?.name ?? null, quantityMilli: value.quantity ? Math.round(value.quantity * 1000) : null, expenseId: expense?.id ?? null, expenseName: expense?.name ?? null, usefulLifeMonths: lifeMonths, includeInUnitCost, documentId, source: options.source },
  };
}

export type RecordedSale = {
  id: string; duplicate: boolean; sale: Omit<Sale, "id"> & { id: string };
  /** Where the delivery goes; or, when the sale has no delivery, the customer's saved address. */
  deliveryAddress?: string | null; customerAddress?: string | null;
  /** Whether the sale created its customer now. */
  newCustomer?: boolean;
};

/** Records a sale with its channel's rules; prices and costs are fixed now so the month's result does not drift. */
export async function recordSale(principal: Principal, input: SaleInput, options: RecordOptions): Promise<RecordedSale> {
  assertEditor(principal);
  const value = saleInputSchema.parse(input);
  const duplicate = await dbQuery<{ id: string }>("SELECT id FROM sales WHERE organization_id=? AND idempotency_key=?", [principal.organizationId, options.idempotencyKey]);
  const [state, channels] = await Promise.all([loadState(principal), loadChannels(principal)]);
  const channel = value.channelId ? channels.find((item) => item.id === value.channelId) : DIRECT_CHANNEL;
  if (!channel) throw new ApiError(404, "Canal no encontrado");
  const priced = priceSale(state, await saleCostsOn(principal, state, value.soldOn, value.items.map((item) => item.productId)), channel, value.items, value.deliveryCost);
  if (priced.problems.length) throw new ApiError(400, priced.problems.join(". "));
  const sale = {
    soldOn: value.soldOn, channelId: channel.id === DIRECT_CHANNEL.id ? null : channel.id, channelName: channel.name, customer: value.customer, note: value.note,
    totalMinor: priced.totalMinor, sellingCostMinor: priced.sellingCostMinor, deliveryCostMinor: priced.deliveryCostMinor,
    variableCostMinor: priced.variableCostMinor, productionCostMinor: priced.productionCostMinor,
    documentId: await documentBelongs(principal, value.documentId), source: options.source, items: priced.items,
    ...initialPayment(priced.totalMinor, value, value.soldOn),
  };
  if (duplicate[0]) return { id: duplicate[0].id, duplicate: true, sale: { id: duplicate[0].id, ...sale } };
  const id = crypto.randomUUID();
  const entry = await resolveCustomerEntry(principal, value.customer, options.source);
  const customerId = entry?.id ?? null;
  const delivers = Boolean(value.delivery) || needsDelivery(channel, value.deliveryCost);
  // Without an address the delivery goes to the customer's default one; a new address is kept in their record.
  const place = delivers && customerId ? await customerAddressFor(principal, customerId, value.delivery ?? {}) : null;
  const given = place ? { ...value.delivery, address: place.address, recipient: value.delivery?.recipient || place.recipient || undefined, contact: value.delivery?.contact || place.contact || undefined } : value.delivery ?? {};
  // The zone of the address sets how it goes, on which day and, unless a cost was given, what it costs.
  const zone = delivers ? await deliveryZoneFor(principal, { zoneId: value.delivery?.zoneId, zone: place?.zone, address: given.address }) : null;
  const fields = zone ? withZone(given, zone, value.soldOn) : given;
  const fromZone = zone && value.deliveryCost === undefined ? zoneCost(zone) : null;
  if (fromZone !== null) sale.deliveryCostMinor = fromZone;
  const delivery = delivers ? newDeliveryRow(principal, id, value.soldOn, channel, value.customer, fields, options.source, businessToday(state.organization.currency), place?.id ?? null, zone?.id ?? null) : null;
  const [saved] = !delivers && customerId ? await dbQuery<{ address: string }>("SELECT address FROM customer_addresses WHERE organization_id=? AND customer_id=? AND archived_at IS NULL ORDER BY is_default DESC, created_at DESC LIMIT 1", [principal.organizationId, customerId]) : [];
  await dbBatch([
    { sql: "INSERT INTO sales (id, organization_id, sold_on, channel_id, channel_name, customer, customer_id, note, total_minor, selling_cost_minor, delivery_cost_minor, variable_cost_minor, production_cost_minor, document_id, source, actor_id, idempotency_key, paid_minor, payment_method, paid_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [
      id, principal.organizationId, sale.soldOn, sale.channelId, sale.channelName, sale.customer, customerId, sale.note, sale.totalMinor, sale.sellingCostMinor, sale.deliveryCostMinor,
      sale.variableCostMinor, sale.productionCostMinor, sale.documentId, options.source, principal.userId, options.idempotencyKey, sale.paidMinor, sale.paymentMethod, sale.paidOn,
    ] },
    ...priced.items.map((item): SqlStatement => ({ sql: "INSERT INTO sale_items (sale_id, product_id, product_name, quantity_milli, unit_price_minor, unit_variable_cost_minor, unit_cost_minor) VALUES (?, ?, ?, ?, ?, ?, ?)", params: [id, item.productId, item.productName, item.quantityMilli, item.unitPriceMinor, item.unitVariableCostMinor, item.unitCostMinor] })),
    ...(delivery ? [delivery.statement] : []),
    audit(principal, "record-sale", id, { ...value, totalMinor: sale.totalMinor, channel: channel.name, source: options.source }),
  ]);
  return {
    id, duplicate: false, sale: { id, ...sale, delivery: delivery ? { id: delivery.id, status: delivery.status, scheduledOn: delivery.scheduledOn, zoneId: zone?.id ?? null, zoneName: zone?.name ?? "", carrier: fields.carrier ?? "" } : null },
    deliveryAddress: delivery ? fields.address || null : null, customerAddress: saved?.address ?? null, newCustomer: entry?.created ?? false,
  };
}

/** Where the business is, for its calendar: its location when known, or its currency. */
export async function organizationPlace(principal: Principal): Promise<{ currency: string | null; country: string | null; timeZone: string | null }> {
  const [row] = await dbQuery<{ currency: string | null; country: string | null; time_zone: string | null }>("SELECT currency, country, time_zone FROM organizations WHERE id=?", [principal.organizationId]);
  return { currency: row?.currency ?? null, country: row?.country ?? null, timeZone: row?.time_zone ?? null };
}

/** Today's date where the business is. */
export const organizationToday = async (principal: Principal) => businessToday(await organizationPlace(principal));

/** A delivery's fields completed by its zone: how it goes, who takes it and the zone's next day, unless given. */
function withZone(fields: z.infer<typeof deliveryFieldsSchema>, zone: DeliveryZone, soldOn: string): z.infer<typeof deliveryFieldsSchema> {
  const given = zoneDeliveryFields(zone);
  return { ...fields, method: fields.method || given.method, carrier: fields.carrier || given.carrier || undefined, scheduledOn: fields.scheduledOn ?? nextDeliveryDay(zone, soldOn) };
}

function newDeliveryRow(principal: Principal, saleId: string, soldOn: string, channel: Pick<SalesChannel, "deliveryMethod">, customer: string, fields: z.infer<typeof deliveryFieldsSchema>, source: "user" | "cozte", today: string, customerAddressId: string | null = null, zoneId: string | null = null) {
  const id = crypto.randomUUID();
  const scheduledOn = fields.scheduledOn ?? soldOn;
  const status = fields.status ?? initialDeliveryStatus(scheduledOn, today);
  const deliveredOn = status === "delivered" ? fields.deliveredOn ?? (scheduledOn < today ? scheduledOn : today) : null;
  return {
    id, status, scheduledOn,
    statement: { sql: "INSERT INTO deliveries (id, organization_id, sale_id, scheduled_on, time_window, status, method, carrier, recipient, address, contact, tracking, note, delivered_on, source, actor_id, customer_address_id, zone_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [
      id, principal.organizationId, saleId, scheduledOn, fields.timeWindow ?? "", status, fields.method ?? channel.deliveryMethod ?? "", fields.carrier ?? "", fields.recipient ?? customer, fields.address ?? "", fields.contact ?? "", fields.tracking ?? "", fields.note ?? "", deliveredOn, source, principal.userId, customerAddressId, zoneId,
    ] } satisfies SqlStatement,
  };
}

async function loadSale(principal: Principal, id: string): Promise<Sale> {
  const [rows, items] = await dbBatch<SaleRow | SaleItemRow>([
    { sql: `SELECT ${SALE_COLUMNS} FROM sales WHERE id=? AND organization_id=? AND archived_at IS NULL`, params: [id, principal.organizationId] },
    { sql: "SELECT si.sale_id, si.product_id, si.product_name, si.quantity_milli, si.unit_price_minor, si.unit_variable_cost_minor, si.unit_cost_minor FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.sale_id=? AND s.organization_id=?", params: [id, principal.organizationId] },
  ], { retrySafe: true });
  const row = (rows as SaleRow[])[0];
  if (!row) throw new ApiError(404, "Venta no encontrada");
  return toSale(row, (items as SaleItemRow[]).map((item) => ({ productId: item.product_id, productName: item.product_name, quantityMilli: item.quantity_milli, unitPriceMinor: item.unit_price_minor, unitVariableCostMinor: item.unit_variable_cost_minor, unitCostMinor: item.unit_cost_minor })));
}

/**
 * Corrects a sale in place (date, channel, customer, note, products, delivery cost). Prices and product costs of
 * the moment are kept unless changed; the month's result follows. The audit trail keeps the version before.
 */
export async function updateSale(principal: Principal, id: string, input: SalePatchInput, source: "user" | "cozte"): Promise<Sale> {
  assertEditor(principal);
  const patch = salePatchSchema.parse(input);
  const [sale, state, channels] = await Promise.all([loadSale(principal, id), loadState(principal), loadChannels(principal)]);
  // Another channel brings its delivery cost, unless the delivery already has one of its own: none if it was cancelled,
  // its zone's when the zone sets one (the same rule as when the sale was recorded).
  if (patch.channelId !== undefined && (patch.channelId ?? null) !== sale.channelId && patch.deliveryCost === undefined) {
    const [delivery] = await dbQuery<{ status: DeliveryStatus; zone_id: string | null }>("SELECT status, zone_id FROM deliveries WHERE sale_id=? AND organization_id=? AND archived_at IS NULL", [id, principal.organizationId]);
    const zone = delivery?.zone_id ? (await loadZones(principal)).find((item) => item.id === delivery.zone_id) : undefined;
    const own = delivery?.status === "cancelled" ? 0 : zone ? zoneCost(zone) : null;
    if (own !== null) patch.deliveryCost = own;
  }
  // New products and missing costs take the cost of the sale's day.
  const costs = patch.items || patch.fillMissingCosts ? await saleCostsOn(principal, state, patch.soldOn ?? sale.soldOn, [...sale.items.map((item) => item.productId), ...(patch.items ?? []).map((item) => item.productId)]) : calculateCosts(state);
  const { sale: next, problems } = repriceSale(sale, patch, state, costs, channels);
  if (problems.length) throw new ApiError(400, problems.join(". "));
  const payment = nextPayment(sale, next.totalMinor, patch, await organizationToday(principal));
  const customerChange: SqlStatement[] = patch.customer !== undefined && patch.customer.trim() !== sale.customer
    ? [{ sql: "UPDATE sales SET customer_id=? WHERE id=? AND organization_id=?", params: [await resolveCustomer(principal, patch.customer, source), id, principal.organizationId] }]
    : [];
  await dbBatch([
    ...customerChange,
    { sql: "UPDATE sales SET sold_on=?, channel_id=?, channel_name=?, customer=?, note=?, total_minor=?, selling_cost_minor=?, delivery_cost_minor=?, variable_cost_minor=?, production_cost_minor=?, paid_minor=?, payment_method=?, paid_on=? WHERE id=? AND organization_id=? AND archived_at IS NULL", params: [
      next.soldOn, next.channelId, next.channelName, next.customer, next.note, next.totalMinor, next.sellingCostMinor, next.deliveryCostMinor, next.variableCostMinor, next.productionCostMinor, payment.paidMinor, payment.paymentMethod, payment.paidOn, id, principal.organizationId,
    ] },
    ...(patch.items || patch.fillMissingCosts ? [
      { sql: "DELETE FROM sale_items WHERE sale_id=? AND sale_id IN (SELECT id FROM sales WHERE organization_id=?)", params: [id, principal.organizationId] },
      ...next.items.map((item): SqlStatement => ({ sql: "INSERT INTO sale_items (sale_id, product_id, product_name, quantity_milli, unit_price_minor, unit_variable_cost_minor, unit_cost_minor) VALUES (?, ?, ?, ?, ?, ?, ?)", params: [id, item.productId, item.productName, item.quantityMilli, item.unitPriceMinor, item.unitVariableCostMinor, item.unitCostMinor] })),
    ] : []),
    audit(principal, "update-sale", id, { before: sale, patch, source }),
  ]);
  return { ...sale, ...next, ...payment };
}

/**
 * The changes of a sale (with its delivery), a delivery (with its sale) or a purchase, newest first: who did it
 * (you, Cozte or someone of the team) and what changed.
 */
export async function loadRecordHistory(principal: Principal, kind: "sale" | "delivery" | "purchase", id: string, names: (userIds: string[]) => Promise<Record<string, string>>): Promise<HistoryEvent[]> {
  const org = principal.organizationId;
  let ids = [id];
  if (kind === "sale") ids = [id, ...(await dbQuery<{ id: string }>("SELECT id FROM deliveries WHERE sale_id=? AND organization_id=?", [id, org])).map((row) => row.id)];
  if (kind === "delivery") ids = [id, ...(await dbQuery<{ sale_id: string }>("SELECT sale_id FROM deliveries WHERE id=? AND organization_id=?", [id, org])).map((row) => row.sale_id)];
  const [rows, organizations] = await dbBatch<{ id: string; actor_id: string; action: string; details_json: string; created_at: string } | { currency: string }>([
    { sql: `SELECT id, actor_id, action, details_json, created_at FROM audit_events WHERE organization_id=? AND entity_id IN (${ids.map(() => "?").join(", ")}) ORDER BY created_at DESC LIMIT 100`, params: [org, ...ids] },
    { sql: "SELECT currency FROM organizations WHERE id=?", params: [org] },
  ], { retrySafe: true });
  const events = rows as { id: string; actor_id: string; action: string; details_json: string; created_at: string }[];
  const currency = (organizations as { currency: string }[])[0]?.currency ?? "CLP";
  const money = (value: number) => formatMoney(value, currency);
  // "system" marks corrections made by a data migration, not by a person.
  const others = [...new Set(events.map((event) => event.actor_id).filter((actor) => actor !== principal.userId && actor !== "system"))];
  const known = others.length ? await names(others).catch(() => ({} as Record<string, string>)) : {};
  return events.map((event) => {
    let details: Record<string, unknown> = {};
    try { details = JSON.parse(event.details_json) as Record<string, unknown>; } catch { /* Old or malformed details: title only. */ }
    const byCozte = details.source === "cozte";
    if (event.actor_id === "system") return { id: event.id, at: event.created_at, who: "Corrección automática", byCozte: false, ...describeHistoryEvent(event.action, details, money) };
    const person = event.actor_id === principal.userId ? "Tú" : known[event.actor_id] ?? "Alguien del equipo";
    return { id: event.id, at: event.created_at, who: byCozte ? `Cozte (a pedido de ${person === "Tú" ? "ti" : person})` : person, byCozte, ...describeHistoryEvent(event.action, details, money) };
  });
}

/** Customers, recipients, addresses and carriers used in the last sales, for suggestions. */
export async function loadCustomerDirectory(principal: Principal) {
  const [{ customers }, rows] = await Promise.all([
    loadCustomers(principal),
    dbQuery<{ customer: string; sold_on: string; recipient: string | null; address: string | null; contact: string | null; carrier: string | null }>("SELECT s.customer, s.sold_on, d.recipient, d.address, d.contact, d.carrier FROM sales s LEFT JOIN deliveries d ON d.sale_id=s.id AND d.archived_at IS NULL WHERE s.organization_id=? AND s.archived_at IS NULL ORDER BY s.sold_on DESC LIMIT 2000", [principal.organizationId]),
  ]);
  const typed = buildCustomerDirectory(rows.map((row) => ({ customer: row.customer, soldOn: row.sold_on, recipient: row.recipient, address: row.address, contact: row.contact, carrier: row.carrier })));
  return directoryFromCustomers(customers, typed);
}

/**
 * Corrects a purchase: date, description, supplier, area, amount or useful life. An investment already spread into
 * each unit's cost keeps its amount, life, area and date until the person takes it out of the unit cost, so product
 * costs never move without that decision. A material purchase does not change the material's price again.
 */
export async function updatePurchase(principal: Principal, id: string, input: PurchasePatchInput, source: "user" | "cozte"): Promise<{ done: string[] }> {
  assertEditor(principal);
  const patch = purchasePatchSchema.parse(input);
  const org = principal.organizationId;
  const [rows, organizations] = await dbBatch<{ kind: PurchaseKind; include_in_unit_cost: number; description: string } | { currency: string }>([
    { sql: "SELECT kind, include_in_unit_cost, description FROM purchases WHERE id=? AND organization_id=? AND archived_at IS NULL", params: [id, org] },
    { sql: "SELECT currency FROM organizations WHERE id=?", params: [org] },
  ], { retrySafe: true });
  const row = (rows as { kind: PurchaseKind; include_in_unit_cost: number; description: string }[])[0];
  if (!row) throw new ApiError(404, "Compra no encontrada");
  if (row.kind === "investment" && row.include_in_unit_cost === 1 && (patch.amount !== undefined || patch.usefulLifeMonths !== undefined || patch.area !== undefined || patch.purchasedOn !== undefined)) {
    throw new ApiError(400, "Esta inversión se suma al costo de cada producto: para cambiar su monto, vida útil, área o fecha, primero quítala del costo en Gastos de la empresa.");
  }
  if (patch.usefulLifeMonths !== undefined && row.kind !== "investment") throw new ApiError(400, "Solo las inversiones tienen vida útil");
  if (patch.area !== undefined && row.kind === "material" && patch.area !== "production") throw new ApiError(400, "Un insumo siempre es de producción");
  const sets: string[] = [];
  const params: SqlValue[] = [];
  const set = (column: string, value: SqlValue) => { sets.push(`${column}=?`); params.push(value); };
  if (patch.purchasedOn !== undefined) set("purchased_on", patch.purchasedOn);
  if (patch.description !== undefined) set("description", patch.description);
  if (patch.supplier !== undefined) {
    set("supplier", patch.supplier);
    set("supplier_id", await resolveSupplier(principal, patch.supplier, kindForPurchase(row.kind), source));
  }
  if (patch.area !== undefined) set("area", patch.area);
  if (patch.usefulLifeMonths !== undefined) set("useful_life_months", patch.usefulLifeMonths);
  if (patch.amount !== undefined) {
    set("amount_minor", roundMoney(patch.amount, (organizations as { currency: string }[])[0]?.currency));
    set("currency", (organizations as { currency: string }[])[0]?.currency ?? "CLP");
    set("native_amount_milli", Math.round(patch.amount * 1000));
  }
  if (!sets.length) return { done: [] };
  await dbBatch([
    { sql: `UPDATE purchases SET ${sets.join(", ")} WHERE id=? AND organization_id=? AND archived_at IS NULL`, params: [...params, id, org] },
    audit(principal, "update-purchase", id, { patch, source }),
  ]);
  return { done: [`Compra «${patch.description ?? row.description}» corregida`] };
}

/** Deliveries of a month plus every open one (pending, on the way or failed), closest to today first. */
export async function loadDeliveries(principal: Principal, forMonth: string): Promise<Delivery[]> {
  const [from, to] = monthBounds(month.parse(forMonth));
  const org = principal.organizationId;
  const scope = "d.organization_id=? AND d.archived_at IS NULL AND s.archived_at IS NULL AND ((d.scheduled_on >= ? AND d.scheduled_on < ?) OR d.status IN ('pending', 'on_the_way', 'failed'))";
  const [rows, items] = await dbBatch<DeliveryRow | SaleItemRow>([
    { sql: `SELECT d.id, d.sale_id, d.scheduled_on, d.time_window, d.status, d.method, d.carrier, d.recipient, d.address, d.contact, d.tracking, d.note, d.delivered_on, d.zone_id, z.name AS zone_name, d.route_position, d.source, s.sold_on, s.channel_id, s.channel_name, s.customer, s.total_minor, s.delivery_cost_minor FROM deliveries d JOIN sales s ON s.id=d.sale_id LEFT JOIN delivery_zones z ON z.id=d.zone_id AND z.organization_id=d.organization_id WHERE ${scope} LIMIT 800`, params: [org, from, to] },
    { sql: `SELECT si.sale_id, si.product_id, si.product_name, si.quantity_milli, si.unit_price_minor, si.unit_variable_cost_minor, si.unit_cost_minor FROM sale_items si JOIN deliveries d ON d.sale_id=si.sale_id JOIN sales s ON s.id=si.sale_id WHERE ${scope}`, params: [org, from, to] },
  ], { retrySafe: true });
  const itemsBySale = new Map<string, SaleItemRow[]>();
  for (const row of items as SaleItemRow[]) itemsBySale.set(row.sale_id, [...itemsBySale.get(row.sale_id) ?? [], row]);
  const list = (rows as DeliveryRow[]).map((row): Delivery => ({
    id: row.id, saleId: row.sale_id, scheduledOn: row.scheduled_on, timeWindow: row.time_window, status: row.status, method: row.method, carrier: row.carrier,
    recipient: row.recipient, address: row.address, contact: row.contact, tracking: row.tracking, note: row.note, deliveredOn: row.delivered_on, zoneId: row.zone_id, zoneName: row.zone_name ?? "", routePosition: row.route_position, source: row.source,
    costMinor: row.delivery_cost_minor,
    sale: { soldOn: row.sold_on, channelId: row.channel_id, channelName: row.channel_name, customer: row.customer, totalMinor: row.total_minor, items: saleItemsText((itemsBySale.get(row.sale_id) ?? []).map((item) => ({ productName: item.product_name, quantityMilli: item.quantity_milli }))) },
  }));
  return byProximity(list, (item) => item.scheduledOn, await organizationToday(principal));
}

/** What a delivery brought back from cancelled costs: its zone's cost when the zone has one, else its sale's channel's. */
async function restoredDeliveryCost(principal: Principal, saleId: string, zone: DeliveryZone | string | null): Promise<number> {
  const found = typeof zone === "string" ? (await loadZones(principal)).find((item) => item.id === zone) ?? null : zone;
  const fromZone = found ? zoneCost(found) : null;
  if (fromZone !== null) return fromZone;
  const [sale] = await dbQuery<{ channel_id: string | null }>("SELECT channel_id FROM sales WHERE id=? AND organization_id=?", [saleId, principal.organizationId]);
  const channel = sale?.channel_id ? (await loadChannels(principal)).find((item) => item.id === sale.channel_id) : undefined;
  return channel?.deliveryCostPerOrderMinor ?? 0;
}

const DELIVERY_COLUMNS: Record<string, string> = { scheduledOn: "scheduled_on", timeWindow: "time_window", status: "status", method: "method", carrier: "carrier", recipient: "recipient", address: "address", contact: "contact", tracking: "tracking", note: "note", deliveredOn: "delivered_on" };

/**
 * Creates a sale's delivery or changes one. Marking it delivered stamps today unless a date is given; its cost goes
 * to the sale, so the month's result and every view follow.
 */
export async function saveDelivery(principal: Principal, input: DeliveryInput, source: "user" | "cozte"): Promise<{ id: string; created: boolean; done: string[] }> {
  assertEditor(principal);
  const value = deliveryInputSchema.parse(input);
  const org = principal.organizationId;
  let id = value.id;
  let saleId = value.saleId;
  let created = false;
  const statements: SqlStatement[] = [];
  const done: string[] = [];
  // A delivery cost set by the zone, a cancellation or a restore; the audit keeps it with the change.
  let autoCost: number | undefined;
  if (id) {
    const [row] = await dbQuery<{ sale_id: string; status: DeliveryStatus; delivered_on: string | null; zone_id: string | null; scheduled_on: string }>("SELECT d.sale_id, d.status, d.delivered_on, d.zone_id, d.scheduled_on FROM deliveries d WHERE d.id=? AND d.organization_id=? AND d.archived_at IS NULL", [id, org]);
    if (!row) throw new ApiError(404, "Entrega no encontrada");
    saleId = row.sale_id;
    const fields = { ...value };
    if (fields.status === "delivered" && row.status !== "delivered" && fields.deliveredOn === undefined) fields.deliveredOn = await organizationToday(principal);
    if (fields.status && fields.status !== "delivered" && fields.deliveredOn === undefined) fields.deliveredOn = null;
    const sets = Object.entries(DELIVERY_COLUMNS).filter(([key]) => fields[key as keyof typeof fields] !== undefined);
    if (sets.length) statements.push({ sql: `UPDATE deliveries SET ${sets.map(([, column]) => `${column}=?`).join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`, params: [...sets.map(([key]) => (fields[key as keyof typeof fields] ?? null) as string | null), id, org] });
    // Another day means another route: it loses its place in the old one.
    if (value.scheduledOn !== undefined && value.scheduledOn !== row.scheduled_on) statements.push({ sql: "UPDATE deliveries SET route_position=NULL WHERE id=? AND organization_id=?", params: [id, org] });
    // A new address for this delivery is kept in the customer's record, and the delivery points to it.
    let placeZone: string | null = null;
    if (value.address?.trim()) {
      const [owner] = await dbQuery<{ customer_id: string | null }>("SELECT customer_id FROM sales WHERE id=? AND organization_id=?", [saleId, org]);
      const place = owner?.customer_id ? await customerAddressFor(principal, owner.customer_id, { address: value.address, recipient: value.recipient, contact: value.contact }) : null;
      if (place) statements.push({ sql: "UPDATE deliveries SET customer_address_id=? WHERE id=? AND organization_id=?", params: [place.id, id, org] });
      placeZone = place?.zone ?? null;
    }
    // A zone chosen by hand, or an address that falls in another zone, moves the delivery there.
    let zoneAfter: DeliveryZone | null | undefined;
    if (value.zoneId !== undefined || value.address?.trim()) {
      const zones = await loadZones(principal);
      const zone = value.zoneId !== undefined ? await deliveryZoneFor(principal, { zoneId: value.zoneId }, zones) : zones.length ? await deliveryZoneFor(principal, { zone: placeZone, address: value.address }, zones) : undefined;
      if (zone !== undefined && (zone?.id ?? null) !== row.zone_id) {
        zoneAfter = zone;
        // Leaving it without a zone keeps how it goes and who takes it.
        const given = zone ? zoneDeliveryFields(zone) : null;
        statements.push(given
          ? { sql: "UPDATE deliveries SET zone_id=?, method=?, carrier=? WHERE id=? AND organization_id=?", params: [zone!.id, value.method ?? given.method, value.carrier ?? given.carrier, id, org] }
          : { sql: "UPDATE deliveries SET zone_id=NULL WHERE id=? AND organization_id=?", params: [id, org] });
        const cost = zone && value.cost === undefined ? zoneCost(zone) : null;
        if (cost !== null) { statements.push({ sql: "UPDATE sales SET delivery_cost_minor=? WHERE id=? AND organization_id=? AND archived_at IS NULL", params: [cost, saleId, org] }); autoCost = cost; }
        done.push(zone ? `Zona: ${zone.name}${cost !== null ? " (costo de la zona aplicado)" : ""}` : "Entrega sin zona");
      }
    }
    // A cancelled delivery costs nothing; bringing it back restores its zone's cost, or else its channel's.
    const cancelling = value.status === "cancelled" && row.status !== "cancelled";
    const reopening = row.status === "cancelled" && value.status !== undefined && value.status !== "cancelled";
    if (value.cost === undefined && (cancelling || reopening)) {
      const cost = cancelling ? 0 : await restoredDeliveryCost(principal, saleId, zoneAfter !== undefined ? zoneAfter : row.zone_id);
      statements.push({ sql: "UPDATE sales SET delivery_cost_minor=? WHERE id=? AND organization_id=? AND archived_at IS NULL", params: [cost, saleId, org] });
      autoCost = cost;
      done.push(cancelling ? "Costo de entrega en 0: la entrega se canceló" : "Costo de entrega restituido");
    }
    if (value.status) done.push(`Entrega: ${DELIVERY_STATUS_LABELS[value.status]}`);
    if (value.scheduledOn) done.push(`Entrega programada para el ${value.scheduledOn}`);
    if (sets.some(([key]) => !["status", "scheduledOn", "deliveredOn"].includes(key))) done.push("Datos de la entrega actualizados");
  } else {
    if (!saleId) throw new ApiError(400, "Indica la venta a entregar");
    const [sale] = await dbQuery<{ sold_on: string; customer: string; channel_id: string | null; customer_id: string | null; delivery_cost_minor: number }>("SELECT sold_on, customer, channel_id, customer_id, delivery_cost_minor FROM sales WHERE id=? AND organization_id=? AND archived_at IS NULL", [saleId, org]);
    if (!sale) throw new ApiError(404, "Venta no encontrada");
    const [existing] = await dbQuery<{ id: string }>("SELECT id FROM deliveries WHERE sale_id=? AND organization_id=? AND archived_at IS NULL", [saleId, org]);
    if (existing) throw new ApiError(409, "Esa venta ya tiene una entrega: cámbiala en lugar de crear otra");
    const channel = sale.channel_id ? (await loadChannels(principal)).find((item) => item.id === sale.channel_id) ?? DIRECT_CHANNEL : DIRECT_CHANNEL;
    const place = sale.customer_id ? await customerAddressFor(principal, sale.customer_id, value) : null;
    const given = place ? { ...value, address: place.address, recipient: value.recipient || place.recipient || undefined, contact: value.contact || place.contact || undefined } : value;
    const zone = await deliveryZoneFor(principal, { zoneId: value.zoneId, zone: place?.zone, address: given.address });
    const fields = zone ? withZone(given, zone, sale.sold_on) : given;
    const row = newDeliveryRow(principal, saleId, sale.sold_on, channel, sale.customer, fields, source, await organizationToday(principal), place?.id ?? null, zone?.id ?? null);
    // Its zone's cost; without one, a sale that carried no delivery cost takes its channel's (a delivery removed and made again).
    const cost = value.cost !== undefined || row.status === "cancelled" ? null : zone ? zoneCost(zone) : null;
    const fallback = value.cost === undefined && cost === null && row.status !== "cancelled" && !sale.delivery_cost_minor && channel.deliveryCostPerOrderMinor > 0 ? channel.deliveryCostPerOrderMinor : null;
    if (cost !== null || fallback !== null) { statements.push({ sql: "UPDATE sales SET delivery_cost_minor=? WHERE id=? AND organization_id=? AND archived_at IS NULL", params: [cost ?? fallback, saleId, org] }); autoCost = (cost ?? fallback)!; }
    id = row.id;
    created = true;
    statements.push(row.statement);
    done.push(`Entrega ${row.status === "delivered" ? "registrada como entregada" : `programada para el ${row.scheduledOn}`}${zone ? ` (zona ${zone.name})` : ""}`);
  }
  if (value.cost !== undefined) {
    statements.push({ sql: "UPDATE sales SET delivery_cost_minor=? WHERE id=? AND organization_id=? AND archived_at IS NULL", params: [roundMoney(value.cost, (await organizationPlace(principal)).currency), saleId!, org] });
    done.push("Costo de entrega actualizado");
  }
  if (!statements.length) return { id: id!, created, done: [] };
  statements.push(audit(principal, created ? "create-delivery" : "update-delivery", id!, { ...value, ...(value.cost === undefined && autoCost !== undefined ? { cost: autoCost } : {}), source }));
  await dbBatch(statements);
  return { id: id!, created, done };
}

/** Plain-language one-liners for receipts and the audit of what was recorded. */
export const describePurchase = (purchase: Purchase, currency: string) =>
  `${PURCHASE_KIND_LABELS[purchase.kind]} · ${AREA_LABELS[purchase.area]} · ${purchase.description}: ${purchase.amountMinor} ${currency}`;
