import { describe, expect, it } from "vitest";
import { calculateCosts, type DomainState } from "./domain";
import { DIRECT_CHANNEL, channelEconomics, companyStructure, investmentShare, monthLessons, monthResult, priceSale, type Purchase, type Sale, type SalesChannel } from "./business";

const state: DomainState = {
  revision: 1, activePeriod: "2026-09", organization: { id: "o", name: "Tofu", currency: "ARS" },
  products: [
    { id: "t300", name: "Tofu 300g", lotUnits: 100, salePriceMinor: 2000, salesVariableMinor: 0, laborLotMinor: 10_000, productionHoursMilli: 5000, batchesPerMonthMilli: 20_000, version: 1 },
  ],
  materials: [{ id: "soja", name: "Soja", supplier: "", purchaseUnit: "kg", category: "Materia prima", priceMinor: 1000, source: "x", effectiveDate: "2026-09-01", version: 1 }],
  components: [{ productId: "t300", materialId: "soja", quantityMilli: 30_000 }],
  expenses: [
    { id: "luz", name: "Luz", period: "2026-09", amountMinor: 200_000, allocationBasis: "hours", category: "Servicios", version: 1 },
    { id: "contador", name: "Contador", period: "2026-09", area: "admin", amountMinor: 100_000, allocationBasis: "units", category: "Servicios", version: 1 },
    { id: "moto", name: "Seguro de la moto", period: "2026-09", area: "delivery", amountMinor: 50_000, allocationBasis: "units", category: "Seguros", version: 1 },
  ],
};
const costs = calculateCosts(state);
// Per unit: soy 300 + labor 100 + electricity 200 000 / (20 lots × 100 units) = 100 → 500.
const online: SalesChannel = { id: "ig", name: "Instagram", deliveryMethod: "Moto propia", commissionBps: 1000, feePerOrderMinor: 0, deliveryCostPerOrderMinor: 400, unitsPerOrderMilli: 4000, priceAdjustmentBps: 0 };
const wholesale: SalesChannel = { id: "may", name: "Mayorista", deliveryMethod: "Retiro", commissionBps: 0, feePerOrderMinor: 0, deliveryCostPerOrderMinor: 0, unitsPerOrderMilli: 50_000, priceAdjustmentBps: -2500 };

describe("business engine", () => {
  it("keeps the company's other expenses out of each unit's cost", () => {
    expect(costs[0].unitMinor).toBe(500);
    expect(costs[0].monthly.sharedByExpense).toEqual({ luz: 200_000 });
  });

  it("shows what each unit leaves in every channel after making, selling and delivering it", () => {
    const [ig, may] = channelEconomics(state, costs, [online, wholesale]);
    // 2000 − 500 made − 200 commission − 100 delivery (400 per order of 4).
    expect(ig).toMatchObject({ price: 2000, productionCost: 500, sellingCost: 200, deliveryCost: 100, left: 1200, leftPercent: 60, contribution: 1300 });
    expect(may).toMatchObject({ price: 1500, left: 1000, contribution: 1100 });
    expect(channelEconomics(state, costs, [])[0].channelName).toBe(DIRECT_CHANNEL.name);
  });

  it("fixes a sale's price and costs with the channel rules", () => {
    const sale = priceSale(state, costs, online, [{ productId: "t300", quantity: 4 }]);
    expect(sale).toMatchObject({ totalMinor: 8000, sellingCostMinor: 800, deliveryCostMinor: 400, variableCostMinor: 1600, productionCostMinor: 2000, problems: [] });
    expect(priceSale(state, costs, online, [{ productId: "t300", quantity: 2, unitPrice: 1800 }], 0)).toMatchObject({ totalMinor: 3600, deliveryCostMinor: 0 });
    expect(priceSale({ products: [{ ...state.products[0], salePriceMinor: 0 }] }, costs, online, [{ productId: "t300", quantity: 1 }]).problems).toEqual(["Falta el precio de venta de Tofu 300g"]);
  });

  it("spreads an investment over its useful life", () => {
    const laptop = { kind: "investment" as const, amountMinor: 720_000, purchasedOn: "2026-09-10", usefulLifeMonths: 36 };
    expect(investmentShare(laptop, "2026-08")).toBe(0);
    expect(investmentShare(laptop, "2026-09")).toBe(20_000);
    expect(investmentShare(laptop, "2029-08")).toBe(20_000);
    expect(investmentShare(laptop, "2029-09")).toBe(0);
  });

  it("builds the month: what sales left, fixed costs by area, one-off purchases and investments", () => {
    const purchases: Purchase[] = [
      { id: "p1", purchasedOn: "2026-09-03", description: "Cinta de embalaje", supplier: "", amountMinor: 5_000, kind: "expense", area: "delivery", source: "cozte" },
      { id: "p2", purchasedOn: "2026-09-04", description: "Soja 100 kg", supplier: "", amountMinor: 100_000, kind: "material", area: "production", source: "cozte" },
      { id: "p3", purchasedOn: "2026-09-05", description: "Luz de agosto", supplier: "", amountMinor: 230_000, kind: "fixed_payment", area: "production", expenseId: "luz", expenseName: "Luz", source: "user" },
      { id: "p4", purchasedOn: "2026-09-10", description: "Notebook", supplier: "", amountMinor: 720_000, kind: "investment", area: "admin", usefulLifeMonths: 36, source: "user" },
    ];
    const investments = purchases.filter((item) => item.kind === "investment");
    const priced = priceSale(state, costs, online, [{ productId: "t300", quantity: 400 }]);
    const sale: Sale = { id: "s1", soldOn: "2026-09-20", channelId: "ig", channelName: "Instagram", customer: "", note: "", ...priced, source: "cozte" };
    const result = monthResult({ state, costs, channels: [online], month: "2026-09", sales: [sale], purchases, investments });
    expect(result).toMatchObject({
      sales: 1, revenue: 800_000, variableProductionCost: 160_000, sellingCost: 80_000, deliveryCost: 400, contribution: 559_600,
      fixedByArea: { production: 200_000, delivery: 50_000, sales: 0, admin: 100_000 }, fixedTotal: 350_000,
      oneOffByArea: { delivery: 5_000 }, oneOffTotal: 5_000, investmentsShare: 20_000, purchasedMaterials: 100_000,
      result: 559_600 - 350_000 - 5_000 - 20_000,
    });
    expect(result.fixedPayments).toEqual([{ expenseName: "Luz", paid: 230_000, estimated: 200_000 }]);
    // Break-even: (350 000 + 20 000) ÷ (559 600 ÷ 800 000).
    expect(result.breakEvenRevenue).toBe(Math.round(370_000 / 0.6995));
    const lessons = monthLessons(result, (value) => `$${Math.round(value)}`);
    expect(lessons.map((item) => item.id)).toEqual(["contribution", "break-even", "materials", "investments", "estimate"]);
    expect(lessons[0].text).toMatch(/De cada \$100 que vendiste, te quedaron \$70/);
    expect(lessons[1].text).toMatch(/lo superaste/);
  });

  it("estimates the break-even from the planned mix when the month has no sales yet", () => {
    const result = monthResult({ state, costs, channels: [online], month: "2026-10", sales: [], purchases: [], investments: [] });
    // Contribution in Instagram is 1300 of 2000 = 65 %.
    expect(result.contributionRatio).toBe(0.65);
    expect(result.breakEvenRevenue).toBe(Math.round(350_000 / 0.65));
    expect(result.result).toBe(-350_000);
  });

  it("groups the structure by area with the investments still being spread", () => {
    const structure = companyStructure(state, [{ id: "p4", purchasedOn: "2026-09-10", description: "Notebook", supplier: "", amountMinor: 720_000, kind: "investment", area: "admin", usefulLifeMonths: 36, source: "user" }], "2026-09");
    const admin = structure.areas.find((item) => item.area === "admin")!;
    expect(admin).toMatchObject({ monthlyTotal: 120_000, investments: [{ description: "Notebook", monthlyShare: 20_000, monthsLeft: 36 }] });
    expect(structure.monthlyFixedTotal).toBe(370_000);
  });

  it("adds a workshop investment to each unit's cost only when the person chose it", () => {
    const scale = { id: "balanza", name: "Balanza", amountMinor: 60_000, purchasedOn: "2026-09-10", usefulLifeMonths: 60, area: "production" as const, includeInUnitCost: false, allocationBasis: "hours" as const };
    expect(calculateCosts({ ...state, investments: [scale] })[0].unitMinor).toBe(500);
    // 60 000 over 60 months = 1 000 a month, over 2 000 units = 0.5 per unit.
    const included = calculateCosts({ ...state, investments: [{ ...scale, includeInUnitCost: true }] })[0];
    expect(included.monthly.sharedByExpense).toEqual({ luz: 200_000, "investment:balanza": 1_000 });
    expect(included.unitMinor).toBe(501);
    // An office investment never enters the unit cost, and neither does one past its useful life.
    expect(calculateCosts({ ...state, investments: [{ ...scale, area: "admin", includeInUnitCost: true }] })[0].unitMinor).toBe(500);
    expect(calculateCosts({ ...state, activePeriod: "2031-09", expenses: state.expenses.map((item) => ({ ...item, period: "2031-09" })), investments: [{ ...scale, includeInUnitCost: true }] })[0].unitMinor).toBe(500);
  });
});
