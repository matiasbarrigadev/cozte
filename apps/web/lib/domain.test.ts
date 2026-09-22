import { describe, expect, it } from "vitest";
import { allocateMinor, calculateCosts, type DomainState } from "./domain";

const state: DomainState = {
  revision: 1,
  activePeriod: "2026-09",
  organization: { id: "demo", name: "Taller Norte", currency: "CLP" },
  products: [
    { id: "dura", name: "Tapa dura", lotUnits: 100, salePriceMinor: 5500, salesVariableMinor: 490, laborLotMinor: 60000, productionHoursMilli: 20000, version: 1 },
    { id: "blanda", name: "Tapa blanda", lotUnits: 100, salePriceMinor: 4300, salesVariableMinor: 360, laborLotMinor: 60000, productionHoursMilli: 15000, version: 1 },
    { id: "bolsillo", name: "Libreta bolsillo", lotUnits: 100, salePriceMinor: 3200, salesVariableMinor: 280, laborLotMinor: 64000, productionHoursMilli: 12000, version: 1 },
  ],
  materials: [
    { id: "papel", name: "Papel interior", supplier: "Papelería Sur", purchaseUnit: "resma", category: "Papel", priceMinor: 9000, source: "Factura 1842", effectiveDate: "2026-09-18", version: 1 },
    { id: "d", name: "Tapas rígidas", supplier: "", purchaseUnit: "juego", category: "Tapas", priceMinor: 750, source: "Compra", effectiveDate: "2026-09-18", version: 1 },
    { id: "b", name: "Tapas blandas", supplier: "", purchaseUnit: "juego", category: "Tapas", priceMinor: 520, source: "Compra", effectiveDate: "2026-09-18", version: 1 },
    { id: "p", name: "Tapas bolsillo", supplier: "", purchaseUnit: "juego", category: "Tapas", priceMinor: 380, source: "Compra", effectiveDate: "2026-09-18", version: 1 },
    { id: "anillado", name: "Anillado", supplier: "", purchaseUnit: "unidad", category: "Terminaciones", priceMinor: 360, source: "Compra", effectiveDate: "2026-09-18", version: 1 },
    { id: "enc", name: "Encuadernación", supplier: "", purchaseUnit: "unidad", category: "Terminaciones", priceMinor: 240, source: "Compra", effectiveDate: "2026-09-18", version: 1 },
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

describe("motor de costos", () => {
  it("reparte exactamente un gasto común", () => {
    expect(allocateMinor(94000, [
      { id: "dura", weight: 20 },
      { id: "blanda", weight: 15 },
      { id: "bolsillo", weight: 12 },
    ])).toEqual({ dura: 40000, blanda: 30000, bolsillo: 24000 });
  });

  it("reparte un costo por porcentajes acordados y conserva el total", () => {
    const manual = structuredClone(state);
    manual.expenses = [{ id: "energia", name: "Energía", period: "2026-09", amountMinor: 10001, allocationBasis: "manual", allocationShares: { dura: 5000, blanda: 3000, bolsillo: 2000 }, category: "Servicios", version: 1 }];
    const lines = calculateCosts(manual).map((item) => item.lines.find((line) => line.kind === "shared_expense")!.amountMinor);
    expect(lines.reduce((sum, amount) => sum + amount, 0)).toBe(10001);
    expect(lines).toEqual([5001, 3000, 2000]);
    manual.expenses[0].allocationShares = { dura: 5000, blanda: 3000 };
    expect(calculateCosts(manual).every((item) => item.unitMinor === null)).toBe(true);
  });

  it("actualiza los tres productos cuando cambia el papel", () => {
    const current = calculateCosts(state);
    const next = calculateCosts(state, { papel: 10000 });
    expect(current.map((item) => item.unitMinor)).toEqual([3010, 2440, 1860]);
    expect(next.map((item) => item.unitMinor)).toEqual([3110, 2520, 1900]);
  });

  it("no presenta un total preciso si falta un precio", () => {
    const missing = structuredClone(state);
    missing.materials[0].priceMinor = null;
    expect(calculateCosts(missing)[0].unitMinor).toBeNull();
  });

  it("un cambio en gasto compartido conserva el total asignado", () => {
    const current = calculateCosts(state);
    const next = calculateCosts(state, {}, { gas: 30000 });
    const difference = next.reduce((sum, item, index) =>
      sum + (item.totalLotMinor! - current[index].totalLotMinor!), 0);
    expect(difference).toBe(6000);
  });

  it("no inventa asignaciones si faltan horas", () => {
    const missing = structuredClone(state);
    for (const product of missing.products) product.productionHoursMilli = 0;
    expect(calculateCosts(missing).every((item) => item.unitMinor === null)).toBe(true);
  });

  it("no suma gastos de dos meses distintos", () => {
    const withOldPeriod = structuredClone(state);
    withOldPeriod.expenses.push({ id: "old", name: "Gas", period: "2026-08", amountMinor: 999999, allocationBasis: "hours", category: "Servicios", version: 1 });
    expect(calculateCosts(withOldPeriod).map((item) => item.unitMinor)).toEqual([3010, 2440, 1860]);
  });

  it("al iniciar otro período no arrastra gastos del anterior", () => {
    const nextMonth = structuredClone(state);
    nextMonth.activePeriod = "2026-10";
    nextMonth.expenses.push({ id: "oct-electricidad", name: "Electricidad", period: "2026-10", amountMinor: 47000, allocationBasis: "hours", category: "Servicios", version: 1 });
    const totalShared = calculateCosts(nextMonth).reduce((sum, item) => sum + (item.lines.find((line) => line.kind === "shared_expense")?.amountMinor ?? 0), 0);
    expect(totalShared).toBe(47000);
  });
});
