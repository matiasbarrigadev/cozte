import { calculateCosts, type CostArea } from "./domain";
import { roundMoney } from "./money";
import { DELIVERY_STATUS_LABELS, DIRECT_CHANNEL, buildCustomerDirectory, byProximity, initialDeliveryStatus, needsDelivery, priceSale, repriceSale, saleItemsText, type BusinessRecords, type CustomerDirectory, type Delivery, type Purchase, type PurchaseKind, type Sale, type SalePatch, type SalesChannel } from "./business";
import { DEMO_TODAY, DEMO_ZONES, demoBusinessRecords, demoDeliveries, demoHistorySales, demoState, demoSupplierHistory } from "./demo";
import { emptyTally, tallyDelivery } from "./delivery-zones";
import { kindForPurchase, materialPrices, sortSuppliers, supplierKey, supplierMonths, supplierStats, suppliersFromHistory, type Supplier, type SupplierKind, type SupplierPurchase, type SupplierRow } from "./suppliers";
import { ZONE_MODE_LABELS, matchZone, nextDeliveryDay, parseAreas, weekdaysFromNames, zoneCost, zoneDeliveryFields, type DeliveryZone, type ZoneMode } from "./delivery-zones";
import { buildCustomerList, customerKey, customerMonths, customersFromHistory, customerStats, directoryFromCustomers, zoneFromAddress, type Customer, type CustomerAddress, type CustomerSale } from "./customers";
import { monthsBack } from "./business-analytics";

/**
 * The demo's business records in memory: sales, deliveries, purchases and channels that the visitor can edit with
 * the same engine as a real workspace. Nothing leaves the browser; a reload starts over.
 */

type Store = { records: BusinessRecords; deliveries: Delivery[]; customers: Customer[]; history: Sale[]; zones: DeliveryZone[]; routeOrigin: string; suppliers: Supplier[]; supplierHistory: (SupplierPurchase & { supplier: string })[] };

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
    // The demo's suppliers, built from its purchases, supplies and carriers like a real workspace builds them the first time.
    const earlier = demoSupplierHistory();
    const found = suppliersFromHistory([
      ...records.purchases.map((purchase) => ({ name: purchase.supplier, kind: kindForPurchase(purchase.kind), on: purchase.purchasedOn })),
      ...earlier.map((purchase) => ({ name: purchase.supplier, kind: "materials" as SupplierKind, on: purchase.purchasedOn })),
      ...demoState.materials.map((material) => ({ name: material.supplier, kind: "materials" as SupplierKind })),
      ...DEMO_ZONES.filter((zone) => zone.mode === "carrier").map((zone) => ({ name: zone.carrier, kind: "logistics" as SupplierKind })),
    ]);
    const suppliers: Supplier[] = found.map((entry, index) => ({ id: `pr-${index + 1}`, name: entry.name, kind: entry.kind, contactName: "", phone: "", email: "", notes: "", source: "import", createdAt: "2026-04-01 12:00:00" }));
    const supplierOf = (name: string) => suppliers.find((supplier) => supplierKey(supplier.name) === supplierKey(name))?.id ?? null;
    const linked = <P extends { supplier: string }>(purchase: P) => ({ ...purchase, supplierId: supplierOf(purchase.supplier) });
    store = {
      records: { ...records, sales: records.sales.map((sale) => ({ ...sale, delivery: undefined, customerId: idOf(sale.customer) })), purchases: records.purchases.map(linked), investments: records.investments.map(linked) },
      deliveries, customers, history: history.map((sale) => ({ ...sale, customerId: idOf(sale.customer) })), zones: DEMO_ZONES, routeOrigin: "Av. Matta 1200, Santiago", suppliers, supplierHistory: earlier.map(linked),
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

/** The supplier of a name in the demo: the existing one or a new one. */
function demoResolveSupplier(current: Store, name: string | undefined, kind: SupplierKind): { suppliers: Supplier[]; id: string | null } {
  const key = supplierKey(name ?? "");
  if (!key) return { suppliers: current.suppliers, id: null };
  const found = current.suppliers.find((supplier) => supplierKey(supplier.name) === key);
  if (found) return { suppliers: current.suppliers, id: found.id };
  const supplier: Supplier = { id: `pr-${Math.random().toString(36).slice(2, 8)}`, name: name!.trim(), kind, contactName: "", phone: "", email: "", notes: "", source: "user", createdAt: new Date().toISOString() };
  return { suppliers: [...current.suppliers, supplier], id: supplier.id };
}

/** Every purchase with its supplier, as the suppliers' stats read them. */
function demoSupplierPurchases(current: Store): SupplierPurchase[] {
  const materialId = (name: string | null | undefined) => demoState.materials.find((material) => material.name === name)?.id ?? null;
  const unitOf = (id: string | null) => demoState.materials.find((material) => material.id === id)?.purchaseUnit ?? null;
  const seen = new Set<string>();
  const recorded = [...current.records.purchases, ...current.records.investments].filter((purchase) => !seen.has(purchase.id) && seen.add(purchase.id)).map((purchase): SupplierPurchase => {
    const id = materialId(purchase.materialName);
    return { id: purchase.id, supplierId: purchase.supplierId ?? null, purchasedOn: purchase.purchasedOn, description: purchase.description, kind: purchase.kind, amountMinor: purchase.amountMinor, materialId: id, materialName: purchase.materialName ?? null, quantityMilli: purchase.quantityMilli ?? null, purchaseUnit: unitOf(id) };
  });
  return [...recorded, ...current.supplierHistory].sort((a, b) => b.purchasedOn.localeCompare(a.purchasedOn));
}

function demoSupplierRows(current: Store): SupplierRow[] {
  const purchases = demoSupplierPurchases(current);
  return current.suppliers.map((supplier) => {
    const own = purchases.filter((purchase) => purchase.supplierId === supplier.id);
    const prices = materialPrices(own);
    const key = supplierKey(supplier.name);
    const zones = current.zones.filter((zone) => zone.mode === "carrier" && supplierKey(zone.carrier) === key);
    const carried = current.deliveries.filter((delivery) => supplierKey(delivery.carrier) === key || zones.some((zone) => zone.id === delivery.zoneId));
    const sales = new Map(current.records.sales.map((sale) => [sale.id, sale]));
    const tally = carried.length ? carried.reduce((sum, delivery) => tallyDelivery(sum, delivery, sales.get(delivery.saleId)?.deliveryCostMinor ?? delivery.costMinor, DEMO_TODAY), emptyTally()) : null;
    return {
      ...supplier, stats: supplierStats(own, DEMO_TODAY), prices,
      materials: [...new Set([...prices.map((price) => price.name), ...demoState.materials.filter((material) => supplierKey(material.supplier) === key).map((material) => material.name)])],
      zones: zones.map((zone) => zone.name), deliveries: tally,
    };
  });
}

/** The demo's suppliers, like /api/suppliers/list. */
export function demoSupplierList() {
  return { suppliers: sortSuppliers(demoSupplierRows(data())), today: DEMO_TODAY };
}

/** One demo supplier, like /api/suppliers/[id]. */
export function demoSupplierDetail(id: string) {
  const current = data();
  const supplier = demoSupplierRows(current).find((row) => row.id === id);
  if (!supplier) throw new DemoError("Proveedor no encontrado");
  const purchases = demoSupplierPurchases(current).filter((purchase) => purchase.supplierId === id);
  return { supplier, months: supplierMonths(purchases, monthsBack(DEMO_TODAY.slice(0, 7), 12)), purchases: purchases.slice(0, 60), today: DEMO_TODAY };
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
  const { records, deliveries, zones } = data();
  const bySale = new Map(deliveries.map((item) => [item.saleId, { id: item.id, status: item.status, scheduledOn: item.scheduledOn, deliveredOn: item.deliveredOn, zoneId: item.zoneId, zoneName: zones.find((zone) => zone.id === item.zoneId)?.name ?? "", carrier: item.carrier }]));
  return { ...records, sales: records.sales.map((sale) => ({ ...sale, delivery: bySale.get(sale.id) ?? null })) };
}

/** The demo's deliveries of a month plus the open ones, closest to the demo's today first. */
export function demoDeliveryList(month: string): Delivery[] {
  const { records, deliveries, zones } = data();
  const sales = new Map(records.sales.map((sale) => [sale.id, sale]));
  const list = deliveries.filter((item) => item.scheduledOn.startsWith(month) || ["pending", "on_the_way", "failed"].includes(item.status)).map((item) => {
    const sale = sales.get(item.saleId);
    const zoneName = zones.find((zone) => zone.id === item.zoneId)?.name ?? item.zoneName;
    return sale ? { ...item, zoneName, costMinor: sale.deliveryCostMinor, sale: { soldOn: sale.soldOn, channelId: sale.channelId, channelName: sale.channelName, customer: sale.customer, totalMinor: sale.totalMinor, items: saleItemsText(sale.items) } } : item;
  });
  return byProximity(list, (item) => item.scheduledOn, DEMO_TODAY);
}

/** The demo's zones and where its customers receive, like /api/deliveries adds them. */
export function demoZoneData(): { zones: DeliveryZone[]; places: { zone: string; address: string }[]; routeOrigin: string } {
  const { zones, customers, routeOrigin } = data();
  return { zones, routeOrigin, places: customers.flatMap((customer) => customer.addresses.map((address) => ({ zone: address.zone, address: address.address }))) };
}

/** What was typed before in the demo, for its suggestions. */
export function demoCustomerDirectory(): CustomerDirectory {
  const { records, deliveries } = data();
  const bySale = new Map(deliveries.map((item) => [item.saleId, item]));
  const typed = buildCustomerDirectory(records.sales.map((sale) => { const delivery = bySale.get(sale.id); return { customer: sale.customer, soldOn: sale.soldOn, recipient: delivery?.recipient, address: delivery?.address, contact: delivery?.contact, carrier: delivery?.carrier }; }));
  return directoryFromCustomers(demoCustomerList().customers, typed);
}

class DemoError extends Error {}

type DeliveryFields = Partial<Pick<Delivery, "scheduledOn" | "timeWindow" | "status" | "method" | "carrier" | "recipient" | "address" | "contact" | "tracking" | "note" | "deliveredOn">> & { zoneId?: string | null };

/** The zone of a delivery in the demo: the one chosen (null for none) or the one its address falls in. */
function demoZoneFor(zones: DeliveryZone[], zoneId: string | null | undefined, address: string | undefined, zoneText?: string): DeliveryZone | null {
  if (zoneId === null) return null;
  if (zoneId) { const chosen = zones.find((zone) => zone.id === zoneId); if (!chosen) throw new DemoError("Zona de entrega no encontrada"); return chosen; }
  return matchZone(zones, { zone: zoneText, address });
}

function newDelivery(sale: Sale, channel: Pick<SalesChannel, "deliveryMethod">, input: DeliveryFields, zone: DeliveryZone | null = null): Delivery {
  const given = zone ? zoneDeliveryFields(zone) : null;
  const fields = { ...input, method: input.method || given?.method, carrier: input.carrier || given?.carrier || undefined, scheduledOn: input.scheduledOn ?? (zone ? nextDeliveryDay(zone, sale.soldOn) : undefined) };
  const scheduledOn = fields.scheduledOn ?? sale.soldOn;
  const status = fields.status ?? initialDeliveryStatus(scheduledOn, DEMO_TODAY);
  return {
    id: `e-${Math.random().toString(36).slice(2, 10)}`, saleId: sale.id, scheduledOn, timeWindow: fields.timeWindow ?? "", status, method: fields.method ?? channel.deliveryMethod,
    carrier: fields.carrier ?? "", recipient: fields.recipient ?? sale.customer, address: fields.address ?? "", contact: fields.contact ?? "", tracking: fields.tracking ?? "", note: fields.note ?? "",
    deliveredOn: status === "delivered" ? fields.deliveredOn ?? (scheduledOn < DEMO_TODAY ? scheduledOn : DEMO_TODAY) : null, zoneId: zone?.id ?? null, zoneName: zone?.name ?? "", routePosition: null, source: "user", costMinor: sale.deliveryCostMinor,
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
      const draft: Sale = { id: `v-${Math.random().toString(36).slice(2, 8)}`, soldOn: input.soldOn, channelId: channel.id === DIRECT_CHANNEL.id ? null : channel.id, channelName: channel.name, customer: input.customer ?? "", customerId: resolved.id, note: input.note ?? "", documentId: null, source: "user", ...priced };
      const main = resolved.customers.find((customer) => customer.id === resolved.id)?.addresses.find((address) => address.isDefault);
      const fields: DeliveryFields = { ...input.delivery, ...(!input.delivery?.address?.trim() && main ? { address: main.address, recipient: input.delivery?.recipient || main.recipient || undefined, contact: input.delivery?.contact || main.contact || undefined } : {}) };
      const delivers = Boolean(input.delivery) || needsDelivery(channel, input.deliveryCost);
      const zone = delivers ? demoZoneFor(current.zones, input.delivery?.zoneId, fields.address, !input.delivery?.address?.trim() ? main?.zone : undefined) : null;
      const fromZone = zone && input.deliveryCost === undefined ? zoneCost(zone) : null;
      const sale: Sale = fromZone !== null ? { ...draft, deliveryCostMinor: fromZone } : draft;
      const delivery = delivers ? newDelivery(sale, channel, fields, zone) : null;
      const customers = demoLearnAddress(resolved.customers, resolved.id, delivery?.address, delivery?.recipient, delivery?.contact);
      commit({ ...current, customers, records: { ...current.records, sales: [sale, ...current.records.sales] }, deliveries: delivery ? [...current.deliveries, delivery] : current.deliveries });
      return { id: sale.id, duplicate: false, sale } as T;
    }
    case "update-sale": {
      const sale = current.records.sales.find((item) => item.id === body.id);
      if (!sale) throw new DemoError("Venta no encontrada");
      const patch = { ...(body.patch as SalePatch) };
      // Like the server: another channel keeps a cancelled delivery at no cost and a zone's own cost.
      if (patch.channelId !== undefined && (patch.channelId ?? null) !== sale.channelId && patch.deliveryCost === undefined) {
        const delivery = current.deliveries.find((item) => item.saleId === sale.id);
        const zone = delivery?.zoneId ? current.zones.find((item) => item.id === delivery.zoneId) : undefined;
        const own = delivery?.status === "cancelled" ? 0 : zone ? zoneCost(zone) : null;
        if (own !== null) patch.deliveryCost = own;
      }
      const { sale: next, problems } = repriceSale(sale, patch, demoState, costs, current.records.channels);
      if (problems.length) throw new DemoError(problems.join(". "));
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
        const fields: DeliveryFields = Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== undefined && !["id", "saleId", "cost", "zoneId"].includes(key)));
        if (fields.status === "delivered" && existing.status !== "delivered" && fields.deliveredOn === undefined) fields.deliveredOn = DEMO_TODAY;
        if (fields.status && fields.status !== "delivered" && fields.deliveredOn === undefined) fields.deliveredOn = null;
        // A zone chosen by hand, or an address that falls in another zone, moves it there with the zone's cost.
        const zone = input.zoneId !== undefined ? demoZoneFor(current.zones, input.zoneId, undefined) : input.address?.trim() ? demoZoneFor(current.zones, undefined, input.address) : undefined;
        const moved = zone !== undefined && (zone?.id ?? null) !== existing.zoneId;
        const given = moved && zone ? zoneDeliveryFields(zone) : null;
        const rescheduled = fields.scheduledOn !== undefined && fields.scheduledOn !== existing.scheduledOn;
        deliveries = deliveries.map((item) => item.id === id ? { ...item, ...fields, ...(rescheduled ? { routePosition: null } : {}), ...(moved ? { zoneId: zone?.id ?? null, zoneName: zone?.name ?? "", ...(given ? { method: input.method ?? given.method, carrier: input.carrier ?? given.carrier } : {}) } : {}) } : item);
        const cost = moved && zone && input.cost === undefined ? zoneCost(zone) : null;
        if (cost !== null) sales = sales.map((item) => item.id === saleId ? { ...item, deliveryCostMinor: cost } : item);
        if (input.status) done.push(`Entrega: ${DELIVERY_STATUS_LABELS[input.status]}`);
        else if (moved) done.push(zone ? `Zona: ${zone.name}${cost !== null ? " (costo de la zona aplicado)" : ""}` : "Entrega sin zona");
        else done.push("Entrega actualizada");
        // Like the server: a cancelled delivery costs nothing; bringing it back restores its zone's or its channel's cost.
        const cancelling = input.status === "cancelled" && existing.status !== "cancelled";
        const reopening = existing.status === "cancelled" && input.status !== undefined && input.status !== "cancelled";
        if (input.cost === undefined && (cancelling || reopening)) {
          const zoneNow = current.zones.find((item) => item.id === (moved ? zone?.id : existing.zoneId));
          const sale = sales.find((item) => item.id === saleId);
          const restored = cancelling ? 0 : (zoneNow ? zoneCost(zoneNow) : null) ?? channelOf(sale?.channelId)?.deliveryCostPerOrderMinor ?? 0;
          sales = sales.map((item) => item.id === saleId ? { ...item, deliveryCostMinor: restored } : item);
          done.push(cancelling ? "Costo de entrega en 0: la entrega se canceló" : "Costo de entrega restituido");
        }
      } else {
        const sale = sales.find((item) => item.id === saleId);
        if (!sale) throw new DemoError("Venta no encontrada");
        if (deliveries.some((item) => item.saleId === sale.id)) throw new DemoError("Esa venta ya tiene una entrega: cámbiala en lugar de crear otra");
        const owner = current.customers.find((customer) => customer.id === sale.customerId);
        const main = owner?.addresses.find((address) => address.isDefault);
        const zone = demoZoneFor(current.zones, input.zoneId, input.address || main?.address, input.address ? undefined : main?.zone);
        const channel = channelOf(sale.channelId) ?? DIRECT_CHANNEL;
        const delivery = newDelivery(sale, channel, { ...input, address: input.address || main?.address }, zone);
        id = delivery.id;
        deliveries = [...deliveries, delivery];
        const cost = input.cost !== undefined || delivery.status === "cancelled" ? null : zone ? zoneCost(zone) : null;
        const fallback = input.cost === undefined && cost === null && delivery.status !== "cancelled" && !sale.deliveryCostMinor && channel.deliveryCostPerOrderMinor > 0 ? channel.deliveryCostPerOrderMinor : null;
        if (cost !== null || fallback !== null) sales = sales.map((item) => item.id === sale.id ? { ...item, deliveryCostMinor: (cost ?? fallback)! } : item);
        done.push(`Entrega programada para el ${delivery.scheduledOn}`);
      }
      if (input.cost !== undefined) { sales = sales.map((item) => item.id === saleId ? { ...item, deliveryCostMinor: roundMoney(input.cost!, demoState.organization.currency) } : item); done.push("Costo de entrega actualizado"); }
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
    case "save-zone": {
      const input = body.zone as { id?: string; name: string; mode?: ZoneMode; carrier?: string; areas?: string[] | string; costPerOrder?: number; weekdays?: (number | string)[]; leadDays?: number; isFallback?: boolean; notes?: string };
      const name = input.name?.trim() ?? "";
      if (name.length < 2) throw new DemoError("Escribe el nombre de la zona");
      const existing = input.id ? current.zones.find((zone) => zone.id === input.id) : undefined;
      if (input.id && !existing) throw new DemoError("Zona de entrega no encontrada");
      if (current.zones.some((zone) => zone.id !== input.id && customerKey(zone.name) === customerKey(name))) throw new DemoError(`Ya hay una zona llamada ${name}`);
      const mode = input.mode ?? "own";
      const zone: DeliveryZone = {
        id: existing?.id ?? `z-${Math.random().toString(36).slice(2, 8)}`, name, mode, carrier: mode === "pickup" ? "" : input.carrier ?? "",
        areas: typeof input.areas === "string" ? parseAreas(input.areas) : parseAreas((input.areas ?? []).join(",")), costPerOrderMinor: mode === "pickup" ? 0 : Math.round(input.costPerOrder ?? 0),
        weekdays: weekdaysFromNames(input.weekdays ?? []), leadDays: input.leadDays ?? 0, isFallback: mode !== "pickup" && Boolean(input.isFallback), notes: input.notes ?? "",
      };
      const zones = [...current.zones.filter((item) => item.id !== zone.id).map((item) => zone.isFallback ? { ...item, isFallback: false } : item), zone];
      const given = zoneDeliveryFields(zone);
      let assigned = 0;
      const fallback = zone.isFallback ? undefined : current.zones.find((item) => item.isFallback && item.id !== zone.id);
      const deliveries = current.deliveries.map((item) => {
        const movable = !item.zoneId || item.zoneId === fallback?.id;
        if (!movable || !["pending", "on_the_way", "failed"].includes(item.status) || matchZone(zones, { address: item.address })?.id !== zone.id) return item;
        assigned += 1;
        return item.zoneId ? { ...item, zoneId: zone.id, zoneName: zone.name, ...given } : { ...item, zoneId: zone.id, zoneName: zone.name, method: item.method || given.method, carrier: item.carrier || given.carrier };
      });
      const carrier = zone.mode === "carrier" ? demoResolveSupplier(current, zone.carrier, "logistics") : null;
      commit({ ...current, zones, deliveries, ...(carrier ? { suppliers: carrier.suppliers } : {}) });
      const done = [existing ? `Zona actualizada: ${zone.name}` : `Zona creada: ${zone.name} (${ZONE_MODE_LABELS[zone.mode].toLowerCase()})`];
      if (assigned) done.push(`${assigned} entrega${assigned === 1 ? " abierta quedó" : "s abiertas quedaron"} en ${zone.name}`);
      return { id: zone.id, created: !existing, assigned, done } as T;
    }
    case "save-route-order": {
      const ids = body.ids as string[];
      commit({ ...current, deliveries: current.deliveries.map((item) => ids.includes(item.id) ? { ...item, routePosition: ids.indexOf(item.id) } : item) });
      return { done: [`Orden de la ruta guardado (${ids.length} parada${ids.length === 1 ? "" : "s"})`] } as T;
    }
    case "save-route-origin": {
      const origin = String(body.origin ?? "").trim().slice(0, 200);
      commit({ ...current, routeOrigin: origin });
      return { done: [origin ? `Las rutas salen desde ${origin}` : "Las rutas salen desde donde esté el repartidor"] } as T;
    }
    case "save-supplier": {
      const input = body.supplier as { id?: string; name?: string; kind?: SupplierKind; contactName?: string; phone?: string; email?: string; notes?: string };
      const name = input.name?.trim();
      if (name !== undefined && !supplierKey(name)) throw new DemoError("Escribe el nombre del proveedor");
      const taken = name ? current.suppliers.find((supplier) => supplierKey(supplier.name) === supplierKey(name) && supplier.id !== input.id) : undefined;
      if (taken) throw new DemoError(`Ya hay un proveedor llamado ${taken.name}${input.id ? ": si es el mismo, únelos" : ""}`);
      if (!input.id) {
        if (!name) throw new DemoError("Escribe el nombre del proveedor");
        const supplier: Supplier = { id: `pr-${Math.random().toString(36).slice(2, 8)}`, name, kind: input.kind ?? "materials", contactName: input.contactName ?? "", phone: input.phone ?? "", email: input.email ?? "", notes: input.notes ?? "", source: "user", createdAt: new Date().toISOString() };
        commit({ ...current, suppliers: [...current.suppliers, supplier] });
        return { id: supplier.id, created: true, done: [`Proveedor creado: ${name}`] } as T;
      }
      const existing = current.suppliers.find((supplier) => supplier.id === input.id);
      if (!existing) throw new DemoError("Proveedor no encontrado");
      const next = { ...existing, ...Object.fromEntries(Object.entries({ ...input, name }).filter(([key, value]) => value !== undefined && key !== "id")) } as Supplier;
      const rename = <P extends { supplierId?: string | null; supplier: string }>(purchase: P): P => purchase.supplierId === existing.id && name ? { ...purchase, supplier: name } : purchase;
      commit({ ...current, suppliers: current.suppliers.map((supplier) => supplier.id === existing.id ? next : supplier), records: { ...current.records, purchases: current.records.purchases.map(rename), investments: current.records.investments.map(rename) }, supplierHistory: current.supplierHistory.map(rename),
        zones: name ? current.zones.map((zone) => zone.mode === "carrier" && supplierKey(zone.carrier) === supplierKey(existing.name) ? { ...zone, carrier: name } : zone) : current.zones });
      return { id: existing.id, created: false, done: [name && name !== existing.name ? `Proveedor renombrado: ${existing.name} → ${name}` : `Datos de ${next.name} actualizados`] } as T;
    }
    case "merge-suppliers": {
      const { fromId, intoId } = body as unknown as { fromId: string; intoId: string };
      const from = current.suppliers.find((supplier) => supplier.id === fromId);
      const into = current.suppliers.find((supplier) => supplier.id === intoId);
      if (!from || !into || fromId === intoId) throw new DemoError("Elige otro proveedor para unir");
      const move = <P extends { supplierId?: string | null; supplier: string }>(purchase: P): P => purchase.supplierId === fromId ? { ...purchase, supplierId: intoId, supplier: into.name } : purchase;
      commit({ ...current, suppliers: current.suppliers.filter((supplier) => supplier.id !== fromId), records: { ...current.records, purchases: current.records.purchases.map(move), investments: current.records.investments.map(move) }, supplierHistory: current.supplierHistory.map(move) });
      return { done: [`${from.name} quedó unido a ${into.name}`] } as T;
    }
    case "archive-supplier": {
      const { id } = body as unknown as { id: string };
      const unlink = <P extends { supplierId?: string | null }>(purchase: P): P => purchase.supplierId === id ? { ...purchase, supplierId: null } : purchase;
      commit({ ...current, suppliers: current.suppliers.filter((supplier) => supplier.id !== id), records: { ...current.records, purchases: current.records.purchases.map(unlink), investments: current.records.investments.map(unlink) }, supplierHistory: current.supplierHistory.map(unlink) });
      return { ok: true } as T;
    }
    case "archive-zone": {
      const { id } = body as unknown as { id: string };
      const zone = current.zones.find((item) => item.id === id);
      if (!zone) throw new DemoError("Zona de entrega no encontrada");
      commit({ ...current, zones: current.zones.filter((item) => item.id !== id), deliveries: current.deliveries.map((item) => item.zoneId === id && ["pending", "on_the_way", "failed"].includes(item.status) ? { ...item, zoneId: null, zoneName: "" } : item) });
      return { done: [`Zona quitada: ${zone.name}`] } as T;
    }
    case "archive": {
      const { kind, id } = body as unknown as { kind: "channel" | "purchase" | "sale" | "delivery"; id: string };
      const records = { ...current.records };
      let deliveries = current.deliveries;
      if (kind === "sale") { records.sales = records.sales.filter((item) => item.id !== id); deliveries = deliveries.filter((item) => item.saleId !== id); }
      if (kind === "purchase") { records.purchases = records.purchases.filter((item) => item.id !== id); records.investments = records.investments.filter((item) => item.id !== id); }
      if (kind === "channel") records.channels = records.channels.filter((item) => item.id !== id);
      if (kind === "delivery") {
        // A sale left without its delivery stops carrying a delivery cost.
        const saleId = deliveries.find((item) => item.id === id)?.saleId;
        deliveries = deliveries.filter((item) => item.id !== id);
        records.sales = records.sales.map((item) => item.id === saleId ? { ...item, deliveryCostMinor: 0 } : item);
      }
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
      const resolved = demoResolveSupplier(current, purchase.supplier, kindForPurchase(purchase.kind));
      const linked = { ...purchase, supplierId: resolved.id };
      commit({ ...current, suppliers: resolved.suppliers, records: { ...current.records, purchases: [linked, ...current.records.purchases], investments: linked.kind === "investment" ? [linked, ...current.records.investments] : current.records.investments } });
      return { id: linked.id, duplicate: false, purchase: linked, priceUpdated: null } as T;
    }
    case "update-purchase": {
      const patch = body.patch as Partial<{ purchasedOn: string; description: string; supplier: string; amount: number; area: CostArea; usefulLifeMonths: number }>;
      const relinked = patch.supplier !== undefined ? demoResolveSupplier(current, patch.supplier, "services") : null;
      const update = (item: Purchase): Purchase => item.id !== body.id ? item : {
        ...item, purchasedOn: patch.purchasedOn ?? item.purchasedOn, description: patch.description ?? item.description, supplier: patch.supplier ?? item.supplier,
        ...(relinked ? { supplierId: relinked.id } : {}),
        amountMinor: patch.amount ?? item.amountMinor, area: patch.area ?? item.area, usefulLifeMonths: patch.usefulLifeMonths ?? item.usefulLifeMonths,
      };
      const target = [...current.records.purchases, ...current.records.investments].find((item) => item.id === body.id);
      if (!target) throw new DemoError("Compra no encontrada");
      if (target.kind === "investment" && target.includeInUnitCost && (patch.amount !== undefined || patch.usefulLifeMonths !== undefined || patch.area !== undefined || patch.purchasedOn !== undefined)) throw new DemoError("Esta inversión se suma al costo de cada producto: para cambiar su monto, vida útil, área o fecha, primero quítala del costo en Gastos de la empresa.");
      commit({ ...current, ...(relinked ? { suppliers: relinked.suppliers } : {}), records: { ...current.records, purchases: current.records.purchases.map(update), investments: current.records.investments.map(update) } });
      return { ok: true } as T;
    }
    default:
      throw new DemoError("En la demostración esta acción no está disponible");
  }
}

