import { calculateCosts, type DomainState } from "./domain";
import { snapshotRowsFor } from "./cost-snapshots";
import { priceSale, type BusinessRecords, type Purchase, type Sale, type SalesChannel } from "./business";

export const demoState: DomainState = {
  revision: 3,
  activePeriod: "2026-09",
  organization: { id: "demo", name: "Taller Norte", currency: "CLP" },
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
      sale("v1", "2026-09-22", librerias, [{ productId: "bolsillo", quantity: 80 }]),
      sale("v2", "2026-09-19", tienda, [{ productId: "bolsillo", quantity: 4 }, { productId: "blanda", quantity: 2 }]),
      sale("v3", "2026-09-18", tienda, [{ productId: "dura", quantity: 3 }]),
      sale("v4", "2026-09-12", feria, [{ productId: "dura", quantity: 25 }, { productId: "blanda", quantity: 30 }, { productId: "bolsillo", quantity: 40 }]),
      sale("v5", "2026-09-04", librerias, [{ productId: "dura", quantity: 60 }, { productId: "blanda", quantity: 60 }]),
    ],
  };
}
