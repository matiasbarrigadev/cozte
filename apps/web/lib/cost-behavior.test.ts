import { describe, expect, it } from "vitest";
import { behaviorGroup, behaviorLabel, productionCostSplit } from "./cost-behavior";
import { calculateCosts, type DomainState, type SharedExpense } from "./domain";

const expense = (id: string, name: string, amountMinor: number, patch: Partial<SharedExpense> = {}): SharedExpense => ({ id, name, period: "2026-09", amountMinor, allocationBasis: "hours", category: "Servicios", version: 1, ...patch });

const state: DomainState = {
  revision: 1, activePeriod: "2026-09", organization: { id: "o", name: "Tofu", currency: "ARS" },
  products: [
    { id: "t300", name: "Tofu 300g", lotUnits: 100, salePriceMinor: 2000, salesVariableMinor: 0, laborLotMinor: 5000, productionHoursMilli: 5000, batchesPerMonthMilli: 20000, version: 1 },
    { id: "t500", name: "Tofu 500g", lotUnits: 100, salePriceMinor: 3000, salesVariableMinor: 0, laborLotMinor: 0, productionHoursMilli: 5000, batchesPerMonthMilli: 10000, version: 1 },
  ],
  materials: [{ id: "soja", name: "Soja", supplier: "", purchaseUnit: "kg", category: "Materia prima", priceMinor: 1000, source: null, effectiveDate: null, version: 1 }],
  components: [{ productId: "t300", materialId: "soja", quantityMilli: 30000 }, { productId: "t500", materialId: "soja", quantityMilli: 50000 }],
  expenses: [
    expense("alquiler", "Alquiler", 200000),
    expense("sueldo", "Sueldo", 800000),
    expense("gas", "Gas", 60000, { behavior: "variable", variableDriver: "lot" }),
    expense("luz", "Luz", 100000, { behavior: "mixed", variableDriver: "hour", variableShareBps: 4000 }),
    expense("moto", "Moto", 50000, { area: "delivery", behavior: "variable", variableDriver: "unit" }),
  ],
};

describe("production costs by how they behave", () => {
  it("adds what grows with production and what does not, for a normal month of the workshop", () => {
    const split = productionCostSplit(state, calculateCosts(state));
    // Soy: 30 kg a lot × 20 lots + 50 kg × 10 lots = 1.100 kg; labor: 5.000 a lot × 20 lots.
    expect(split.materials).toEqual({ soja: 1_100_000 });
    expect(split.labor).toBe(100_000);
    expect(split.expenses.luz).toEqual({ variable: 40_000, fixed: 60_000 });
    expect(split.expenses.moto).toBeUndefined();
    expect(split.variable).toBe(1_100_000 + 100_000 + 60_000 + 40_000);
    expect(split.fixed).toBe(200_000 + 800_000 + 60_000);
  });

  it("names each expense's type with what drives it", () => {
    expect(state.expenses.map((item) => [behaviorGroup(item), behaviorLabel(item)])).toEqual([
      ["fixed", { label: "Fijo", detail: "Igual todos los meses" }],
      ["fixed", { label: "Fijo", detail: "Igual todos los meses" }],
      ["variable", { label: "Variable", detail: "Crece con cada tanda" }],
      ["mixed", { label: "Mixto", detail: "El 40 % crece con cada hora de producción" }],
      ["variable", { label: "Variable", detail: "Crece con cada unidad" }],
    ]);
  });
});
