import { describe, expect, it } from "vitest";
import { calculateCosts, expensesInForce, investmentMonthlyShare, periodInForce, type DomainState } from "./domain";
import { DIRECT_CHANNEL, buildBusinessView, buildCustomerDirectory, canFillSaleCosts, describeHistoryEvent, byProximity, byRecency, channelEconomics, companyStructure, deliverySummary, initialDeliveryStatus, investmentShare, monthLessons, monthResult, monthsLeft, needsDelivery, priceSale, repriceSale, saleVariableCost, type Delivery, type Purchase, type Sale, type SalesChannel, initialPayment, nextPayment, receivableOf, salePayment } from "./business";
import { emptyTally, tallyDelivery } from "./delivery-zones";

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
    const sale: Sale = { id: "s1", soldOn: "2026-09-20", channelId: "ig", channelName: "Instagram", customer: "", note: "", ...priced, source: "cozte", paidMinor: priced.totalMinor, paymentMethod: null, paidOn: "2026-09-20" };
    const result = monthResult({ state, costs, channels: [online], month: "2026-09", sales: [sale], purchases, investments });
    expect(result).toMatchObject({
      sales: 1, revenue: 800_000, variableProductionCost: 160_000, sellingCost: 80_000, deliveryCost: 400, contribution: 559_600,
      fixedByArea: { production: 200_000, delivery: 50_000, sales: 0, admin: 100_000 }, fixedTotal: 350_000,
      oneOffByArea: { delivery: 5_000 }, oneOffTotal: 5_000, investmentsShare: 20_000, purchasedMaterials: 100_000,
      result: 559_600 - 350_000 - 5_000 - 20_000,
    });
    expect(result.fixedPayments).toEqual([{ expenseName: "Luz", paid: 230_000, estimated: 200_000 }]);
    // Break-even: (350 000 fixed + 20 000 investments + 5 000 one-off) ÷ (559 600 ÷ 800 000); selling it means not losing.
    expect(result.breakEvenRevenue).toBe(Math.round(375_000 / 0.6995));
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

describe("accounting integrity", () => {
  const sale = (patch: Partial<Sale> = {}): Sale => {
    const priced = priceSale(state, costs, online, [{ productId: "t300", quantity: 4 }]);
    return { id: "s1", soldOn: "2026-09-20", channelId: "ig", channelName: "Instagram", customer: "", note: "", source: "user", paidMinor: priced.totalMinor, paymentMethod: null, paidOn: "2026-09-20", ...priced, ...patch };
  };

  it("spreads an investment so its monthly shares add up to exactly its price", () => {
    const tool = { amountMinor: 1_000, purchasedOn: "2026-09-15", usefulLifeMonths: 3 };
    const shares = ["2026-09", "2026-10", "2026-11"].map((month) => investmentMonthlyShare(tool, month));
    expect(shares.reduce((sum, value) => sum + value, 0)).toBe(1_000);
    expect(shares.every((value) => Number.isInteger(value))).toBe(true);
    // The month result and the unit cost use the same share.
    expect(["2026-09", "2026-10", "2026-11"].map((month) => investmentShare({ ...tool, kind: "investment" }, month))).toEqual(shares);
    const machine = { amountMinor: 1_234_567, purchasedOn: "2026-01-31", usefulLifeMonths: 37 };
    let total = 0;
    for (let index = 0; index < 40; index++) total += investmentMonthlyShare(machine, `${2026 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`);
    expect(total).toBe(1_234_567);
  });

  it("uses the monthly expenses in force each month, not only the latest period's", () => {
    const history: DomainState = { ...state, activePeriod: "2026-10", expenses: [
      ...state.expenses.map((item) => ({ ...item, period: "2026-08" })),
      { id: "luz-oct", name: "Luz", period: "2026-10", amountMinor: 260_000, allocationBasis: "hours" as const, category: "Servicios", version: 1 },
    ] };
    expect(periodInForce(history, "2026-09")).toBe("2026-08");
    expect(periodInForce(history, "2026-12")).toBe("2026-10");
    expect(periodInForce(history, "2026-07")).toBeNull();
    const september = monthResult({ state: history, costs, channels: [online], month: "2026-09", sales: [], purchases: [], investments: [] });
    expect(september.fixedTotal).toBe(350_000);
    expect(september.fixedByArea).toMatchObject({ production: 200_000, admin: 100_000, delivery: 50_000 });
    const october = monthResult({ state: history, costs, channels: [online], month: "2026-10", sales: [], purchases: [], investments: [] });
    expect(october.fixedTotal).toBe(260_000);
    // Before the first period: no fixed costs for an empty month, the first period's for a month with records.
    expect(monthResult({ state: history, costs, channels: [online], month: "2026-07", sales: [], purchases: [], investments: [] }).fixedTotal).toBe(0);
    expect(monthResult({ state: history, costs, channels: [online], month: "2026-07", sales: [sale({ soldOn: "2026-07-10" })], purchases: [], investments: [] }).fixedTotal).toBe(350_000);
    expect(expensesInForce(history, "2026-07", false)).toEqual({ period: null, expenses: [] });
    // A fixed payment of an expense from an earlier period still shows its estimate.
    const payment: Purchase = { id: "p", purchasedOn: "2026-10-05", description: "Luz de agosto", supplier: "", amountMinor: 210_000, kind: "fixed_payment", area: "production", expenseId: "luz", expenseName: "Luz", source: "user" };
    expect(monthResult({ state: history, costs, channels: [online], month: "2026-10", sales: [], purchases: [payment], investments: [] }).fixedPayments).toEqual([{ expenseName: "Luz", paid: 210_000, estimated: 200_000 }]);
    expect(buildBusinessView(history, { channels: [online], purchases: [], investments: [], sales: [] }, "2026-09").structure.period).toBe("2026-08");
  });

  it("deducts a sale's known costs and estimates the missing ones with today's cost", () => {
    const recorded = sale();
    const unitVariable = recorded.items[0].unitVariableCostMinor!;
    // Recorded without any product cost: today's cost is used and marked as estimated.
    const withoutCost = sale({ id: "s2", variableCostMinor: null, productionCostMinor: null, items: recorded.items.map((item) => ({ ...item, unitVariableCostMinor: null, unitCostMinor: null })) });
    expect(saleVariableCost(withoutCost, costs)).toEqual({ amount: unitVariable * 4, estimated: unitVariable * 4, usedToday: true, missing: false });
    // A product that still has no cost adds nothing, but the known part of the sale is still deducted.
    const mixed = sale({ id: "s3", variableCostMinor: null, items: [...recorded.items, { productId: "gone", productName: "Tofu viejo", quantityMilli: 2000, unitPriceMinor: 2000, unitVariableCostMinor: null, unitCostMinor: null }] });
    expect(saleVariableCost(mixed, costs)).toEqual({ amount: unitVariable * 4, estimated: 0, usedToday: false, missing: true });
    const result = monthResult({ state, costs, channels: [online], month: "2026-09", sales: [recorded, withoutCost, mixed], purchases: [], investments: [] });
    expect(result.variableProductionCost).toBe(unitVariable * 12);
    expect(result.estimatedVariableCost).toBe(unitVariable * 4);
    expect(result.salesWithEstimatedCost).toBe(1);
    expect(result.salesWithoutCost).toBe(1);
  });

  it("lists only investments already bought, and says when the month's records were cut", () => {
    const later: Purchase = { id: "p9", purchasedOn: "2026-11-02", description: "Horno", supplier: "", amountMinor: 1_200_000, kind: "investment", area: "production", usefulLifeMonths: 24, source: "user" };
    expect(companyStructure(state, [later], "2026-09").areas.find((item) => item.area === "production")!.investments).toEqual([]);
    expect(monthsLeft(later, "2026-09")).toBe(24);
    expect(monthsLeft(later, "2026-12")).toBe(23);
    expect(monthResult({ state, costs, channels: [online], month: "2026-09", sales: [], purchases: [], investments: [later], incompleteRecords: true }).incompleteRecords).toBe(true);
  });

  it("corrects a sale whose product was taken out of the catalog, keeping what was recorded for it", () => {
    const retired = { productId: "viejo", productName: "Tofu viejo", quantityMilli: 2000, unitPriceMinor: 1500, unitVariableCostMinor: 350, unitCostMinor: 450 };
    const priced = priceSale(state, costs, online, [{ productId: "t300", quantity: 4 }]);
    // Recorded: 4 × 2000 + 2 × 1500 = 11 000; 10 % commission = 1 100; the retired product had 60 per unit of packaging.
    const original: Sale = { id: "s9", soldOn: "2026-09-12", channelId: "ig", channelName: "Instagram", customer: "", note: "", source: "user", ...priced,
      items: [...priced.items, retired], totalMinor: 11_000, sellingCostMinor: 1_100 + 120, variableCostMinor: priced.variableCostMinor! + 700, productionCostMinor: priced.productionCostMinor! + 900, paidMinor: 11_000, paymentMethod: null, paidOn: "2026-09-12" };
    const moved = repriceSale(original, { channelId: "may" }, state, costs, [online, wholesale]);
    expect(moved.problems).toEqual([]);
    // Wholesale has no commission: only the packaging recorded with the sale stays.
    expect(moved.sale).toMatchObject({ totalMinor: 11_000, sellingCostMinor: 120, variableCostMinor: original.variableCostMinor });
    const fewer = repriceSale(original, { items: [{ productId: "t300", quantity: 4 }, { productId: "viejo", quantity: 1 }] }, state, costs, [online]);
    expect(fewer.problems).toEqual([]);
    expect(fewer.sale.items.find((item) => item.productId === "viejo")).toMatchObject({ quantityMilli: 1000, unitPriceMinor: 1500, unitVariableCostMinor: 350 });
    // 8 000 + 1 500 = 9 500; commission 950 plus 60 of packaging for the one retired unit left.
    expect(fewer.sale).toMatchObject({ totalMinor: 9_500, sellingCostMinor: 1_010 });
    expect(repriceSale(original, { items: [{ productId: "nunca", quantity: 1 }] }, state, costs, [online]).problems).toEqual(["Un producto de la venta no existe"]);
  });

  it("does not count what a cancelled delivery would have cost", () => {
    const tally = emptyTally();
    tallyDelivery(tally, { status: "cancelled", scheduledOn: "2026-09-10" }, 900, "2026-09-26");
    tallyDelivery(tally, { status: "delivered", scheduledOn: "2026-09-10", deliveredOn: "2026-09-10" }, 400, "2026-09-26");
    expect(tally).toMatchObject({ total: 2, cancelled: 1, delivered: 1, cost: 400 });
    expect(describeHistoryEvent("archive-delivery", { reason: "", deliveryCostBefore: 400, deliveryCost: 0 }, (value) => `$${value}`).lines).toEqual(["Costo de entrega de la venta: $400 → $0"]);
  });
});

describe("sales and deliveries", () => {
  const sale = (): Sale => {
    const priced = priceSale(state, costs, online, [{ productId: "t300", quantity: 8 }]);
    return { id: "s1", soldOn: "2026-09-10", channelId: "ig", channelName: "Instagram", customer: "Ana", note: "", documentId: null, source: "user", ...priced, paidMinor: priced.totalMinor, paymentMethod: null, paidOn: "2026-09-10" };
  };

  it("sorts sales most recent first and deliveries by closeness to today, the one ahead first on a tie", () => {
    expect(byRecency([{ d: "2026-09-02" }, { d: "2026-09-20" }, { d: "2026-09-11" }], (item) => item.d).map((item) => item.d)).toEqual(["2026-09-20", "2026-09-11", "2026-09-02"]);
    expect(byProximity([{ d: "2026-09-20" }, { d: "2026-09-27" }, { d: "2026-09-25" }, { d: "2026-10-05" }, { d: "2026-09-26" }], (item) => item.d, "2026-09-26").map((item) => item.d))
      .toEqual(["2026-09-26", "2026-09-27", "2026-09-25", "2026-09-20", "2026-10-05"]);
  });

  it("creates deliveries for channels that deliver, and marks past ones as delivered", () => {
    expect(needsDelivery(online)).toBe(true);
    expect(needsDelivery(wholesale)).toBe(false);
    expect(needsDelivery({ deliveryMethod: "Retiro en el local", deliveryCostPerOrderMinor: 0 })).toBe(false);
    expect(needsDelivery({ deliveryMethod: "Correo", deliveryCostPerOrderMinor: 0 })).toBe(true);
    expect(needsDelivery(wholesale, 900)).toBe(true);
    expect(initialDeliveryStatus("2026-09-20", "2026-09-26")).toBe("delivered");
    expect(initialDeliveryStatus("2026-09-26", "2026-09-26")).toBe("pending");
  });

  it("keeps the price charged and the cost of the day when a sale is corrected", () => {
    const original = sale();
    // Quantity changes: same unit price and unit cost as recorded, commission follows the new total.
    const more = repriceSale(original, { items: [{ productId: "t300", quantity: 10 }] }, state, costs, [online]);
    expect(more.problems).toEqual([]);
    expect(more.sale.totalMinor).toBe(20_000);
    expect(more.sale.sellingCostMinor).toBe(2_000);
    expect(more.sale.variableCostMinor).toBe(original.items[0].unitVariableCostMinor! * 10);
    // A cost that changed later does not rewrite the sale.
    const pricier = calculateCosts({ ...state, materials: state.materials.map((item) => ({ ...item, priceMinor: 5000 })) });
    expect(repriceSale(original, { items: [{ productId: "t300", quantity: 8 }] }, state, pricier, [online]).sale.variableCostMinor).toBe(original.variableCostMinor);
    // Moving it to wholesale keeps the price charged, drops the commission and takes that channel delivery cost.
    const moved = repriceSale(original, { channelId: "may" }, state, costs, [online, wholesale]);
    expect(moved.sale).toMatchObject({ channelName: "Mayorista", totalMinor: original.totalMinor, sellingCostMinor: 0, deliveryCostMinor: 0 });
    // Only a note: nothing else moves.
    expect(repriceSale(original, { note: "pagó por transferencia" }, state, costs, []).sale).toMatchObject({ note: "pagó por transferencia", sellingCostMinor: original.sellingCostMinor, totalMinor: original.totalMinor });
    expect(repriceSale(original, { channelId: "nope" }, state, costs, [online]).problems).toEqual(["Ese canal no existe"]);
  });

  it("summarizes what is due, late and what delivering cost in the month", () => {
    const base = { saleId: "s", timeWindow: "", method: "", carrier: "", recipient: "", address: "", contact: "", tracking: "", note: "", deliveredOn: null, zoneId: null, zoneName: "", routePosition: null, source: "user" as const, sale: { soldOn: "2026-09-01", channelId: null, channelName: "", customer: "", totalMinor: 0, items: "" } };
    const list: Delivery[] = [
      { ...base, id: "a", scheduledOn: "2026-09-26", status: "pending", costMinor: 400 },
      { ...base, id: "b", scheduledOn: "2026-09-24", status: "on_the_way", costMinor: 400 },
      { ...base, id: "c", scheduledOn: "2026-09-10", status: "delivered", costMinor: 600 },
      { ...base, id: "d", scheduledOn: "2026-09-30", status: "failed", costMinor: 0 },
      { ...base, id: "e", scheduledOn: "2026-09-28", status: "cancelled", costMinor: 999 },
    ];
    expect(deliverySummary(list, "2026-09-26", "2026-09")).toEqual({ today: 1, next7: 2, overdue: 1, onTheWay: 1, delivered: 1, failed: 1, cost: 1400, averageCost: 350 });
  });

  it("completes, with today's cost, a sale recorded without a product's full cost", () => {
    const incomplete: Sale = { ...sale(), items: sale().items.map((item) => ({ ...item, unitVariableCostMinor: null, unitCostMinor: null })), variableCostMinor: null, productionCostMinor: null };
    expect(canFillSaleCosts(incomplete, costs)).toBe(true);
    expect(canFillSaleCosts(sale(), costs)).toBe(false);
    const filled = repriceSale(incomplete, { fillMissingCosts: true }, state, costs, [online]).sale;
    expect(filled.variableCostMinor).toBe(sale().variableCostMinor);
    expect(filled.totalMinor).toBe(incomplete.totalMinor);
    expect(filled.sellingCostMinor).toBe(incomplete.sellingCostMinor);
  });

  it("remembers customers with their last address, and describes each change in plain words", () => {
    const directory = buildCustomerDirectory([
      { customer: "Ana López", soldOn: "2026-09-01", address: "Mitre 10", contact: "351 1" },
      { customer: "ana lopez", soldOn: "2026-09-20", address: "Belgrano 88", recipient: "Portería", carrier: "Moto propia" },
      { customer: "", soldOn: "2026-09-22", recipient: "Juan", address: "Caseros 5" },
    ]);
    expect(directory.customers).toEqual([{ name: "ana lopez", address: "Belgrano 88", contact: "351 1", recipient: "Portería", lastOn: "2026-09-20", sales: 2 }]);
    expect(directory.addresses).toEqual(["Caseros 5", "Belgrano 88", "Mitre 10"]);
    expect(directory.carriers).toEqual(["Moto propia"]);
    const money = (value: number) => `$${value}`;
    expect(describeHistoryEvent("update-sale", { before: { customer: "Ana", deliveryCostMinor: 400 }, patch: { customer: "Ana López", deliveryCost: 600 }, source: "user" }, money)).toEqual({ title: "Venta corregida", lines: ["Cliente: Ana → Ana López", "Costo de entrega: $400 → $600"] });
    expect(describeHistoryEvent("update-delivery", { id: "d1", status: "delivered", source: "cozte" }, money)).toEqual({ title: "Entrega actualizada", lines: ["Estado: Entregada"] });
    expect(describeHistoryEvent("archive-sale", { reason: "duplicada" }, money)).toEqual({ title: "Venta anulada", lines: ["Motivo: duplicada"] });
  });
});

describe("what a sale collected", () => {
  it("is paid in full unless the person says otherwise, and says what is still owed", () => {
    expect(initialPayment(1000, {}, "2026-09-10")).toEqual({ paidMinor: 1000, paymentMethod: null, paidOn: "2026-09-10" });
    expect(initialPayment(1000, { paidAmount: 0 }, "2026-09-10")).toEqual({ paidMinor: 0, paymentMethod: null, paidOn: null });
    expect(initialPayment(1000, { paidAmount: 300, paymentMethod: "cash" }, "2026-09-10")).toEqual({ paidMinor: 300, paymentMethod: "cash", paidOn: null });
    expect(salePayment({ totalMinor: 1000, paidMinor: 300 })).toEqual({ status: "partial", owedMinor: 700 });
    expect(salePayment({ totalMinor: 1000, paidMinor: 0 })).toEqual({ status: "pending", owedMinor: 1000 });
    expect(salePayment({ totalMinor: 1000, paidMinor: 1000 })).toEqual({ status: "paid", owedMinor: 0 });
  });

  it("collects in parts or in full, and a paid sale stays paid when its total changes", () => {
    const owed = { totalMinor: 1000, paidMinor: 0, paymentMethod: null, paidOn: null };
    expect(nextPayment(owed, 1000, { paidAmount: 400, paymentMethod: "transfer" }, "2026-09-12")).toEqual({ paidMinor: 400, paymentMethod: "transfer", paidOn: null });
    expect(nextPayment(owed, 1000, { markPaid: true }, "2026-09-12")).toEqual({ paidMinor: 1000, paymentMethod: null, paidOn: "2026-09-12" });
    const paid = { totalMinor: 1000, paidMinor: 1000, paymentMethod: "cash" as const, paidOn: "2026-09-10" };
    expect(nextPayment(paid, 1500, {}, "2026-09-12")).toEqual({ paidMinor: 1500, paymentMethod: "cash", paidOn: "2026-09-10" });
    // Something owed keeps what was collected, never more than the new total.
    expect(nextPayment({ ...owed, paidMinor: 800 }, 600, {}, "2026-09-12")).toEqual({ paidMinor: 600, paymentMethod: null, paidOn: "2026-09-12" });
    expect(nextPayment(paid, 1000, { paidAmount: 0 }, "2026-09-12")).toEqual({ paidMinor: 0, paymentMethod: "cash", paidOn: null });
  });

  it("adds up what customers owe and tells the history of a collection", () => {
    expect(receivableOf([{ totalMinor: 1000, paidMinor: 0, soldOn: "2026-09-10" }, { totalMinor: 500, paidMinor: 200, soldOn: "2026-08-02" }, { totalMinor: 300, paidMinor: 300, soldOn: "2026-07-01" }])).toEqual({ totalMinor: 1300, sales: 2, oldestOn: "2026-08-02" });
    const money = (value: number) => `$${value}`;
    expect(describeHistoryEvent("update-sale", { before: { paidMinor: 0, paymentMethod: null }, patch: { paidAmount: 400, paymentMethod: "transfer" }, source: "user" }, money).lines).toEqual(["Cobrado: $0 → $400", "Medio de pago: sin indicar → Transferencia"]);
  });
});
