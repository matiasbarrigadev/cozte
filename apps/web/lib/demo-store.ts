import { calculateCosts, type CostArea } from "./domain";
import { DELIVERY_STATUS_LABELS, DIRECT_CHANNEL, buildCustomerDirectory, byProximity, initialDeliveryStatus, needsDelivery, priceSale, repriceSale, saleItemsText, type BusinessRecords, type CustomerDirectory, type Delivery, type Purchase, type PurchaseKind, type Sale, type SalePatch, type SalesChannel } from "./business";
import { DEMO_TODAY, demoBusinessRecords, demoDeliveries, demoHistorySales, demoState } from "./demo";
import { buildCustomerList, customerKey, customerMonths, customersFromHistory, customerStats, directoryFromCustomers, zoneFromAddress, type Customer, type CustomerAddress, type CustomerSale } from "./customers";
import { monthsBack } from "./business-analytics";

/**
 * The demo's business records in memory: sales, deliveries, purchases and channels that the visitor can edit with
 * the same engine as a real workspace. Nothing leaves the browser; a reload starts over.
 */

type Store = { records: BusinessRecords; deliveries: Delivery[]; customers: Customer[]; history: Sale[] };

let store: Store | null = null;
let version = 0;
const listeners = new Set<() => void>();

function data(): Store {
  if (!store) {
    const records = demoBusinessRecords();
    const deliveries = demoDeliveries(DEMO_TODAY);
    const history = demoHistorySales();
    // The demo's customers, built from its sales like a real workspace builds them the first time.
    const bySale = new Map(deliveries.map((item) => [item.saleId, item]));
    const imported = customersFromHistory([...records.sales, ...history].map((sale) => { const delivery = bySale.get(sale.id); return { customer: sale.customer, soldOn: sale.soldOn, recipient: delivery?.recipient, address: delivery?.address, contact: delivery?.contact }; }));
    const customers: Customer[] = imported.map((entry, index) => ({
      id: `cl-${index + 1}`, name: entry.name, phone: entry.phone, email: "", notes: "", source: "import", createdAt: "2026-04-01 12:00:00",
      addresses: entry.addresses.map((address, position) => ({ id: `cl-${index + 1}-a${position + 1}`, label: "", notes: "", ...address })),
    }));
    const idOf = (name: string) => customers.find((customer) => customerKey(customer.name) === customerKey(name))?.id ?? null;
    store = {
      records: { ...records, sales: records.sales.map((sale) => ({ ...sale, delivery: undefined, customerId: idOf(sale.customer) })) },
      deliveries, customers, history: history.map((sale) => ({ ...sale, customerId: idOf(sale.customer) })),
    };
  }
  return store;
}

/** The customer of a name in the demo: the existing one or a new one. */
function demoResolveCustomer(current: Store, name: string | undefined): { customers: Customer[]; id: string | null } {
  const key = customerKey(name ?? "");
  if (!key) return { customers: current.customers, id: null };
  const found = current.customers.find((customer) => customerKey(customer.name) === key);
  if (found) return { customers: current.customers, id: found.id };
  const customer: Customer = { id: `cl-${Math.random().toString(36).slice(2, 8)}`, name: name!.trim(), phone: "", email: "", notes: "", source: "user", createdAt: new Date().toISOString(), addresses: [] };
  return { customers: [...current.customers, customer], id: customer.id };
}

/** Keeps a new delivery address in the customer's demo record. */
function demoLearnAddress(customers: Customer[], customerId: string | null, address: string | undefined, recipient?: string, contact?: string): Customer[] {
  const clean = address?.trim() ?? "";
  if (!customerId || !clean) return customers;
  return customers.map((customer) => customer.id !== customerId || customer.addresses.some((item) => customerKey(item.address) === customerKey(clean)) ? customer : {
    ...customer, addresses: [...customer.addresses, { id: `${customer.id}-a${Math.random().toString(36).slice(2, 6)}`, label: "", address: clean, zone: zoneFromAddress(clean), recipient: recipient ?? "", contact: contact ?? "", notes: "", isDefault: customer.addresses.length === 0 }],
  });
}

function demoCustomerSales(current: Store): CustomerSale[] {
  const bySale = new Map(current.deliveries.map((item) => [item.saleId, item]));
  return [...current.records.sales, ...current.history].map((sale) => ({
    id: sale.id, customerId: sale.customerId ?? null, soldOn: sale.soldOn, channelName: sale.channelName, items: saleItemsText(sale.items),
    totalMinor: sale.totalMinor, variableCostMinor: sale.variableCostMinor, sellingCostMinor: sale.sellingCostMinor, deliveryCostMinor: sale.deliveryCostMinor,
    deliveryStatus: bySale.get(sale.id)?.status ?? sale.delivery?.status ?? null, deliveryAddress: bySale.get(sale.id)?.address ?? null,
  })).sort((a, b) => b.soldOn.localeCompare(a.soldOn));
}

/** The demo's customers with their stats, like /api/customers/list. */
export function demoCustomerList() {
  const current = data();
  return { customers: buildCustomerList(current.customers, demoCustomerSales(current), DEMO_TODAY), today: DEMO_TODAY };
}

/** One demo customer, like /api/customers/[id]. */
export function demoCustomerDetail(id: string) {
  const current = data();
  const customer = current.customers.find((item) => item.id === id);
  if (!customer) throw new DemoError("Cliente no encontrado");
  const sales = demoCustomerSales(current).filter((sale) => sale.customerId === id);
  return { customer, stats: customerStats(sales, DEMO_TODAY), months: customerMonths(sales, monthsBack(DEMO_TODAY.slice(0, 7), 12)), sales: sales.slice(0, 60), today: DEMO_TODAY };
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
  const typed = buildCustomerDirectory(records.sales.map((sale) => { const delivery = bySale.get(sale.id); return { customer: sale.customer, soldOn: sale.soldOn, recipient: delivery?.recipient, address: delivery?.address, contact: delivery?.contact, carrier: delivery?.carrier }; }));
  return directoryFromCustomers(demoCustomerList().customers, typed);
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
      const resolved = demoResolveCustomer(current, input.customer);
      const sale: Sale = { id: `v-${Math.random().toString(36).slice(2, 8)}`, soldOn: input.soldOn, channelId: channel.id === DIRECT_CHANNEL.id ? null : channel.id, channelName: channel.name, customer: input.customer ?? "", customerId: resolved.id, note: input.note ?? "", documentId: null, source: "user", ...priced };
      const main = resolved.customers.find((customer) => customer.id === resolved.id)?.addresses.find((address) => address.isDefault);
      const fields: DeliveryFields = { ...input.delivery, ...(!input.delivery?.address?.trim() && main ? { address: main.address, recipient: input.delivery?.recipient || main.recipient || undefined, contact: input.delivery?.contact || main.contact || undefined } : {}) };
      const delivery = input.delivery || needsDelivery(channel, input.deliveryCost) ? newDelivery(sale, channel, fields) : null;
      const customers = demoLearnAddress(resolved.customers, resolved.id, delivery?.address, delivery?.recipient, delivery?.contact);
      commit({ ...current, customers, records: { ...current.records, sales: [sale, ...current.records.sales] }, deliveries: delivery ? [...current.deliveries, delivery] : current.deliveries });
      return { id: sale.id, duplicate: false, sale } as T;
    }
    case "update-sale": {
      const sale = current.records.sales.find((item) => item.id === body.id);
      if (!sale) throw new DemoError("Venta no encontrada");
      const { sale: next, problems } = repriceSale(sale, body.patch as SalePatch, demoState, costs, current.records.channels);
      if (problems.length) throw new DemoError(problems.join(". "));
      const patch = body.patch as SalePatch;
      const resolved = patch.customer !== undefined ? demoResolveCustomer(current, patch.customer) : { customers: current.customers, id: sale.customerId ?? null };
      const updated = { ...sale, ...next, customerId: resolved.id };
      commit({ ...current, customers: resolved.customers, records: { ...current.records, sales: current.records.sales.map((item) => item.id === sale.id ? updated : item) } });
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
      const owner = sales.find((item) => item.id === saleId)?.customerId ?? null;
      commit({ ...current, customers: demoLearnAddress(current.customers, owner, input.address, input.recipient, input.contact), records: { ...current.records, sales }, deliveries });
      return { id, created: !input.id, done } as T;
    }
    case "save-customer": {
      const input = body.customer as { id?: string; name?: string; phone?: string; email?: string; notes?: string };
      if (!input.id) {
        const name = input.name?.trim() ?? "";
        if (!name) throw new DemoError("Escribe el nombre del cliente");
        if (current.customers.some((customer) => customerKey(customer.name) === customerKey(name))) throw new DemoError(`Ya hay un cliente llamado ${name}`);
        const customer: Customer = { id: `cl-${Math.random().toString(36).slice(2, 8)}`, name, phone: input.phone ?? "", email: input.email ?? "", notes: input.notes ?? "", source: "user", createdAt: new Date().toISOString(), addresses: [] };
        commit({ ...current, customers: [...current.customers, customer] });
        return { id: customer.id, created: true, done: [`Cliente creado: ${name}`] } as T;
      }
      const existing = current.customers.find((customer) => customer.id === input.id);
      if (!existing) throw new DemoError("Cliente no encontrado");
      if (input.name && customerKey(input.name) !== customerKey(existing.name) && current.customers.some((customer) => customer.id !== existing.id && customerKey(customer.name) === customerKey(input.name!))) throw new DemoError(`Ya hay un cliente llamado ${input.name}: si es el mismo, únelos`);
      const next = { ...existing, ...Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== undefined && key !== "id")) } as Customer;
      const rename = (sale: Sale) => sale.customerId === existing.id && input.name ? { ...sale, customer: input.name } : sale;
      commit({ ...current, customers: current.customers.map((customer) => customer.id === existing.id ? next : customer), records: { ...current.records, sales: current.records.sales.map(rename) }, history: current.history.map(rename) });
      return { id: existing.id, created: false, done: ["Datos del cliente actualizados"] } as T;
    }
    case "save-customer-address": {
      const input = body.address as Partial<CustomerAddress> & { customerId: string };
      const customer = current.customers.find((item) => item.id === input.customerId);
      if (!customer) throw new DemoError("Cliente no encontrado");
      const makeDefault = input.isDefault === true || (!input.id && !customer.addresses.length);
      let addresses = makeDefault ? customer.addresses.map((address) => ({ ...address, isDefault: false })) : customer.addresses;
      let id = input.id;
      if (!id) {
        if (!input.address?.trim()) throw new DemoError("Escribe la dirección");
        id = `${customer.id}-a${Math.random().toString(36).slice(2, 6)}`;
        addresses = [...addresses, { id, label: input.label ?? "", address: input.address.trim(), zone: input.zone ?? zoneFromAddress(input.address), recipient: input.recipient ?? "", contact: input.contact ?? "", notes: input.notes ?? "", isDefault: makeDefault }];
      } else {
        const fields = Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== undefined && !["id", "customerId"].includes(key)));
        addresses = addresses.map((address) => address.id === id ? { ...address, ...fields } : address);
      }
      commit({ ...current, customers: current.customers.map((item) => item.id === customer.id ? { ...item, addresses } : item) });
      return { id, created: !input.id, done: [input.id ? `Dirección de ${customer.name} actualizada` : `Dirección agregada a ${customer.name}`] } as T;
    }
    case "archive-customer-address": {
      const { customerId, id } = body as unknown as { customerId: string; id: string };
      commit({ ...current, customers: current.customers.map((customer) => {
        if (customer.id !== customerId) return customer;
        const addresses = customer.addresses.filter((address) => address.id !== id);
        return { ...customer, addresses: addresses.length && !addresses.some((address) => address.isDefault) ? addresses.map((address, index) => ({ ...address, isDefault: index === addresses.length - 1 })) : addresses };
      }) });
      return { ok: true } as T;
    }
    case "merge-customers": {
      const { fromId, intoId } = body as unknown as { fromId: string; intoId: string };
      const from = current.customers.find((customer) => customer.id === fromId);
      const into = current.customers.find((customer) => customer.id === intoId);
      if (!from || !into || fromId === intoId) throw new DemoError("Elige otro cliente para unir");
      const keys = new Set(into.addresses.map((address) => customerKey(address.address)));
      const merged = { ...into, addresses: [...into.addresses, ...from.addresses.filter((address) => !keys.has(customerKey(address.address))).map((address) => ({ ...address, isDefault: false }))] };
      const move = (sale: Sale) => sale.customerId === fromId ? { ...sale, customerId: intoId, customer: into.name } : sale;
      commit({ ...current, customers: current.customers.filter((customer) => customer.id !== fromId).map((customer) => customer.id === intoId ? merged : customer), records: { ...current.records, sales: current.records.sales.map(move) }, history: current.history.map(move) });
      return { done: [`${from.name} quedó unido a ${into.name}`] } as T;
    }
    case "archive-customer": {
      const { id } = body as unknown as { id: string };
      const unlink = (sale: Sale) => sale.customerId === id ? { ...sale, customerId: null } : sale;
      commit({ ...current, customers: current.customers.filter((customer) => customer.id !== id), records: { ...current.records, sales: current.records.sales.map(unlink) }, history: current.history.map(unlink) });
      return { ok: true } as T;
    }
    case "archive": {
      const { kind, id } = body as unknown as { kind: "channel" | "purchase" | "sale" | "delivery"; id: string };
      const records = { ...current.records };
      let deliveries = current.deliveries;
      if (kind === "sale") { records.sales = records.sales.filter((item) => item.id !== id); deliveries = deliveries.filter((item) => item.saleId !== id); }
      if (kind === "purchase") { records.purchases = records.purchases.filter((item) => item.id !== id); records.investments = records.investments.filter((item) => item.id !== id); }
      if (kind === "channel") records.channels = records.channels.filter((item) => item.id !== id);
      if (kind === "delivery") deliveries = deliveries.filter((item) => item.id !== id);
      commit({ ...current, records, deliveries });
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

