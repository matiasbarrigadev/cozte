import { calculateCosts, type DomainState } from "./domain";

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
  ],
};

export const demoDashboard = { ...demoState, costs: calculateCosts(demoState), alerts: [] };
