import { driverWeight, variableShareBps, type CostArea, type CostBehavior, type DomainState, type ProductCost, type SharedExpense, type VariableDriver } from "./domain";
import { roundMoney } from "./money";

/**
 * The break-even of a normal month, the way a small business reads it: 1) the fixed costs in one list that adds up,
 * 2) what making and selling one unit of each product costs and what it leaves, 3) the sales mix (each product's share)
 * and, from those, how many units of each to sell to cover the fixed costs (and to earn a target profit).
 *
 * How each expense behaves (fixed, variable or mixed) and the mix are the business's own choices, not ours: every
 * choice shows as an assumption, and the data that contradicts one shows as an alert.
 */

export type MixBasis = "units" | "revenue";
export type MixSource = "auto" | "manual" | "last_month" | "plan" | "equal";
export const MIX_SOURCES: MixSource[] = ["auto", "manual", "last_month", "plan", "equal"];

export type SalesMixPlan = {
  basis: MixBasis;
  source: MixSource;
  /** Manual shares by product id, in hundredths of a percent, in the plan's basis. */
  shares: Record<string, number>;
  targetProfitMinor: number;
  note: string;
};

export const DEFAULT_MIX_PLAN: SalesMixPlan = { basis: "units", source: "auto", shares: {}, targetProfitMinor: 0, note: "" };

export const MIX_SOURCE_LABELS: Record<MixSource, string> = {
  auto: "Automática", manual: "Elegida por vos", last_month: "Lo vendido el mes pasado", plan: "El plan de producción", equal: "Partes iguales",
};
export const BEHAVIOR_LABELS: Record<CostBehavior, string> = { fixed: "Fijo", variable: "Variable", mixed: "Mixto" };
export const DRIVER_LABELS: Record<VariableDriver, string> = { unit: "cada unidad", lot: "cada tanda", hour: "cada hora de producción" };

/** How an expense behaves in a few words, for lists: "Gasto fijo", "Variable · cada tanda", "Mixto · 40 % variable". */
export function behaviorTag(expense: Pick<SharedExpense, "behavior" | "variableDriver" | "variableShareBps"> | undefined) {
  if (!expense?.behavior || expense.behavior === "fixed") return "Gasto fijo";
  if (expense.behavior === "variable") return `Variable · ${DRIVER_LABELS[expense.variableDriver ?? "unit"]}`;
  return `Mixto · ${Math.round((expense.variableShareBps ?? 5000) / 100)} % variable`;
}

export type CostItem = {
  id: string; name: string; category: string; area: CostArea; kind: "expense" | "investment";
  amount: number; behavior: CostBehavior; driver: VariableDriver | null; variablePercent: number;
  fixedPart: number; variablePart: number; note: string;
};

export type ProductSales = Record<string, { units: number; revenue: number }>;

export type BreakEvenProduct = {
  productId: string; name: string; price: number;
  /** What one unit costs to make and sell, by part. */
  variable: { materials: number; labor: number; expenses: number; selling: number; total: number };
  contributionUnit: number | null;
  contributionRatio: number | null;
  unitShare: number; revenueShare: number;
  unitsNeeded: number | null; revenueNeeded: number | null;
  targetUnits: number | null;
  soldUnits: number; soldRevenue: number;
  /** Why it is left out of the break-even (no price, incomplete cost), if it is. */
  missing: string | null;
};

export type Assumption = { id: string; kind: "behavior" | "mix" | "product"; text: string; reviewed: boolean };

export type BreakEvenPlan = {
  period: string;
  currency: string;
  fixed: { items: CostItem[]; total: number; byCategory: { category: string; amount: number }[] };
  variableItems: CostItem[];
  products: BreakEvenProduct[];
  mix: { basis: MixBasis; source: MixSource; used: Exclude<MixSource, "auto">; shares: Record<string, number> };
  weightedContributionUnit: number | null;
  breakEven: { units: number; revenue: number } | null;
  target: { profit: number; units: number; revenue: number } | null;
  assumptions: Assumption[];
  /** Expenses marked fixed that usually grow with production: worth a look. */
  suggestions: { expenseId: string; name: string; text: string }[];
  alerts: string[];
  warnings: string[];
};

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

/** Expense names that usually grow with production (packaging, fuel, gas for each batch, commissions, freight). */
const USUALLY_VARIABLE = /(?<![\p{L}])(gas|garrafa|envase|envases|embalaje|packaging|bolsa|bolsas|etiqueta|etiquetas|comisi[oó]n|comisiones|flete|fletes|nafta|combustible|a destajo|por pieza)(?![\p{L}])/iu;

export function buildBreakEvenPlan(input: { state: DomainState; costs: ProductCost[]; plan?: SalesMixPlan; lastMonth?: ProductSales; thisMonth?: ProductSales; lastMonthLabel?: string }): BreakEvenPlan {
  const { state, costs } = input;
  const plan = input.plan ?? DEFAULT_MIX_PLAN;
  const currency = state.organization.currency;
  const round = (value: number) => roundMoney(value, currency);
  const period = state.activePeriod;
  const warnings: string[] = [];
  const alerts: string[] = [];

  // 1) Every cost of the month split in its fixed part and the part that grows with production.
  const expenses = state.expenses.filter((item) => item.period === period).map((item): CostItem => {
    const share = variableShareBps(item);
    const variablePart = round(item.amountMinor * share / 10000);
    return {
      id: item.id, name: item.name, category: item.category, area: item.area ?? "production", kind: "expense", amount: item.amountMinor,
      behavior: item.behavior ?? "fixed", driver: share ? item.variableDriver ?? (item.allocationBasis === "units" ? "unit" : "hour") : null,
      variablePercent: share / 100, fixedPart: round(item.amountMinor - variablePart), variablePart, note: item.behaviorNote ?? "",
    };
  });
  const investments = (state.investments ?? []).flatMap((item): CostItem[] => {
    const elapsed = monthIndex(period) - monthIndex(item.purchasedOn.slice(0, 7));
    if (elapsed < 0 || elapsed >= item.usefulLifeMonths) return [];
    const monthly = round(item.amountMinor / item.usefulLifeMonths);
    return [{ id: item.id, name: `${item.name} (inversión)`, category: "Inversiones", area: item.area, kind: "investment", amount: monthly, behavior: "fixed", driver: null, variablePercent: 0, fixedPart: monthly, variablePart: 0, note: `Su precio repartido en ${item.usefulLifeMonths} meses` }];
  });
  const fixedItems = [...expenses, ...investments].filter((item) => item.fixedPart > 0);
  const fixedTotal = round(fixedItems.reduce((sum, item) => sum + item.fixedPart, 0));
  const categories = new Map<string, number>();
  for (const item of fixedItems) categories.set(item.category, (categories.get(item.category) ?? 0) + item.fixedPart);

  // Variable parts outside the workshop (sales, delivery, admin) go to each product by their driver; the workshop's are
  // already in each product's cost.
  const outside = expenses.filter((item) => item.variablePart > 0 && item.area !== "production");
  const outsidePerUnit = new Map<string, number>(state.products.map((product) => [product.id, 0]));
  for (const item of outside) {
    const weights = state.products.map((product) => ({ id: product.id, weight: driverWeight(product, item.driver ?? "unit") }));
    const total = weights.reduce((sum, weight) => sum + weight.weight, 0);
    if (!total) continue;
    for (const product of state.products) {
      const monthlyUnits = product.lotUnits * ((product.batchesPerMonthMilli ?? 1000) / 1000);
      const share = item.variablePart * (weights.find((weight) => weight.id === product.id)!.weight / total);
      outsidePerUnit.set(product.id, outsidePerUnit.get(product.id)! + (monthlyUnits > 0 ? share / monthlyUnits : 0));
    }
  }

  // 2) Each product's sheet: what one unit costs to make and sell, and what it leaves.
  const products = state.products.map((product): BreakEvenProduct => {
    const cost = costs.find((item) => item.productId === product.id);
    const per = cost?.perUnit;
    const materials = per?.materialMinor ?? 0, labor = per?.laborMinor ?? 0;
    const expensesUnit = round((per?.variableExpenseMinor ?? 0) + (outsidePerUnit.get(product.id) ?? 0));
    const selling = product.salesVariableMinor;
    const total = round(materials + labor + expensesUnit + selling);
    const missing = !per ? "Le falta información para calcular su costo" : !(product.salePriceMinor > 0) ? "Le falta el precio de venta" : null;
    const contributionUnit = missing ? null : round(product.salePriceMinor - total);
    return {
      productId: product.id, name: product.name, price: product.salePriceMinor,
      variable: { materials, labor, expenses: expensesUnit, selling, total },
      contributionUnit, contributionRatio: contributionUnit === null ? null : contributionUnit / product.salePriceMinor,
      unitShare: 0, revenueShare: 0, unitsNeeded: null, revenueNeeded: null, targetUnits: null,
      soldUnits: input.thisMonth?.[product.id]?.units ?? 0, soldRevenue: input.thisMonth?.[product.id]?.revenue ?? 0, missing,
    };
  });
  for (const product of products) {
    if (product.missing) warnings.push(`${product.name}: ${product.missing.toLowerCase()}; queda fuera del punto de equilibrio.`);
    else if ((product.contributionUnit ?? 0) <= 0) warnings.push(`${product.name} no deja nada: cada unidad cuesta ${product.variable.total} y se vende a ${product.price}.`);
  }

  // 3) The mix: each product's share, from its source, in units and in revenue.
  const ready = products.filter((product) => !product.missing);
  const fromSales = (sales: ProductSales | undefined) => {
    const values = Object.fromEntries(ready.map((product) => [product.productId, plan.basis === "units" ? sales?.[product.productId]?.units ?? 0 : sales?.[product.productId]?.revenue ?? 0]));
    return Object.values(values).some((value) => value > 0) ? values : null;
  };
  const fromPlan = () => {
    const known = ready.filter((product) => (state.products.find((item) => item.id === product.productId)?.batchesPerMonthMilli ?? 0) > 0);
    if (!known.length) return null;
    return Object.fromEntries(ready.map((product) => {
      const item = state.products.find((row) => row.id === product.productId)!;
      const units = item.lotUnits * ((item.batchesPerMonthMilli ?? 0) / 1000);
      return [product.productId, plan.basis === "units" ? units : units * product.price];
    }));
  };
  const equal = () => Object.fromEntries(ready.map((product) => [product.productId, 1]));
  let used: Exclude<MixSource, "auto"> = "equal";
  let raw: Record<string, number> | null = null;
  const order: Exclude<MixSource, "auto">[] = plan.source === "auto" ? ["last_month", "plan", "equal"] : [plan.source, ...(plan.source === "manual" ? [] : ["plan", "equal"] as const)];
  for (const source of order) {
    raw = source === "manual" ? (Object.values(plan.shares).some((value) => value > 0) ? Object.fromEntries(ready.map((product) => [product.productId, plan.shares[product.productId] ?? 0])) : null)
      : source === "last_month" ? fromSales(input.lastMonth) : source === "plan" ? fromPlan() : equal();
    if (raw) { used = source; break; }
  }
  if (!raw) { raw = equal(); used = "equal"; }
  if (plan.source !== "auto" && used !== plan.source) warnings.push(`No hay datos para la mezcla "${MIX_SOURCE_LABELS[plan.source]}"; se usa "${MIX_SOURCE_LABELS[used]}".`);
  const sum = Object.values(raw).reduce((total, value) => total + value, 0) || 1;
  const shares = Object.fromEntries(Object.entries(raw).map(([id, value]) => [id, value / sum]));
  for (const product of ready) {
    if (plan.basis === "units") product.unitShare = shares[product.productId] ?? 0;
    else product.revenueShare = shares[product.productId] ?? 0;
  }
  if (plan.basis === "units") {
    const revenue = ready.reduce((total, product) => total + product.unitShare * product.price, 0) || 1;
    for (const product of ready) product.revenueShare = product.unitShare * product.price / revenue;
  } else {
    const units = ready.reduce((total, product) => total + product.revenueShare / product.price, 0) || 1;
    for (const product of ready) product.unitShare = (product.revenueShare / product.price) / units;
  }

  // Break-even: fixed costs over what an average unit of the mix leaves.
  const weighted = ready.reduce((total, product) => total + product.unitShare * (product.contributionUnit ?? 0), 0);
  let breakEven: BreakEvenPlan["breakEven"] = null;
  let target: BreakEvenPlan["target"] = null;
  if (!ready.length) warnings.push("Todavía no hay productos con costo y precio completos para calcular el punto de equilibrio.");
  else if (weighted <= 0) warnings.push("Con esta mezcla, lo que se vende no alcanza ni para sus propios costos variables: revisá precios o costos antes de mirar el punto de equilibrio.");
  else {
    const totalUnits = fixedTotal / weighted;
    for (const product of ready) {
      product.unitsNeeded = Math.ceil(totalUnits * product.unitShare - 1e-9);
      product.revenueNeeded = round(product.unitsNeeded * product.price);
    }
    breakEven = { units: ready.reduce((total, product) => total + (product.unitsNeeded ?? 0), 0), revenue: round(ready.reduce((total, product) => total + (product.revenueNeeded ?? 0), 0)) };
    if (plan.targetProfitMinor > 0) {
      const targetUnits = (fixedTotal + plan.targetProfitMinor) / weighted;
      for (const product of ready) product.targetUnits = Math.ceil(targetUnits * product.unitShare - 1e-9);
      target = { profit: plan.targetProfitMinor, units: ready.reduce((total, product) => total + (product.targetUnits ?? 0), 0), revenue: round(ready.reduce((total, product) => total + (product.targetUnits ?? 0) * product.price, 0)) };
    }
  }

  // What was assumed, in words, and what the data says against it.
  const assumptions: Assumption[] = [
    ...expenses.map((item): Assumption => ({
      id: `behavior:${item.id}`, kind: "behavior", reviewed: item.behavior !== "fixed" || Boolean(item.note),
      text: `${item.name}: ${item.behavior === "fixed" ? "fijo" : item.behavior === "variable" ? `crece con ${DRIVER_LABELS[item.driver ?? "unit"]}` : `fijo en parte; el ${item.variablePercent} % crece con ${DRIVER_LABELS[item.driver ?? "unit"]}`}${item.note ? ` (${item.note})` : ""}`,
    })),
    { id: "mix", kind: "mix", reviewed: plan.source !== "auto", text: `Mezcla de ventas ${plan.basis === "units" ? "por unidades" : "por facturación"}: ${MIX_SOURCE_LABELS[used].toLowerCase()}${used === "last_month" && input.lastMonthLabel ? ` (${input.lastMonthLabel})` : ""}${plan.note ? ` · ${plan.note}` : ""}` },
    ...costs.filter((cost) => cost.monthly.assumedBatches).map((cost): Assumption => ({ id: `batches:${cost.productId}`, kind: "product", reviewed: false, text: `${state.products.find((product) => product.id === cost.productId)?.name ?? "Un producto"}: se supone 1 tanda al mes hasta saber cuántas se hacen` })),
  ];
  const suggestions = expenses.filter((item) => item.behavior === "fixed" && !item.note && USUALLY_VARIABLE.test(item.name))
    .map((item) => ({ expenseId: item.id, name: item.name, text: `${item.name} suele crecer con la producción: si se gasta más cuando hacés más, conviene marcarlo como variable.` }));
  const actual = fromSales(input.lastMonth);
  if (plan.source === "manual" && actual) {
    const actualSum = Object.values(actual).reduce((total, value) => total + value, 0) || 1;
    const drift = ready.map((product) => ({ name: product.name, planned: shares[product.productId] ?? 0, real: (actual[product.productId] ?? 0) / actualSum })).sort((a, b) => Math.abs(b.planned - b.real) - Math.abs(a.planned - a.real))[0];
    if (drift && Math.abs(drift.planned - drift.real) >= 0.15) alerts.push(`La mezcla elegida pone ${drift.name} en ${Math.round(drift.planned * 100)} %, pero ${input.lastMonthLabel ? `en ${input.lastMonthLabel}` : "el mes pasado"} fue el ${Math.round(drift.real * 100)} % de lo vendido.`);
  }

  return {
    period, currency,
    fixed: { items: fixedItems, total: fixedTotal, byCategory: [...categories].map(([category, amount]) => ({ category, amount: round(amount) })).sort((a, b) => b.amount - a.amount) },
    variableItems: expenses.filter((item) => item.variablePart > 0),
    products,
    mix: { basis: plan.basis, source: plan.source, used, shares },
    weightedContributionUnit: ready.length && weighted > 0 ? round(weighted) : null,
    breakEven, target, assumptions, suggestions, alerts, warnings,
  };
}
