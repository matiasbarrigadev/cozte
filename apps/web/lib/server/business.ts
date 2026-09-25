import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { supportedCurrencies, toNativeMilli, type Currency } from "@/lib/currency";
import { calculateCosts, convertToOrganizationCurrency, type CostArea, type DomainState } from "@/lib/domain";
import { AREA_LABELS, DIRECT_CHANNEL, PURCHASE_KIND_LABELS, buildBusinessView, priceSale, type Purchase, type PurchaseKind, type Sale, type SaleItem, type SalesChannel } from "@/lib/business";
import { ApiError, type Principal } from "./auth";
import { dbBatch, dbQuery, type SqlStatement } from "./db";
import { commitMutation } from "./mutations";
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
  expenseId: z.string().min(1).max(120).optional(),
  usefulLifeMonths: z.number().int().min(1).max(600).optional(),
  documentId: z.string().min(1).max(120).optional(),
});

export const saleInputSchema = z.object({
  soldOn: z.iso.date(),
  channelId: z.string().min(1).max(120).nullable().optional(),
  items: z.array(z.object({ productId: z.string().min(1).max(120), quantity: z.number().positive().max(1_000_000_000), unitPrice: amount.optional() })).min(1).max(40),
  deliveryCost: amount.optional(),
  customer: z.string().trim().max(120).default(""),
  note: z.string().trim().max(500).default(""),
  documentId: z.string().min(1).max(120).optional(),
});

export type ChannelInput = z.input<typeof channelInputSchema>;
export type PurchaseInput = z.input<typeof purchaseInputSchema>;
export type SaleInput = z.input<typeof saleInputSchema>;
type RecordOptions = { source: "user" | "cozte"; idempotencyKey: string };

/** A second deterministic uuid for a derived write (the price update a purchase triggers). */
function derivedKey(key: string, suffix: string): string {
  const bytes = createHash("sha256").update(`${key}:${suffix}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
type PurchaseRow = { id: string; purchased_on: string; description: string; supplier: string; amount_minor: number; kind: PurchaseKind; area: CostArea; material_name: string | null; quantity_milli: number | null; expense_id: string | null; expense_name: string | null; useful_life_months: number | null; document_id: string | null; source: "user" | "cozte" };
type SaleRow = { id: string; sold_on: string; channel_id: string | null; channel_name: string; customer: string; note: string; total_minor: number; selling_cost_minor: number; delivery_cost_minor: number; variable_cost_minor: number | null; production_cost_minor: number | null; document_id: string | null; source: "user" | "cozte" };
type SaleItemRow = { sale_id: string; product_id: string; product_name: string; quantity_milli: number; unit_price_minor: number; unit_variable_cost_minor: number | null; unit_cost_minor: number | null };

const toChannel = (row: ChannelRow): SalesChannel => ({ id: row.id, name: row.name, deliveryMethod: row.delivery_method, commissionBps: row.commission_bps, feePerOrderMinor: row.fee_per_order_minor, deliveryCostPerOrderMinor: row.delivery_cost_per_order_minor, unitsPerOrderMilli: row.units_per_order_milli, priceAdjustmentBps: row.price_adjustment_bps });
const toPurchase = (row: PurchaseRow): Purchase => ({ id: row.id, purchasedOn: row.purchased_on, description: row.description, supplier: row.supplier, amountMinor: row.amount_minor, kind: row.kind, area: row.area, materialName: row.material_name, quantityMilli: row.quantity_milli, expenseId: row.expense_id, expenseName: row.expense_name, usefulLifeMonths: row.useful_life_months, documentId: row.document_id, source: row.source });

const PURCHASE_COLUMNS = "p.id, p.purchased_on, p.description, p.supplier, p.amount_minor, p.kind, p.area, m.name AS material_name, p.quantity_milli, p.expense_id, e.name AS expense_name, p.useful_life_months, p.document_id, p.source FROM purchases p LEFT JOIN materials m ON m.id=p.material_id LEFT JOIN shared_expenses e ON e.id=p.expense_id";

export async function loadChannels(principal: Principal): Promise<SalesChannel[]> {
  const rows = await dbQuery<ChannelRow>("SELECT id, name, delivery_method, commission_bps, fee_per_order_minor, delivery_cost_per_order_minor, units_per_order_milli, price_adjustment_bps FROM sales_channels WHERE organization_id=? AND archived_at IS NULL ORDER BY created_at", [principal.organizationId]);
  return rows.map(toChannel);
}

/** Channels, the month's purchases and sales, and every investment still being spread. */
export async function loadBusinessRecords(principal: Principal, forMonth: string) {
  const [from, to] = monthBounds(month.parse(forMonth));
  const org = principal.organizationId;
  const [channels, purchases, investments, sales, items] = await dbBatch<ChannelRow | PurchaseRow | SaleRow | SaleItemRow>([
    { sql: "SELECT id, name, delivery_method, commission_bps, fee_per_order_minor, delivery_cost_per_order_minor, units_per_order_milli, price_adjustment_bps FROM sales_channels WHERE organization_id=? AND archived_at IS NULL ORDER BY created_at", params: [org] },
    { sql: `SELECT ${PURCHASE_COLUMNS} WHERE p.organization_id=? AND p.archived_at IS NULL AND p.purchased_on >= ? AND p.purchased_on < ? ORDER BY p.purchased_on DESC, p.created_at DESC LIMIT 500`, params: [org, from, to] },
    { sql: `SELECT ${PURCHASE_COLUMNS} WHERE p.organization_id=? AND p.archived_at IS NULL AND p.kind='investment' ORDER BY p.purchased_on DESC LIMIT 500`, params: [org] },
    { sql: "SELECT id, sold_on, channel_id, channel_name, customer, note, total_minor, selling_cost_minor, delivery_cost_minor, variable_cost_minor, production_cost_minor, document_id, source FROM sales WHERE organization_id=? AND archived_at IS NULL AND sold_on >= ? AND sold_on < ? ORDER BY sold_on DESC, created_at DESC LIMIT 500", params: [org, from, to] },
    { sql: "SELECT si.sale_id, si.product_id, si.product_name, si.quantity_milli, si.unit_price_minor, si.unit_variable_cost_minor, si.unit_cost_minor FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.organization_id=? AND s.archived_at IS NULL AND s.sold_on >= ? AND s.sold_on < ?", params: [org, from, to] },
  ], { retrySafe: true });
  const itemsBySale = new Map<string, SaleItem[]>();
  for (const row of items as SaleItemRow[]) {
    const list = itemsBySale.get(row.sale_id) ?? [];
    list.push({ productId: row.product_id, productName: row.product_name, quantityMilli: row.quantity_milli, unitPriceMinor: row.unit_price_minor, unitVariableCostMinor: row.unit_variable_cost_minor, unitCostMinor: row.unit_cost_minor });
    itemsBySale.set(row.sale_id, list);
  }
  return {
    channels: (channels as ChannelRow[]).map(toChannel),
    purchases: (purchases as PurchaseRow[]).map(toPurchase),
    investments: (investments as PurchaseRow[]).map(toPurchase),
    sales: (sales as SaleRow[]).map((row): Sale => ({
      id: row.id, soldOn: row.sold_on, channelId: row.channel_id, channelName: row.channel_name, customer: row.customer, note: row.note,
      totalMinor: row.total_minor, sellingCostMinor: row.selling_cost_minor, deliveryCostMinor: row.delivery_cost_minor,
      variableCostMinor: row.variable_cost_minor, productionCostMinor: row.production_cost_minor, documentId: row.document_id, source: row.source,
      items: itemsBySale.get(row.id) ?? [],
    })),
  };
}

export async function loadBusinessView(principal: Principal, forMonth: string) {
  const [state, records] = await Promise.all([loadState(principal), loadBusinessRecords(principal, forMonth)]);
  return buildBusinessView(state, records, forMonth);
}

export async function saveChannel(principal: Principal, input: ChannelInput): Promise<{ id: string; created: boolean; channel: SalesChannel }> {
  assertEditor(principal);
  const value = channelInputSchema.parse(input);
  const channels = await loadChannels(principal);
  const clash = channels.find((item) => item.id !== value.id && item.name.toLocaleLowerCase("es") === value.name.toLocaleLowerCase("es"));
  if (clash) throw new ApiError(400, `Ya existe el canal ${clash.name}`);
  if (value.id && !channels.some((item) => item.id === value.id)) throw new ApiError(404, "Canal no encontrado");
  const channel: SalesChannel = {
    id: value.id ?? crypto.randomUUID(), name: value.name, deliveryMethod: value.deliveryMethod,
    commissionBps: Math.round(value.commissionPercent * 100), feePerOrderMinor: Math.round(value.feePerOrder),
    deliveryCostPerOrderMinor: Math.round(value.deliveryCostPerOrder), unitsPerOrderMilli: Math.max(1, Math.round(value.unitsPerOrder * 1000)),
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
export async function archiveRecord(principal: Principal, kind: "channel" | "purchase" | "sale", id: string, reason = ""): Promise<void> {
  assertEditor(principal);
  const table = { channel: "sales_channels", purchase: "purchases", sale: "sales" }[kind];
  const [rows] = await dbBatch<{ id: string }>([
    { sql: `UPDATE ${table} SET archived_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND archived_at IS NULL RETURNING id`, params: [id, principal.organizationId] },
    audit(principal, `archive-${kind}`, id, { reason }),
  ]);
  if (!rows.length) throw new ApiError(404, kind === "channel" ? "Canal no encontrado" : kind === "purchase" ? "Compra no encontrada" : "Venta no encontrada");
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
  const amountMinor = toOrganizationAmount(state, value.amount, currency);
  const documentId = await documentBelongs(principal, value.documentId);

  let priceUpdated: RecordedPurchase["priceUpdated"] = null;
  if (value.kind === "material" && material && value.quantity && value.updateMaterialPrice) {
    const unitPrice = Math.round(value.amount / value.quantity * 1000) / 1000;
    const priceKey = derivedKey(options.idempotencyKey, "price");
    const applied = await dbQuery("SELECT 1 AS found FROM change_sets WHERE organization_id=? AND idempotency_key=?", [principal.organizationId, priceKey]);
    if (!applied.length) {
      for (let attempt = 0; ; attempt++) {
        const latest = attempt ? await loadState(principal) : state;
        const expectedFxRates = Object.fromEntries([...new Set([...latest.materials, ...latest.expenses, { currency }].map((item) => item.currency ?? latest.organization.currency))]
          .filter((code) => code !== latest.organization.currency).flatMap((code) => latest.fxQuotes?.[code] ? [[code, latest.fxQuotes[code]!.ratePpm]] : []));
        try {
          await commitMutation(principal, {
            action: "bulk-prices", materials: [{ id: material.id, amount: unitPrice, currency }], expenses: [], expectedFxRates,
            source: `Compra${value.supplier ? ` a ${value.supplier}` : ""} del ${value.purchasedOn}`.slice(0, 200), effectiveDate: value.purchasedOn,
            expectedRevision: latest.revision, idempotencyKey: priceKey,
          }, { source: options.source });
          break;
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409 || attempt >= 5) throw error;
          await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
        }
      }
    }
    priceUpdated = { material: material.name, unitPrice, currency };
  }

  const id = crypto.randomUUID();
  const lifeMonths = value.kind === "investment" ? value.usefulLifeMonths ?? null : null;
  await dbBatch([
    { sql: "INSERT INTO purchases (id, organization_id, purchased_on, description, supplier, amount_minor, currency, native_amount_milli, kind, area, material_id, quantity_milli, expense_id, useful_life_months, document_id, source, actor_id, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [
      id, principal.organizationId, value.purchasedOn, value.description, value.supplier, amountMinor, currency, toNativeMilli(value.amount), value.kind, area,
      material?.id ?? null, value.quantity ? Math.round(value.quantity * 1000) : null, expense?.id ?? null, lifeMonths, documentId, options.source, principal.userId, options.idempotencyKey,
    ] },
    audit(principal, "record-purchase", id, { ...value, amountMinor, area, source: options.source }),
  ]);
  return {
    id, duplicate: false, priceUpdated,
    purchase: { id, purchasedOn: value.purchasedOn, description: value.description, supplier: value.supplier, amountMinor, kind: value.kind, area, materialName: material?.name ?? null, quantityMilli: value.quantity ? Math.round(value.quantity * 1000) : null, expenseId: expense?.id ?? null, expenseName: expense?.name ?? null, usefulLifeMonths: lifeMonths, documentId, source: options.source },
  };
}

export type RecordedSale = { id: string; duplicate: boolean; sale: Omit<Sale, "id"> & { id: string } };

/** Records a sale with its channel's rules; prices and costs are fixed now so the month's result does not drift. */
export async function recordSale(principal: Principal, input: SaleInput, options: RecordOptions): Promise<RecordedSale> {
  assertEditor(principal);
  const value = saleInputSchema.parse(input);
  const duplicate = await dbQuery<{ id: string }>("SELECT id FROM sales WHERE organization_id=? AND idempotency_key=?", [principal.organizationId, options.idempotencyKey]);
  const [state, channels] = await Promise.all([loadState(principal), loadChannels(principal)]);
  const channel = value.channelId ? channels.find((item) => item.id === value.channelId) : DIRECT_CHANNEL;
  if (!channel) throw new ApiError(404, "Canal no encontrado");
  const priced = priceSale(state, calculateCosts(state), channel, value.items, value.deliveryCost);
  if (priced.problems.length) throw new ApiError(400, priced.problems.join(". "));
  const sale = {
    soldOn: value.soldOn, channelId: channel.id === DIRECT_CHANNEL.id ? null : channel.id, channelName: channel.name, customer: value.customer, note: value.note,
    totalMinor: priced.totalMinor, sellingCostMinor: priced.sellingCostMinor, deliveryCostMinor: priced.deliveryCostMinor,
    variableCostMinor: priced.variableCostMinor, productionCostMinor: priced.productionCostMinor,
    documentId: await documentBelongs(principal, value.documentId), source: options.source, items: priced.items,
  };
  if (duplicate[0]) return { id: duplicate[0].id, duplicate: true, sale: { id: duplicate[0].id, ...sale } };
  const id = crypto.randomUUID();
  await dbBatch([
    { sql: "INSERT INTO sales (id, organization_id, sold_on, channel_id, channel_name, customer, note, total_minor, selling_cost_minor, delivery_cost_minor, variable_cost_minor, production_cost_minor, document_id, source, actor_id, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [
      id, principal.organizationId, sale.soldOn, sale.channelId, sale.channelName, sale.customer, sale.note, sale.totalMinor, sale.sellingCostMinor, sale.deliveryCostMinor,
      sale.variableCostMinor, sale.productionCostMinor, sale.documentId, options.source, principal.userId, options.idempotencyKey,
    ] },
    ...priced.items.map((item): SqlStatement => ({ sql: "INSERT INTO sale_items (sale_id, product_id, product_name, quantity_milli, unit_price_minor, unit_variable_cost_minor, unit_cost_minor) VALUES (?, ?, ?, ?, ?, ?, ?)", params: [id, item.productId, item.productName, item.quantityMilli, item.unitPriceMinor, item.unitVariableCostMinor, item.unitCostMinor] })),
    audit(principal, "record-sale", id, { ...value, totalMinor: sale.totalMinor, channel: channel.name, source: options.source }),
  ]);
  return { id, duplicate: false, sale: { id, ...sale } };
}

/** Plain-language one-liners for receipts and the audit of what was recorded. */
export const describePurchase = (purchase: Purchase, currency: string) =>
  `${PURCHASE_KIND_LABELS[purchase.kind]} · ${AREA_LABELS[purchase.area]} · ${purchase.description}: ${purchase.amountMinor} ${currency}`;
