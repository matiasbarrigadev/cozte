import { describe, expect, it } from "vitest";
import { analyzeCosts, groupComponents, periodKey, periodRange } from "./cost-analysis";
import { calculateCosts, type DomainState } from "./domain";
import { costsAsOf, snapshotRowsFor } from "./cost-snapshots";

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

  it("splits the shared line per source, investments included, the same way in every snapshot", () => {
    const withOven: DomainState = { ...structuredClone(base), expenses: [...base.expenses, { id: "contador", name: "Contador", period: "2026-09", area: "admin", amountMinor: 90_000, allocationBasis: "units", category: "Servicios", version: 1 }], investments: [{ id: "horno", name: "Horno", amountMinor: 2_400_000, purchasedOn: "2026-09-01", usefulLifeMonths: 48, area: "production", includeInUnitCost: true, allocationBasis: "hours" }] };
    const context = JSON.parse(snapshotRowsFor(withOven, "2026-09-03 10:00:00")[0].context_json) as { expenses: { id: string }[]; allocationPeers: unknown[] };
    // Only what goes into unit costs, with the peers needed to split it again.
    expect(context.expenses.map((item) => item.id)).toEqual(["mo", "luz", "investment:horno"]);
    expect(context.allocationPeers).toHaveLength(2);
    const point = analyzeCosts(snapshotRowsFor(withOven, "2026-09-03 10:00:00"), { granularity: "month", currency: "ARS" }).products[0].points[0];
    expect(Object.keys(point.components)).toEqual(expect.arrayContaining(["e:mo", "e:luz", "e:investment:horno"]));
    expect(point.components["e:shared"]).toBeUndefined();
  });

  it("splits an older snapshot saved without allocation peers like its neighbours", () => {
    const legacy = snapshots(soyUp, "2026-09-25 10:00:00").map((row) => {
      const { allocationPeers: _peers, ...context } = JSON.parse(row.context_json) as Record<string, unknown>;
      void _peers;
      return { ...row, context_json: JSON.stringify(context) };
    });
    const analysis = analyzeCosts([...rows, ...legacy], { granularity: "week", currency: "ARS" });
    const last = analysis.products[0].points.at(-1)!;
    expect(last.components["e:shared"]).toBeUndefined();
    expect(Object.keys(last.components)).toEqual(expect.arrayContaining(["e:mo", "e:luz"]));
    // No made-up driver between the generic shared line and each expense.
    expect(analysis.products[0].change?.drivers.some((driver) => driver.key === "e:shared")).toBe(false);
  });

  it("explains an empty history instead of drawing nothing", () => {
    expect(analyzeCosts([], { granularity: "month", currency: "ARS" }).insights[0].title).toBe("Todavía no hay historial");
  });
});

describe("the cost a sale of a past day carries", () => {
  it("is each product's latest complete cost on that day, and today's when there was none", () => {
    const today = calculateCosts(soyUp);
    const before = calculateCosts(base);
    const onTheTenth = costsAsOf(today, rows, "2026-09-10", "ARS");
    for (const cost of onTheTenth) {
      const then = before.find((item) => item.productId === cost.productId)!;
      expect(cost.unitMinor).toBe(then.unitMinor);
      expect(cost.perUnit!.materialMinor + cost.perUnit!.laborMinor).toBeCloseTo(then.perUnit!.materialMinor + then.perUnit!.laborMinor, 0);
    }
    expect(costsAsOf(today, rows, "2026-09-25", "ARS").map((cost) => cost.unitMinor)).toEqual(today.map((cost) => cost.unitMinor));
    // Before the first snapshot there is nothing to go back to: today's cost is the estimate.
    expect(costsAsOf(today, rows, "2026-08-01", "ARS").map((cost) => cost.unitMinor)).toEqual(today.map((cost) => cost.unitMinor));
    // An incomplete snapshot is skipped in favour of the last complete one.
    const broken = snapshots({ ...structuredClone(base), materials: base.materials.map((item) => ({ ...item, priceMinor: null })) }, "2026-09-05 10:00:00");
    expect(costsAsOf(today, [...rows, ...broken], "2026-09-10", "ARS").map((cost) => cost.unitMinor)).toEqual(before.map((cost) => cost.unitMinor));
  });
});

describe("costs at a date", () => {
  it("shows each product as it stood at the end of that day, with its detailed lines", async () => {
    const { costsAt } = await import("./cost-analysis");
    const before = costsAt(rows, "2026-09-10", { currency: "ARS" });
    const after = costsAt(rows, "2026-09-20", { currency: "ARS" });
    const soyBefore = before.products.find((product) => product.name === "Tofu 500g")!.lines.find((line) => line.label === "Soja")!;
    const soyAfter = after.products.find((product) => product.name === "Tofu 500g")!.lines.find((line) => line.label === "Soja")!;
    expect(soyBefore).toMatchObject({ type: "insumo", category: "Materia prima", quantityPerLot: 39.2, unit: "kg", unitPrice: 1293 });
    expect(soyAfter.unitPrice).toBe(1800);
    const t500 = after.products.find((product) => product.name === "Tofu 500g")!;
    expect(Math.abs(t500.lines.reduce((sum, line) => sum + line.perLot, 0) - t500.lotCost!)).toBeLessThan(2);
    expect(after.expenses.map((expense) => expense.name)).toEqual(["Mano de obra", "Luz"]);
    expect(costsAt(rows, "2026-08-01", { currency: "ARS" }).products).toEqual([]);
  });
});
