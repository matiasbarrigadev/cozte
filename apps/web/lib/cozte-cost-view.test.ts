import { describe, expect, it } from "vitest";
import { demoState } from "./demo";
import { buildCostOverview, buildProductDetail, evaluateExpression, resolveEntity, simulateScenario, standardUnitRatio } from "./cozte-cost-view";

describe("resolveEntity", () => {
  const items = [{ id: "a", name: "Soja orgánica" }, { id: "b", name: "Tofu 500g" }, { id: "c", name: "Tofu 300g" }];

  it("matches ids, accents and spacing without guessing between similar names", () => {
    expect(resolveEntity(items, "a").item?.id).toBe("a");
    expect(resolveEntity(items, "soja organica").item?.id).toBe("a");
    expect(resolveEntity(items, "tofu 500 g").item?.id).toBe("b");
    const ambiguous = resolveEntity(items, "tofu");
    expect(ambiguous.item).toBeNull();
    expect("candidates" in ambiguous && ambiguous.candidates).toEqual(["Tofu 500g", "Tofu 300g"]);
  });
});

describe("unit conversion and arithmetic", () => {
  it("converts only between standard units of the same kind", () => {
    expect(standardUnitRatio("g", "kg")).toBe(0.001);
    expect(standardUnitRatio("kg", "kg")).toBe(1);
    expect(standardUnitRatio("cm", "m")).toBe(0.01);
    expect(standardUnitRatio("unidad", "kg")).toBeNull();
    expect(standardUnitRatio("bolsa", "caja")).toBeNull();
  });

  it("evaluates plain arithmetic and refuses ambiguous separators", () => {
    expect(evaluateExpression("1600000 / 23")).toBeCloseTo(69565.217391, 5);
    expect(evaluateExpression("(0.35 * 1293) + 2 ^ 3")).toBeCloseTo(460.55, 6);
    expect(evaluateExpression("110000 * 12%")).toBe(13200);
    expect(() => evaluateExpression("1,5 * 2")).toThrow(/punto decimal/);
    expect(() => evaluateExpression("1.600.000 / 2")).toThrow();
    expect(() => evaluateExpression("process.exit()")).toThrow();
  });
});

describe("cost views", () => {
  it("summarizes costs with gaps and ids the agent can act on", () => {
    const overview = buildCostOverview(demoState);
    expect(overview.products[0]).toMatchObject({ id: "dura", goodUnitsPerLot: 100, lotsPerMonth: null });
    expect(overview.products[0].cost?.status).toBe("estimated");
    expect(overview.gaps.some((gap) => gap.includes("Lotes que se producen al mes"))).toBe(true);
    expect(overview.materials.find((item) => item.id === "papel")?.usedBy).toHaveLength(3);
  });

  it("explains drivers and shared-expense shares for one product", () => {
    const detail = buildProductDetail(demoState, "dura")!;
    expect(detail.drivers[0].perLot).toBeGreaterThanOrEqual(detail.drivers.at(-1)!.perLot);
    expect(detail.sharedExpenseShares.map((item) => item.expense)).toEqual(["Electricidad", "Gas", "Espacio"]);
  });

  it("simulates without mutating and reports unresolved references", () => {
    const before = structuredClone(demoState);
    const paper = simulateScenario(demoState, { materialPrices: [{ material: "papel interior", price: 10000 }], recipe: [{ product: "nada", material: "papel", quantityPerLot: 1 }] });
    expect(demoState).toEqual(before);
    expect(paper.saved).toBe(false);
    expect(paper.unresolved).toHaveLength(1);
    expect(paper.products.every((item) => (item.change ?? 0) > 0)).toBe(true);
    // More monthly lots of one product absorb more of the month's hours, relieving the others.
    const volume = simulateScenario(demoState, { products: [{ product: "Libreta", lotsPerMonth: 4 }] });
    expect(volume.products.find((item) => item.product === "Cuaderno A5 · tapa dura")?.change).toBeLessThan(0);
  });
});
