import { describe, expect, it } from "vitest";
import { calculateCosts, type DomainState } from "./domain";
import { dashboardSummary } from "./dashboard-summary";

const state: DomainState = {
  revision: 1, activePeriod: "2026-09", organization: { id: "o", name: "Tofu", currency: "ARS" },
  products: [
    { id: "t500", name: "Tofu 500g", lotUnits: 112, salePriceMinor: 0, salesVariableMinor: 0, laborLotMinor: 0, productionHoursMilli: 6000, batchesPerMonthMilli: 23000, version: 1 },
    { id: "t300", name: "Tofu 300g", lotUnits: 93, salePriceMinor: 0, salesVariableMinor: 0, laborLotMinor: 0, productionHoursMilli: 6000, batchesPerMonthMilli: 23000, version: 1 },
  ],
  materials: [
    { id: "soja", name: "Soja", supplier: "", purchaseUnit: "kg", category: "Materia prima", priceMinor: 1293, source: "x", effectiveDate: "2026-09-01", version: 1 },
    { id: "etiqueta", name: "Etiqueta", supplier: "", purchaseUnit: "unidad", category: "Empaque", priceMinor: 240, source: "x", effectiveDate: "2026-09-01", version: 1 },
  ],
  components: [
    { productId: "t500", materialId: "soja", quantityMilli: 39200 }, { productId: "t500", materialId: "etiqueta", quantityMilli: 112000 },
    { productId: "t300", materialId: "soja", quantityMilli: 19502 }, { productId: "t300", materialId: "etiqueta", quantityMilli: 93000 },
  ],
  expenses: [
    { id: "mo", name: "Sueldos", period: "2026-09", amountMinor: 1_600_000, allocationBasis: "hours", category: "Sueldos", version: 1 },
    { id: "luz", name: "Luz", period: "2026-09", amountMinor: 350_000, allocationBasis: "units", category: "Servicios", version: 1 },
  ],
};

const money = (value: number) => `$${Math.round(value)}`;

describe("dashboard summary", () => {
  it("totals the month, splits each unit and says what is missing", () => {
    const costs = calculateCosts(state);
    const summary = dashboardSummary(state, costs, money);
    expect(summary).toMatchObject({ products: 2, calculated: 2, estimated: 0 });
    expect(summary.monthlyProductionCost).toBe(costs.reduce((sum, cost) => sum + cost.totalLotMinor! * 23, 0));
    const t300 = summary.composition.find((item) => item.name === "Tofu 300g")!;
    expect(Math.abs(t300.materials + t300.labor + t300.shared - t300.unitCost)).toBeLessThanOrEqual(2);
    expect(summary.gaps).toEqual([]);
  });

  it("teaches with the company's numbers: the biggest cost, fixed costs and volume, and pricing", () => {
    const summary = dashboardSummary(state, calculateCosts(state), money);
    expect(summary.lessons.map((lesson) => lesson.id)).toEqual(["driver", "volume", "price"]);
    // Tofu 500g is made in the largest quantity; its soy (39.2 kg × 1293 / 112 ≈ 453) outweighs its salaries (≈ 310).
    expect(summary.lessons[0].text).toMatch(/^En Tofu 500g, Soja es el 42 % de lo que cuesta cada unidad \(\$453 de \$1077\)/);
    const before = calculateCosts(state).find((cost) => cost.productId === "t500")!.unitMinor!;
    const after = Number(/costaría \$(\d+)/.exec(summary.lessons[1].text)![1]);
    expect(after).toBeLessThan(before);
  });

  it("explains contribution and break-even once a price exists, and warns when each sale loses money", () => {
    const priced = structuredClone(state);
    priced.products[0].salePriceMinor = 2500;
    const summary = dashboardSummary(priced, calculateCosts(priced), money);
    const lesson = summary.lessons.find((item) => item.id === "contribution")!;
    expect(lesson.text).toMatch(/deja \$\d+ después de pagar/);
    expect(lesson.text).toMatch(/Con \d+ unidades al mes cubre/);
    priced.products[0].salePriceMinor = 500;
    expect(dashboardSummary(priced, calculateCosts(priced), money).lessons.find((item) => item.id === "contribution")!.text).toMatch(/agranda la pérdida/);
  });

  it("does not total the month while a product lacks its volume, and lists that gap", () => {
    const partial = structuredClone(state);
    delete partial.products[1].batchesPerMonthMilli;
    const summary = dashboardSummary(partial, calculateCosts(partial), money);
    expect(summary.monthlyProductionCost).toBeNull();
    expect(summary.gaps).toContain("Lotes que se producen al mes de Tofu 300g");
    expect(summary.lessons.some((lesson) => lesson.id === "volume")).toBe(false);
  });
});
