import { describe, expect, it } from "vitest";
import { calculateCosts, investmentMonthlyShare, type DomainState } from "./domain";
import { monthResult, priceSale, type SalesChannel } from "./business";
import { convertNativeMilli, makeQuote } from "./currency";
import { formatMoney, moneyDecimals, roundMoney } from "./money";

const shop = (currency: "USD" | "CLP"): DomainState => ({
  revision: 1, activePeriod: "2026-09", organization: { id: "o", name: "Taller", currency },
  products: [{ id: "jabon", name: "Jabón", lotUnits: 40, salePriceMinor: currency === "USD" ? 4.99 : 4990, salesVariableMinor: currency === "USD" ? 0.15 : 150, laborLotMinor: currency === "USD" ? 12.5 : 12_500, productionHoursMilli: 2000, batchesPerMonthMilli: 30_000, version: 1 }],
  materials: [
    { id: "etiqueta", name: "Etiqueta", supplier: "", purchaseUnit: "unidad", category: "Empaque", priceMinor: currency === "USD" ? 0.045 : 12.5, source: "Factura", effectiveDate: "2026-09-01", version: 1 },
    { id: "base", name: "Base glicerina", supplier: "", purchaseUnit: "kg", category: "Materia prima", priceMinor: currency === "USD" ? 6.8 : 6_800, source: "Factura", effectiveDate: "2026-09-01", version: 1 },
  ],
  components: [{ productId: "jabon", materialId: "etiqueta", quantityMilli: 40_000 }, { productId: "jabon", materialId: "base", quantityMilli: 4_000 }],
  expenses: [{ id: "luz", name: "Luz", period: "2026-09", amountMinor: currency === "USD" ? 90.1 : 90_100, allocationBasis: "hours", category: "Servicios", version: 1 }],
});

describe("money precision by currency", () => {
  it("knows which currencies are booked with cents", () => {
    expect(moneyDecimals("USD")).toBe(2);
    expect(moneyDecimals("PEN")).toBe(2);
    expect(moneyDecimals("CLP")).toBe(0);
    expect(moneyDecimals("ARS")).toBe(0);
    expect(roundMoney(2.345, "USD")).toBe(2.35);
    expect(roundMoney(1234.5, "CLP")).toBe(1235);
    expect(formatMoney(149.9, "USD")).toContain("149,90");
    expect(formatMoney(150, "USD")).not.toContain(",");
    expect(formatMoney(4990, "CLP")).toBe("$4.990");
  });

  it("costs a USD product in cents instead of whole dollars", () => {
    const [soap] = calculateCosts(shop("USD"));
    // Labels 40 × 0.045 = 1.80; base 4 kg × 6.80 = 27.20; labor 12.50; light 90.10 over 30 lots = 3.00 (rounded to cents).
    expect(soap.lines.map((line) => line.amountMinor)).toEqual([1.8, 27.2, 12.5, 3]);
    expect(soap.totalLotMinor).toBe(44.5);
    // 44.50 ÷ 40 soaps = 1.1125 → 1.11 each: a whole-dollar engine would have said 1.
    expect(soap.unitMinor).toBe(1.11);
    expect(soap.perUnit).toEqual({ materialMinor: 0.73, laborMinor: 0.31, sharedMinor: 0.08, variableExpenseMinor: 0 });
    expect(soap.estimatedMarginPercent).toBe(74.7);
    expect(soap.economics?.contributionUnitMinor).toBe(3.8);
  });

  it("keeps a peso price's fraction until the lot multiplies it", () => {
    const [soap] = calculateCosts(shop("CLP"));
    // 40 labels at CLP 12.5 = 500, not 40 × 13 = 520.
    expect(soap.lines[0].amountMinor).toBe(500);
    expect(Number.isInteger(soap.unitMinor!)).toBe(true);
  });

  it("prices USD sales and the month's result with cents", () => {
    const state = shop("USD");
    const costs = calculateCosts(state);
    const store: SalesChannel = { id: "web", name: "Tienda", deliveryMethod: "Correo", commissionBps: 350, feePerOrderMinor: 0.3, deliveryCostPerOrderMinor: 4.25, unitsPerOrderMilli: 1000, priceAdjustmentBps: 0 };
    const sale = priceSale(state, costs, store, [{ productId: "jabon", quantity: 3 }]);
    // 3 × 4.99 = 14.97; commission 3.5 % = 0.52395 + 0.30 fee + 3 × 0.15 = 1.27.
    expect(sale).toMatchObject({ totalMinor: 14.97, sellingCostMinor: 1.27, deliveryCostMinor: 4.25, variableCostMinor: 3.12 });
    const result = monthResult({ state, costs, channels: [store], month: "2026-09", sales: [{ id: "s", soldOn: "2026-09-10", channelId: "web", channelName: "Tienda", customer: "", note: "", source: "user", ...sale, paidMinor: sale.totalMinor, paymentMethod: null, paidOn: "2026-09-10" }], purchases: [], investments: [] });
    expect(result.contribution).toBe(6.33);
    expect(result.result).toBe(-83.77);
  });

  it("converts and spreads with the target currency's precision", () => {
    const quote = makeQuote("EUR", "USD", { EUR: 0.92, USD: 1 }, "2026-09-01T00:00:00Z", "FXRatesAPI")!;
    expect(convertNativeMilli(10_000, quote)).toBe(10.87);
    const tool = { amountMinor: 100, purchasedOn: "2026-09-01", usefulLifeMonths: 3 };
    const shares = ["2026-09", "2026-10", "2026-11"].map((month) => investmentMonthlyShare(tool, month, "USD"));
    expect(shares).toEqual([33.33, 33.34, 33.33]);
  });
});
