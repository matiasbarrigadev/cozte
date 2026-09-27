import { describe, expect, it } from "vitest";
import { buildBusinessView } from "./business";
import { analysisInsights, change, monthsBack, summarizeMonth } from "./business-analytics";
import { DEMO_MONTH, DEMO_TODAY, demoBusinessRecords, demoHistorySales, demoState } from "./demo";

const money = (value: number) => `$${Math.round(value)}`;
const records = demoBusinessRecords();
const withHistory = { ...records, sales: [...demoHistorySales(), ...records.sales] };
const summary = (month: string) => summarizeMonth(buildBusinessView(demoState, withHistory, month), month, DEMO_TODAY);

describe("business analytics", () => {
  it("lists the months that end with a given one, across a year change", () => {
    expect(monthsBack("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(change(120, 100)).toBeCloseTo(0.2);
    expect(change(5, 0)).toBeNull();
  });

  it("summarizes a month with the same numbers as the result of the month", () => {
    const view = buildBusinessView(demoState, withHistory, DEMO_MONTH);
    const month = summary(DEMO_MONTH);
    expect(month.revenue).toBeCloseTo(view.result.revenue, 2);
    expect(month.result).toBeCloseTo(view.result.result, 2);
    // Everything that came in ends up somewhere: what each sale cost, the fixed costs and what was left.
    expect(month.production + month.selling + month.delivery + month.fixed + month.result).toBeCloseTo(month.revenue, 1);
    expect(month.byChannel.reduce((sum, item) => sum + item.revenue, 0)).toBeCloseTo(month.revenue, 1);
    expect(month.byWeekday.reduce((sum, value) => sum + value, 0)).toBeCloseTo(month.revenue, 1);
    expect(month.byProduct[0].revenue).toBeGreaterThanOrEqual(month.byProduct.at(-1)!.revenue);
    expect(month.sales).toBe(6);
  });

  it("counts deliveries by how they went, late ones included", () => {
    const month = summary(DEMO_MONTH);
    // Demo September: two delivered on the day, one failed, one on the way today and one pending.
    expect(month.deliveries).toMatchObject({ total: 5, delivered: 2, onTime: 2, failed: 1, open: 2 });
    const july = summary("2026-07");
    expect(july.deliveries.delivered + july.deliveries.cancelled + july.deliveries.open + july.deliveries.failed).toBe(july.deliveries.total);
  });

  it("explains what stands out in the month in plain words", () => {
    const months = monthsBack(DEMO_MONTH, 3).map(summary);
    const insights = analysisInsights(months, 2, money);
    expect(insights[0].text).toMatch(/pérdida|ganancia/);
    expect(insights.some((item) => /Las ventas (subieron|bajaron)/.test(item.text))).toBe(true);
    expect(insights.some((item) => /gastos fijos se llevaron/.test(item.text))).toBe(true);
    const empty = { ...summary("2025-01"), revenue: 0, fixed: 0 };
    expect(analysisInsights([empty], 0, money)).toEqual([{ tone: "info", text: "Todavía no hay ventas ni gastos registrados en este mes." }]);
  });
});
