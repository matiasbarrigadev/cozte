import { calculateCosts, type CostArea } from "./domain";
import { DELIVERY_STATUS_LABELS, DIRECT_CHANNEL, buildCustomerDirectory, byProximity, initialDeliveryStatus, needsDelivery, priceSale, repriceSale, saleItemsText, type BusinessRecords, type CustomerDirectory, type Delivery, type Purchase, type PurchaseKind, type Sale, type SalePatch, type SalesChannel } from "./business";
import { DEMO_TODAY, demoBusinessRecords, demoDeliveries, demoState } from "./demo";

/**
 * The demo's business records in memory: sales, deliveries, purchases and channels that the visitor can edit with
 * the same engine as a real workspace. Nothing leaves the browser; a reload starts over.
 */

type Store = { records: BusinessRecords; deliveries: Delivery[] };

let store: Store | null = null;
let version = 0;
const listeners = new Set<() => void>();

function data(): Store {
  if (!store) {
    const records = demoBusinessRecords();
    store = { records: { ...records, sales: records.sales.map((sale) => ({ ...sale, delivery: undefined })) }, deliveries: demoDeliveries(DEMO_TODAY) };
  }
  return store;
}

function commit(next: Store) {
  store = next;
  version++;
  for (const listener of listeners) listener();
}

export const subscribeDemo = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const demoVersion = () => version;

/** The demo's records, each sale carrying its delivery summary. */
export function demoRecords(): BusinessRecords {
  const { records, deliveries } = data();
  const bySale = new Map(deliveries.map((item) => [item.saleId, { id: item.id, status: item.status, scheduledOn: item.scheduledOn, deliveredOn: item.deliveredOn }]));
  return { ...records, sales: records.sales.map((sale) => ({ ...sale, delivery: bySale.get(sale.id) ?? null })) };
}

/** The demo's deliveries of a month plus the open ones, closest to the demo's today first. */
export function demoDeliveryList(month: string): Delivery[] {
  const { records, deliveries } = data();
  const sales = new Map(records.sales.map((sale) => [sale.id, sale]));
  const list = deliveries.filter((item) => item.scheduledOn.startsWith(month) || ["pending", "on_the_way", "failed"].includes(item.status)).map((item) => {
    const sale = sales.get(item.saleId);
    return sale ? { ...item, costMinor: sale.deliveryCostMinor, sale: { soldOn: sale.soldOn, channelId: sale.channelId, channelName: sale.channelName, customer: sale.customer, totalMinor: sale.totalMinor, items: saleItemsText(sale.items) } } : item;
  });
  return byProximity(list, (item) => item.scheduledOn, DEMO_TODAY);
}

/** What was typed before in the demo, for its suggestions. */
export function demoCustomerDirectory(): CustomerDirectory {
  const { records, deliveries } = data();
  const bySale = new Map(deliveries.map((item) => [item.saleId, item]));
  return buildCustomerDirectory(records.sales.map((sale) => { const delivery = bySale.get(sale.id); return { customer: sale.customer, soldOn: sale.soldOn, recipient: delivery?.recipient, address: delivery?.address, contact: delivery?.contact, carrier: delivery?.carrier }; }));
}

class DemoError extends Error {}

type DeliveryFields = Partial<Pick<Delivery, "scheduledOn" | "timeWindow" | "status" | "method" | "carrier" | "recipient" | "address" | "contact" | "tracking" | "note" | "deliveredOn">>;

function newDelivery(sale: Sale, channel: Pick<SalesChannel, "deliveryMethod">, fields: DeliveryFields): Delivery {
  const scheduledOn = fields.scheduledOn ?? sale.soldOn;
  const status = fields.status ?? initialDeliveryStatus(scheduledOn, DEMO_TODAY);
  return {
    id: `e-${Math.random().toString(36).slice(2, 10)}`, saleId: sale.id, scheduledOn, timeWindow: fields.timeWindow ?? "", status, method: fields.method ?? channel.deliveryMethod,
    carrier: fields.carrier ?? "", recipient: fields.recipient ?? sale.customer, address: fields.address ?? "", contact: fields.contact ?? "", tracking: fields.tracking ?? "", note: fields.note ?? "",
    deliveredOn: status === "delivered" ? fields.deliveredOn ?? (scheduledOn < DEMO_TODAY ? scheduledOn : DEMO_TODAY) : null, source: "user", costMinor: sale.deliveryCostMinor,
    sale: { soldOn: sale.soldOn, channelId: sale.channelId, channelName: sale.channelName, customer: sale.customer, totalMinor: sale.totalMinor, items: saleItemsText(sale.items) },
  };
}

type Body = Record<string, unknown> & { action: string };

/** The demo's version of the business API: same actions and answers, computed in the browser. */
export function demoBusinessAction<T>(body: Body): T {
  const current = data();
  const costs = calculateCosts(demoState);
  const channelOf = (id: string | null | undefined) => id ? current.records.channels.find((item) => item.id === id) : DIRECT_CHANNEL;
  switch (body.action) {
    case "record-sale": {
      const input = body.sale as { soldOn: string; channelId?: string | null; items: { productId: string; quantity: number; unitPrice?: number }[]; deliveryCost?: number; customer?: string; note?: string; delivery?: DeliveryFields };
      const channel = channelOf(input.channelId);
      if (!channel) throw new DemoError("Canal no encontrado");
      const priced = priceSale(demoState, costs, channel, input.items, input.deliveryCost);
      if (priced.problems.length) throw new DemoError(priced.problems.join(". "));
      const sale: Sale = { id: `v-${Math.random().toString(36).slice(2, 8)}`, soldOn: input.soldOn, channelId: channel.id === DIRECT_CHANNEL.id ? null : channel.id, channelName: channel.name, customer: input.customer ?? "", note: input.note ?? "", documentId: null, source: "user", ...priced };
      const delivery = input.delivery || needsDelivery(channel, input.deliveryCost) ? newDelivery(sale, channel, input.delivery ?? {}) : null;
      commit({ records: { ...current.records, sales: [sale, ...current.records.sales] }, deliveries: delivery ? [...current.deliveries, delivery] : current.deliveries });
      return { id: sale.id, duplicate: false, sale } as T;
    }
    case "update-sale": {
      const sale = current.records.sales.find((item) => item.id === body.id);
      if (!sale) throw new DemoError("Venta no encontrada");
      const { sale: next, problems } = repriceSale(sale, body.patch as SalePatch, demoState, costs, current.records.channels);
      if (problems.length) throw new DemoError(problems.join(". "));
      const updated = { ...sale, ...next };
      commit({ ...current, records: { ...current.records, sales: current.records.sales.map((item) => item.id === sale.id ? updated : item) } });
      return updated as T;
    }
    case "save-delivery": {
      const input = body.delivery as DeliveryFields & { id?: string; saleId?: string; cost?: number };
      let deliveries = current.deliveries;
      let sales = current.records.sales;
      let id = input.id;
      let saleId = input.saleId;
      const done: string[] = [];
      if (id) {
        const existing = deliveries.find((item) => item.id === id);
        if (!existing) throw new DemoError("Entrega no encontrada");
        saleId = existing.saleId;
        const fields: DeliveryFields = Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== undefined && !["id", "saleId", "cost"].includes(key)));
        if (fields.status === "delivered" && existing.status !== "delivered" && fields.deliveredOn === undefined) fields.deliveredOn = DEMO_TODAY;
        if (fields.status && fields.status !== "delivered" && fields.deliveredOn === undefined) fields.deliveredOn = null;
        deliveries = deliveries.map((item) => item.id === id ? { ...item, ...fields } : item);
        if (input.status) done.push(`Entrega: ${DELIVERY_STATUS_LABELS[input.status]}`);
        else done.push("Entrega actualizada");
      } else {
        const sale = sales.find((item) => item.id === saleId);
        if (!sale) throw new DemoError("Venta no encontrada");
        if (deliveries.some((item) => item.saleId === sale.id)) throw new DemoError("Esa venta ya tiene una entrega: cámbiala en lugar de crear otra");
        const delivery = newDelivery(sale, channelOf(sale.channelId) ?? DIRECT_CHANNEL, input);
        id = delivery.id;
        deliveries = [...deliveries, delivery];
        done.push(`Entrega programada para el ${delivery.scheduledOn}`);
      }
      if (input.cost !== undefined) { sales = sales.map((item) => item.id === saleId ? { ...item, deliveryCostMinor: Math.round(input.cost!) } : item); done.push("Costo de entrega actualizado"); }
      commit({ records: { ...current.records, sales }, deliveries });
      return { id, created: !input.id, done } as T;
    }
    case "archive": {
      const { kind, id } = body as unknown as { kind: "channel" | "purchase" | "sale" | "delivery"; id: string };
      const records = { ...current.records };
      let deliveries = current.deliveries;
      if (kind === "sale") { records.sales = records.sales.filter((item) => item.id !== id); deliveries = deliveries.filter((item) => item.saleId !== id); }
      if (kind === "purchase") { records.purchases = records.purchases.filter((item) => item.id !== id); records.investments = records.investments.filter((item) => item.id !== id); }
      if (kind === "channel") records.channels = records.channels.filter((item) => item.id !== id);
      if (kind === "delivery") deliveries = deliveries.filter((item) => item.id !== id);
      commit({ records, deliveries });
      return { ok: true } as T;
    }
    case "save-channel": {
      const input = body.channel as { id?: string; name: string; deliveryMethod?: string; commissionPercent?: number; feePerOrder?: number; deliveryCostPerOrder?: number; unitsPerOrder?: number; priceAdjustmentPercent?: number };
      const channel: SalesChannel = {
        id: input.id ?? `c-${Math.random().toString(36).slice(2, 8)}`, name: input.name, deliveryMethod: input.deliveryMethod ?? "", commissionBps: Math.round((input.commissionPercent ?? 0) * 100),
        feePerOrderMinor: input.feePerOrder ?? 0, deliveryCostPerOrderMinor: input.deliveryCostPerOrder ?? 0, unitsPerOrderMilli: Math.round((input.unitsPerOrder ?? 1) * 1000), priceAdjustmentBps: Math.round((input.priceAdjustmentPercent ?? 0) * 100),
      };
      const exists = current.records.channels.some((item) => item.id === channel.id);
      commit({ ...current, records: { ...current.records, channels: exists ? current.records.channels.map((item) => item.id === channel.id ? channel : item) : [...current.records.channels, channel] } });
      return { id: channel.id, created: !exists, channel } as T;
    }
    case "record-purchase": {
      const input = body.purchase as { purchasedOn: string; description: string; supplier?: string; amount: number; kind: PurchaseKind; area?: CostArea; materialId?: string; quantity?: number; expenseId?: string; usefulLifeMonths?: number; includeInUnitCost?: boolean };
      const material = input.materialId ? demoState.materials.find((item) => item.id === input.materialId) : undefined;
      const expense = input.expenseId ? demoState.expenses.find((item) => item.id === input.expenseId) : undefined;
      const purchase: Purchase = {
        id: `p-${Math.random().toString(36).slice(2, 8)}`, purchasedOn: input.purchasedOn, description: input.description, supplier: input.supplier ?? "", amountMinor: input.amount, kind: input.kind,
        area: input.area ?? (input.kind === "material" ? "production" : expense?.area ?? "production"), materialName: material?.name ?? null, quantityMilli: input.quantity ? Math.round(input.quantity * 1000) : null,
        expenseId: expense?.id ?? null, expenseName: expense?.name ?? null, usefulLifeMonths: input.usefulLifeMonths ?? null, includeInUnitCost: Boolean(input.includeInUnitCost), documentId: null, source: "user",
      };
      commit({ ...current, records: { ...current.records, purchases: [purchase, ...current.records.purchases], investments: purchase.kind === "investment" ? [purchase, ...current.records.investments] : current.records.investments } });
      return { id: purchase.id, duplicate: false, purchase, priceUpdated: null } as T;
    }
    case "update-purchase": {
      const patch = body.patch as Partial<{ purchasedOn: string; description: string; supplier: string; amount: number; area: CostArea; usefulLifeMonths: number }>;
      const update = (item: Purchase): Purchase => item.id !== body.id ? item : {
        ...item, purchasedOn: patch.purchasedOn ?? item.purchasedOn, description: patch.description ?? item.description, supplier: patch.supplier ?? item.supplier,
        amountMinor: patch.amount ?? item.amountMinor, area: patch.area ?? item.area, usefulLifeMonths: patch.usefulLifeMonths ?? item.usefulLifeMonths,
      };
      const target = [...current.records.purchases, ...current.records.investments].find((item) => item.id === body.id);
      if (!target) throw new DemoError("Compra no encontrada");
      if (target.kind === "investment" && target.includeInUnitCost && (patch.amount !== undefined || patch.usefulLifeMonths !== undefined || patch.area !== undefined || patch.purchasedOn !== undefined)) throw new DemoError("Esta inversión se suma al costo de cada producto: para cambiar su monto, vida útil, área o fecha, primero quítala del costo en Gastos de la empresa.");
      commit({ ...current, records: { ...current.records, purchases: current.records.purchases.map(update), investments: current.records.investments.map(update) } });
      return { ok: true } as T;
    }
    default:
      throw new DemoError("En la demostración esta acción no está disponible");
  }
}

