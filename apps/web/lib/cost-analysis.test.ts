import { describe, expect, it } from "vitest";
import { analyzeCosts, groupComponents, periodKey, periodRange } from "./cost-analysis";
import { calculateCosts, type DomainState } from "./domain";
import { snapshotRowsFor } from "./cost-snapshots";

const base: DomainState = {
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
    { id: "mo", name: "Mano de obra", period: "2026-09", amountMinor: 1_600_000, allocationBasis: "hours", category: "Sueldos", version: 1 },
    { id: "luz", name: "Luz", period: "2026-09", amountMinor: 350_000, allocationBasis: "units", category: "Servicios", version: 1 },
  ],
};

const snapshots = snapshotRowsFor;

const soyUp = structuredClone(base);
soyUp.materials[0].priceMinor = 1800;
const rows = [...snapshots(base, "2026-09-02 10:00:00"), ...snapshots(soyUp, "2026-09-20 10:00:00")];

describe("cost analysis", () => {
  it("buckets by Monday weeks and calendar months without gaps", () => {
    expect(periodKey("2026-09-24 02:06:07", "week")).toBe("2026-09-21");
    expect(periodKey("2026-09-24 02:06:07", "month")).toBe("2026-09");
    expect(periodRange("2026-08", "2026-11", "month")).toEqual(["2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(periodRange("2026-08-31", "2026-09-14", "week")).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
  });

  it("rebuilds each product's cost per concept, and the parts add up to the stored unit cost", () => {
    const analysis = analyzeCosts(rows, { granularity: "week", currency: "ARS" });
    expect(analysis.periods).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
    const t300 = analysis.products.find((product) => product.name === "Tofu 300g")!;
    const first = t300.points[0];
    const sum = Object.values(first.components).reduce((total, value) => total + value, 0);
    expect(Math.abs(sum - first.unitCost!)).toBeLessThan(1.5);
    expect(Object.keys(first.components)).toEqual(expect.arrayContaining(["m:soja", "m:etiqueta", "e:mo", "e:luz"]));
    // Weeks without a new snapshot carry the last known cost forward.
    expect(t300.points[1]).toMatchObject({ carried: true, unitCost: first.unitCost });
  });

  it("explains the change with its main driver and flags the price move", () => {
    const analysis = analyzeCosts(rows, { granularity: "month", currency: "ARS" });
    expect(analysis.periods).toEqual(["2026-09"]);
    const weekly = analyzeCosts(rows, { granularity: "week", currency: "ARS" });
    const t500 = weekly.products.find((product) => product.name === "Tofu 500g")!;
    expect(t500.change?.drivers[0]).toMatchObject({ key: "m:soja", label: "Soja" });
    expect(t500.change!.delta).toBeGreaterThan(170);
    expect(weekly.insights.map((insight) => insight.kind)).toEqual(expect.arrayContaining(["increase", "price", "concentration"]));
    expect(weekly.insights.find((insight) => insight.kind === "price")?.title).toBe("Soja subió 39,2 %");
  });

  it("totals the monthly production cost when every product has volume", () => {
    const analysis = analyzeCosts(rows, { granularity: "week", currency: "ARS" });
    const last = analysis.totals.at(-1)!;
    const expected = calculateCosts(soyUp).reduce((sum, cost) => sum + cost.totalLotMinor! * 23, 0);
    expect(Math.round(last.monthlyProductionCost!)).toBe(expected);
  });

  it("groups concepts into types or categories", () => {
    const analysis = analyzeCosts(rows, { granularity: "week", currency: "ARS" });
    const point = analysis.products[0].points[0];
    expect(Object.keys(groupComponents(point, analysis.components, "type")).sort()).toEqual(["Gastos compartidos", "Insumos"]);
    expect(Object.keys(groupComponents(point, analysis.components, "category")).sort()).toEqual(["Empaque", "Materia prima", "Servicios", "Sueldos"]);
  });

  it("explains an empty history instead of drawing nothing", () => {
    expect(analyzeCosts([], { granularity: "month", currency: "ARS" }).insights[0].title).toBe("Todavía no hay historial");
  });
});
