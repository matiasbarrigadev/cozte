import { describe, expect, it } from "vitest";
import { buildBreakEvenPlan, type SalesMixPlan } from "./break-even";
import { calculateCosts, type DomainState, type SharedExpense } from "./domain";

const expense = (id: string, name: string, amountMinor: number, patch: Partial<SharedExpense> = {}): SharedExpense => ({ id, name, period: "2026-09", amountMinor, allocationBasis: "hours", category: "Servicios", version: 1, ...patch });

function tofu(expenses: SharedExpense[]): DomainState {
  return {
    revision: 1, activePeriod: "2026-09", organization: { id: "o", name: "Tofu", currency: "ARS" },
    products: [
      { id: "t300", name: "Tofu 300g", lotUnits: 100, salePriceMinor: 2000, salesVariableMinor: 0, laborLotMinor: 0, productionHoursMilli: 5000, batchesPerMonthMilli: 20000, version: 1 },
      { id: "t500", name: "Tofu 500g", lotUnits: 100, salePriceMinor: 3000, salesVariableMinor: 0, laborLotMinor: 0, productionHoursMilli: 5000, batchesPerMonthMilli: 10000, version: 1 },
    ],
    materials: [{ id: "soja", name: "Soja", supplier: "", purchaseUnit: "kg", category: "Materia prima", priceMinor: 1000, source: null, effectiveDate: null, version: 1 }],
    components: [{ productId: "t300", materialId: "soja", quantityMilli: 30000 }, { productId: "t500", materialId: "soja", quantityMilli: 50000 }],
    expenses,
  };
}

const base = [
  expense("alquiler", "Alquiler", 200000),
  expense("sueldo", "Sueldo", 800000, { category: "Mano de obra" }),
  expense("gas", "Gas de la garrafa", 60000, { behavior: "variable", variableDriver: "lot", behaviorNote: "Solo se usa al cocinar cada tanda" }),
];
const plan = (patch: Partial<SalesMixPlan>): SalesMixPlan => ({ basis: "units", source: "manual", shares: {}, targetProfitMinor: 0, note: "", ...patch });

describe("cost behavior in the engine", () => {
  it("puts the part that grows with production in each unit's variable cost, by its driver", () => {
    const [t300, t500] = calculateCosts(tofu(base));
    // Gas: 60.000 over 30 lots = 2.000 per lot = 20 per unit, whatever each product's hours.
    expect(t300.perUnit).toMatchObject({ materialMinor: 300, variableExpenseMinor: 20 });
    expect(t500.perUnit).toMatchObject({ materialMinor: 500, variableExpenseMinor: 20 });
    expect(t300.economics).toMatchObject({ variableUnitMinor: 320, contributionUnitMinor: 1680 });
    // Fixed: 1.000.000 split by hours (20 lots vs 10) = 666.667 for the 300g, covered at 1.680 per unit.
    expect(t300.economics?.breakEvenUnitsPerMonth).toBe(Math.ceil(666667 / 1680));
    // The full unit cost still carries everything: materials, the gas and its share of the fixed month.
    expect(t300.unitMinor).toBe(300 + 20 + Math.round(666667 / 2000));
  });

  it("splits a mixed expense: its fixed base by the allocation, the rest by the driver", () => {
    const [t300] = calculateCosts(tofu([expense("luz", "Luz", 100000, { behavior: "mixed", variableDriver: "hour", variableShareBps: 4000 })]));
    expect(t300.monthly.variableMinor).toBeCloseTo(40000 * 2 / 3, 0);
    expect(t300.monthly.sharedMinor).toBeCloseTo(100000 * 2 / 3, 0);
  });
});

describe("break-even of a normal month", () => {
  it("adds the fixed costs, sheets each product and says how many of each to sell with the chosen mix", () => {
    const state = tofu(base);
    const result = buildBreakEvenPlan({ state, costs: calculateCosts(state), plan: plan({ shares: { t300: 6000, t500: 4000 }, targetProfitMinor: 200000 }) });
    expect(result.fixed.total).toBe(1000000);
    expect(result.variableItems.map((item) => item.name)).toEqual(["Gas de la garrafa"]);
    expect(result.products.map((product) => [product.name, product.variable.total, product.contributionUnit])).toEqual([["Tofu 300g", 320, 1680], ["Tofu 500g", 520, 2480]]);
    expect(result.weightedContributionUnit).toBe(2000);
    expect(result.products.map((product) => product.unitsNeeded)).toEqual([300, 200]);
    expect(result.breakEven).toEqual({ units: 500, revenue: 1200000 });
    expect(result.target).toEqual({ profit: 200000, units: 600, revenue: 1440000 });
  });

  it("reads the same mix in revenue, and falls back when a source has no data", () => {
    const state = tofu(base);
    const byRevenue = buildBreakEvenPlan({ state, costs: calculateCosts(state), plan: plan({ basis: "revenue", shares: { t300: 5000, t500: 5000 } }) });
    expect(byRevenue.products.map((product) => Math.round(product.unitShare * 100))).toEqual([60, 40]);
    expect(byRevenue.breakEven?.units).toBe(500);
    const auto = buildBreakEvenPlan({ state, costs: calculateCosts(state), plan: plan({ source: "auto" }), lastMonth: { t300: { units: 150, revenue: 300000 }, t500: { units: 50, revenue: 150000 } }, lastMonthLabel: "agosto" });
    expect(auto.mix.used).toBe("last_month");
    expect(auto.products.map((product) => product.unitShare)).toEqual([0.75, 0.25]);
    const noSales = buildBreakEvenPlan({ state, costs: calculateCosts(state), plan: plan({ source: "last_month" }) });
    expect(noSales.mix.used).toBe("plan");
    expect(noSales.warnings[0]).toMatch(/No hay datos para la mezcla/);
  });

  it("shows every assumption, suggests what usually varies and warns when the mix drifts from what sells", () => {
    const state = tofu([...base.slice(0, 2), expense("envases", "Envases", 30000)]);
    const result = buildBreakEvenPlan({ state, costs: calculateCosts(state), plan: plan({ shares: { t300: 5000, t500: 5000 } }), lastMonth: { t300: { units: 300, revenue: 600000 }, t500: { units: 60, revenue: 180000 } }, lastMonthLabel: "agosto" });
    expect(result.assumptions.find((item) => item.id === "behavior:envases")).toMatchObject({ text: "Envases: fijo", reviewed: false });
    expect(result.assumptions.find((item) => item.id === "mix")?.text).toBe("Mezcla de ventas por unidades: elegida por vos");
    expect(result.suggestions.map((item) => item.name)).toEqual(["Envases"]);
    expect(result.alerts[0]).toBe("La mezcla elegida pone Tofu 300g en 50 %, pero en agosto fue el 83 % de lo vendido.");
  });

  it("leaves out products without price and says when the mix cannot cover its own costs", () => {
    const state = tofu(base);
    state.products[1] = { ...state.products[1], salePriceMinor: 0 };
    const result = buildBreakEvenPlan({ state, costs: calculateCosts(state), plan: plan({ source: "equal" }) });
    expect(result.products[1].missing).toBe("Le falta el precio de venta");
    expect(result.products[0].unitShare).toBe(1);
    expect(result.breakEven?.units).toBe(Math.ceil(1000000 / 1680));
    state.products[0] = { ...state.products[0], salePriceMinor: 300 };
    expect(buildBreakEvenPlan({ state, costs: calculateCosts(state), plan: plan({ source: "equal" }) }).warnings.at(-1)).toMatch(/no alcanza ni para sus propios costos variables/);
  });
});
