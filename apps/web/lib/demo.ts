import { calculateCosts, type DomainState } from "./domain";
import { snapshotRowsFor } from "./cost-snapshots";
import { byProximity, priceSale, saleItemsText, type BusinessRecords, type Delivery, type Purchase, type Sale, type SalesChannel } from "./business";

export const demoState: DomainState = {
  revision: 3,
  activePeriod: "2026-09",
  organization: { id: "demo", name: "Taller Norte", currency: "CLP", country: "CL", city: "Santiago", timeZone: "America/Santiago" },
  products: [
    { id: "dura", name: "Cuaderno A5 · tapa dura", lotUnits: 100, salePriceMinor: 5500, salesVariableMinor: 490, laborLotMinor: 60000, productionHoursMilli: 20000, version: 1 },
    { id: "blanda", name: "Cuaderno A5 · tapa blanda", lotUnits: 100, salePriceMinor: 4300, salesVariableMinor: 360, laborLotMinor: 60000, productionHoursMilli: 15000, version: 1 },
    { id: "bolsillo", name: "Libreta bolsillo", lotUnits: 100, salePriceMinor: 3200, salesVariableMinor: 280, laborLotMinor: 64000, productionHoursMilli: 12000, version: 1 },
  ],
  materials: [
    { id: "papel", name: "Papel interior", supplier: "Papelería Sur", purchaseUnit: "resma", category: "Papel", priceMinor: 9000, source: "Factura 1842", effectiveDate: "2026-09-18", version: 1 },
    { id: "d", name: "Tapas rígidas", supplier: "Tapas Centro", purchaseUnit: "juego", category: "Tapas", priceMinor: 750, source: "Compra", effectiveDate: "2026-09-18", version: 1 },
    { id: "b", name: "Tapas blandas", supplier: "Tapas Centro", purchaseUnit: "juego", category: "Tapas", priceMinor: 520, source: "Compra", effectiveDate: "2026-09-18", version: 1 },
    { id: "p", name: "Tapas bolsillo", supplier: "Tapas Centro", purchaseUnit: "juego", category: "Tapas", priceMinor: 380, source: "Compra", effectiveDate: "2026-09-18", version: 1 },
    { id: "anillado", name: "Anillado", supplier: "Metal Sur", purchaseUnit: "unidad", category: "Terminaciones", priceMinor: 360, source: "Compra", effectiveDate: "2026-09-18", version: 1 },
    { id: "enc", name: "Encuadernación", supplier: "Taller", purchaseUnit: "unidad", category: "Terminaciones", priceMinor: 240, source: "Compra", effectiveDate: "2026-09-18", version: 1 },
  ],
  components: [
    { productId: "dura", materialId: "papel", quantityMilli: 10000 },
    { productId: "dura", materialId: "d", quantityMilli: 100000 },
    { productId: "dura", materialId: "anillado", quantityMilli: 100000 },
    { productId: "blanda", materialId: "papel", quantityMilli: 8000 },
    { productId: "blanda", materialId: "b", quantityMilli: 100000 },
    { productId: "blanda", materialId: "anillado", quantityMilli: 83333 },
    { productId: "bolsillo", materialId: "papel", quantityMilli: 4000 },
    { productId: "bolsillo", materialId: "p", quantityMilli: 100000 },
    { productId: "bolsillo", materialId: "enc", quantityMilli: 100000 },
  ],
  expenses: [
    { id: "electricidad", name: "Electricidad", period: "2026-09", amountMinor: 45000, allocationBasis: "hours", category: "Servicios", version: 1 },
    { id: "gas", name: "Gas", period: "2026-09", amountMinor: 24000, allocationBasis: "hours", category: "Servicios", version: 1 },
    { id: "espacio", name: "Espacio", period: "2026-09", amountMinor: 25000, allocationBasis: "hours", category: "Instalaciones", version: 1 },
    { id: "moto", name: "Envíos en moto", period: "2026-09", area: "delivery", amountMinor: 60000, allocationBasis: "units", category: "Envíos", version: 1 },
    { id: "publicidad", name: "Publicidad en Instagram", period: "2026-09", area: "sales", amountMinor: 35000, allocationBasis: "units", category: "Publicidad", version: 1 },
    { id: "contador", name: "Contador", period: "2026-09", area: "admin", amountMinor: 55000, allocationBasis: "units", category: "Servicios profesionales", version: 1 },
    { id: "software", name: "Software de facturación", period: "2026-09", area: "admin", amountMinor: 12000, allocationBasis: "units", category: "Servicios", version: 1 },
  ],
};

export const demoDashboard = { ...demoState, costs: calculateCosts(demoState), alerts: [] };

/** Four months of example history for the demo: paper and electricity rise, a lot size improves. */
export function demoHistory() {
  const month = (offset: number, change: (state: typeof demoState) => void) => {
    const state = structuredClone(demoState);
    state.products.forEach((product) => { product.batchesPerMonthMilli = 8000; });
    change(state);
    return snapshotRowsFor(state, `2026-0${6 + offset}-15 12:00:00`);
  };
  return [
    ...month(0, (state) => { state.materials[0].priceMinor = 8200; state.expenses[0].amountMinor = 38000; }),
    ...month(1, (state) => { state.materials[0].priceMinor = 8600; state.expenses[0].amountMinor = 41000; }),
    ...month(2, (state) => { state.materials[0].priceMinor = 9000; state.expenses[0].amountMinor = 45000; state.products[2].lotUnits = 90; }),
    ...month(3, (state) => { state.materials[0].priceMinor = 9800; state.expenses[0].amountMinor = 52000; }),
  ];
}

/** The month the demo's purchases and sales belong to. */
export const DEMO_MONTH = "2026-09";

/** The demo runs on its own clock, so its "today", "tomorrow" and "late" stay true whenever it is visited. */
export const DEMO_TODAY = "2026-09-26";

/** Example sales channels, purchases and sales for the demo's business sections. */
export function demoBusinessRecords(): BusinessRecords {
  const costs = calculateCosts(demoState);
  const channels: SalesChannel[] = [
    { id: "tienda", name: "Tienda online", deliveryMethod: "Correo", commissionBps: 450, feePerOrderMinor: 0, deliveryCostPerOrderMinor: 3500, unitsPerOrderMilli: 3000, priceAdjustmentBps: 0 },
    { id: "feria", name: "Ferias", deliveryMethod: "En mano", commissionBps: 0, feePerOrderMinor: 0, deliveryCostPerOrderMinor: 0, unitsPerOrderMilli: 1000, priceAdjustmentBps: 0 },
    { id: "librerias", name: "Librerías (por mayor)", deliveryMethod: "Moto propia", commissionBps: 0, feePerOrderMinor: 0, deliveryCostPerOrderMinor: 6000, unitsPerOrderMilli: 60000, priceAdjustmentBps: -3000 },
  ];
  const sale = (id: string, soldOn: string, channel: SalesChannel, items: { productId: string; quantity: number }[]): Sale => {
    const priced = priceSale(demoState, costs, channel, items);
    return { id, soldOn, channelId: channel.id, channelName: channel.name, customer: "", note: "", documentId: null, source: "cozte", items: priced.items, totalMinor: priced.totalMinor, sellingCostMinor: priced.sellingCostMinor, deliveryCostMinor: priced.deliveryCostMinor, variableCostMinor: priced.variableCostMinor, productionCostMinor: priced.productionCostMinor };
  };
  const [tienda, feria, librerias] = channels;
  const purchases: Purchase[] = [
    { id: "c1", purchasedOn: "2026-09-02", description: "Resmas de papel", supplier: "Papelería Sur", amountMinor: 360000, kind: "material", area: "production", materialName: "Papel interior", quantityMilli: 40000, source: "cozte" },
    { id: "c2", purchasedOn: "2026-09-05", description: "Cinta de embalaje y cajas", supplier: "Embalajes Norte", amountMinor: 18500, kind: "expense", area: "delivery", source: "cozte" },
    { id: "c3", purchasedOn: "2026-09-08", description: "Pago de electricidad", supplier: "Compañía eléctrica", amountMinor: 51200, kind: "fixed_payment", area: "production", expenseId: "electricidad", expenseName: "Electricidad", source: "user" },
    { id: "c4", purchasedOn: "2026-09-10", description: "Notebook para administración", supplier: "Tienda Tech", amountMinor: 540000, kind: "investment", area: "admin", usefulLifeMonths: 36, source: "cozte" },
    { id: "c5", purchasedOn: "2026-09-15", description: "Pintura para el taller", supplier: "Pinturería Centro", amountMinor: 32000, kind: "expense", area: "production", source: "cozte" },
    { id: "c6", purchasedOn: "2026-09-20", description: "Guillotina manual", supplier: "Herramientas Sur", amountMinor: 180000, kind: "investment", area: "production", usefulLifeMonths: 60, source: "user" },
  ];
  return {
    channels, purchases,
    investments: purchases.filter((item) => item.kind === "investment"),
    sales: [
      sale("v6", "2026-09-25", tienda, [{ productId: "bolsillo", quantity: 5 }]),
      sale("v1", "2026-09-22", librerias, [{ productId: "bolsillo", quantity: 80 }]),
      sale("v2", "2026-09-19", tienda, [{ productId: "bolsillo", quantity: 4 }, { productId: "blanda", quantity: 2 }]),
      sale("v3", "2026-09-18", tienda, [{ productId: "dura", quantity: 3 }]),
      sale("v4", "2026-09-12", feria, [{ productId: "dura", quantity: 25 }, { productId: "blanda", quantity: 30 }, { productId: "bolsillo", quantity: 40 }]),
      sale("v5", "2026-09-04", librerias, [{ productId: "dura", quantity: 60 }, { productId: "blanda", quantity: 60 }]),
    ].map((item) => {
      const delivery = DEMO_DELIVERY_DETAILS[item.id];
      return delivery ? { ...item, customer: delivery.recipient, delivery: { id: `e-${item.id}`, status: delivery.status, scheduledOn: delivery.scheduledOn, deliveredOn: delivery.deliveredOn } } : item;
    }),
  };
}

/** Logistics of the demo's sales: one delivered long ago, one on the way today, one that failed and one coming up. */
const DEMO_DELIVERY_DETAILS: Record<string, Pick<Delivery, "scheduledOn" | "timeWindow" | "status" | "carrier" | "recipient" | "address" | "contact" | "tracking" | "note" | "deliveredOn">> = {
  v6: { scheduledOn: "2026-09-28", timeWindow: "9 a 13", status: "pending", carrier: "Correo Andreani", recipient: "Lucía Ferreyra", address: "Av. Colón 1450, Córdoba", contact: "351 555 0142", tracking: "", note: "Timbre 3B", deliveredOn: null },
  v1: { scheduledOn: "2026-09-23", timeWindow: "Mañana", status: "delivered", carrier: "Moto propia (Tomás)", recipient: "Librería El Ateneo", address: "San Martín 220", contact: "Depósito, preguntar por Marta", tracking: "", note: "", deliveredOn: "2026-09-23" },
  v2: { scheduledOn: "2026-09-26", timeWindow: "14 a 18", status: "on_the_way", carrier: "Correo Andreani", recipient: "Martín Ruiz", address: "Belgrano 88, Rosario", contact: "341 555 0199", tracking: "AND-4821-77", note: "", deliveredOn: null },
  v3: { scheduledOn: "2026-09-24", timeWindow: "", status: "failed", carrier: "Correo Andreani", recipient: "Sofía Paz", address: "Mitre 1020, Mendoza", contact: "261 555 0110", tracking: "AND-4790-12", note: "No había nadie: reprogramar", deliveredOn: null },
  v5: { scheduledOn: "2026-09-05", timeWindow: "Tarde", status: "delivered", carrier: "Moto propia (Tomás)", recipient: "Librería Rayuela", address: "Caseros 540", contact: "", tracking: "", note: "", deliveredOn: "2026-09-05" },
};

/** The demo's deliveries, closest to the demo's today first. */
export function demoDeliveries(today = DEMO_TODAY): Delivery[] {
  const records = demoBusinessRecords();
  const list = records.sales.flatMap((sale): Delivery[] => {
    const details = DEMO_DELIVERY_DETAILS[sale.id];
    if (!details) return [];
    const channel = records.channels.find((item) => item.id === sale.channelId);
    return [{ id: `e-${sale.id}`, saleId: sale.id, ...details, method: channel?.deliveryMethod ?? "", source: "cozte", costMinor: sale.deliveryCostMinor, sale: { soldOn: sale.soldOn, channelId: sale.channelId, channelName: sale.channelName, customer: sale.customer, totalMinor: sale.totalMinor, items: saleItemsText(sale.items) } }];
  });
  return byProximity(list, (item) => item.scheduledOn, today);
}

/**
 * Earlier months of the demo business, only for the analysis section: sales that grow and dip like a real small
 * business (the book fair in July, a school-start peak in March... here April to August), priced by the same engine.
 * Deterministic, so every visit shows the same history.
 */
export function demoHistorySales(): Sale[] {
  const costs = calculateCosts(demoState);
  const { channels } = demoBusinessRecords();
  const [tienda, feria, librerias] = channels;
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const months: { month: string; strength: number }[] = [
    { month: "2026-04", strength: 0.55 }, { month: "2026-05", strength: 0.7 }, { month: "2026-06", strength: 0.62 },
    { month: "2026-07", strength: 1.05 }, { month: "2026-08", strength: 0.85 },
  ];
  const sales: Sale[] = [];
  const people = ["Lucía Ferreyra", "Martín Ruiz", "Sofía Paz", "Carla Gómez", "Diego Luna", "Valentina Ríos"];
  const shops = ["Librería El Ateneo", "Librería Rayuela", "Papelería Norte"];
  const customerFor = (channel: SalesChannel, month: string) => {
    if (channel.id === "feria") return "";
    // Carla bought only in April and Papelería Norte stopped after June: they show as inactive or at risk.
    const pool = channel.id === "librerias" ? shops.filter((name) => name !== "Papelería Norte" || month <= "2026-06") : people.filter((name) => name !== "Carla Gómez" || month === "2026-04");
    return pool[Math.floor(random() * pool.length)];
  };
  for (const { month, strength } of months) {
    const plan: { channel: SalesChannel; items: { productId: string; base: number }[]; count: number }[] = [
      { channel: tienda, items: [{ productId: "bolsillo", base: 4 }, { productId: "blanda", base: 2 }], count: Math.round(5 * strength + random() * 2) },
      { channel: feria, items: [{ productId: "dura", base: 20 }, { productId: "blanda", base: 22 }, { productId: "bolsillo", base: 30 }], count: strength > 0.9 ? 2 : 1 },
      { channel: librerias, items: [{ productId: "dura", base: 45 }, { productId: "blanda", base: 40 }, { productId: "bolsillo", base: 50 }], count: strength > 0.6 ? 2 : 1 },
    ];
    let index = 0;
    for (const { channel, items, count } of plan) {
      for (let order = 0; order < count; order += 1) {
        const day = String(2 + Math.floor(random() * 26)).padStart(2, "0");
        const soldOn = `${month}-${day}`;
        const chosen = items.filter(() => random() > 0.25);
        const lines = (chosen.length ? chosen : items.slice(0, 1)).map((item) => ({ productId: item.productId, quantity: Math.max(1, Math.round(item.base * strength * (0.7 + random() * 0.6))) }));
        const priced = priceSale(demoState, costs, channel, lines);
        const id = `h-${month}-${index += 1}`;
        const delivers = channel.deliveryCostPerOrderMinor > 0;
        const scheduled = new Date(Date.parse(`${soldOn}T12:00:00Z`) + (1 + Math.floor(random() * 3)) * 86_400_000).toISOString().slice(0, 10);
        const late = random() < 0.18;
        sales.push({
          id, soldOn, channelId: channel.id, channelName: channel.name, customer: customerFor(channel, month), note: "", documentId: null, source: "user",
          items: priced.items, totalMinor: priced.totalMinor, sellingCostMinor: priced.sellingCostMinor, deliveryCostMinor: priced.deliveryCostMinor, variableCostMinor: priced.variableCostMinor, productionCostMinor: priced.productionCostMinor,
          delivery: delivers ? { id: `e-${id}`, status: random() < 0.06 ? "cancelled" : "delivered", scheduledOn: scheduled, deliveredOn: late ? new Date(Date.parse(`${scheduled}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : scheduled } : null,
        });
      }
    }
  }
  return sales;
}
