import { convertNativeMilli, type Currency, type FxQuote } from "./currency";
import { moneyScale, roundMoney } from "./money";

export type Product = {
  id: string;
  name: string;
  lotUnits: number;
  salePriceMinor: number;
  salesVariableMinor: number;
  laborLotMinor: number;
  productionHoursMilli: number;
  /** Lots produced in a normal month, in thousandths; null when the business has not said it yet. */
  batchesPerMonthMilli?: number | null;
  version: number;
};

export type Material = {
  id: string;
  name: string;
  supplier: string;
  purchaseUnit: string;
  category: string;
  priceMinor: number | null;
  source: string | null;
  effectiveDate: string | null;
  version: number;
  currency?: Currency;
  nativeAmountMilli?: number | null;
};

export type Component = {
  productId: string;
  materialId: string;
  quantityMilli: number;
};

/** Where a monthly expense belongs. Only production expenses are spread into each product's cost. */
export type CostArea = "production" | "delivery" | "sales" | "admin";
export const COST_AREAS: CostArea[] = ["production", "delivery", "sales", "admin"];

export type SharedExpense = {
  id: string;
  name: string;
  period: string;
  /** Missing on older data, which was always production. */
  area?: CostArea;
  amountMinor: number;
  allocationBasis: "hours" | "units" | "manual";
  allocationShares?: Record<string, number>;
  category: string;
  version: number;
  currency?: Currency;
  nativeAmountMilli?: number;
  fxMissing?: boolean;
  /** Set on an expense that continues into a new period: the expense it was copied from. */
  carriedFrom?: string;
};

/** Something bought to last (a tool, a machine, a computer), spread over the months it is used. */
export type Investment = {
  id: string;
  name: string;
  amountMinor: number;
  purchasedOn: string;
  usefulLifeMonths: number;
  area: CostArea;
  /** The person's choice: whether a workshop investment's monthly share goes into each unit's cost. */
  includeInUnitCost: boolean;
  allocationBasis: "hours" | "units";
};

export type ProductionWorkMap = {
  isDraft: boolean;
  products: { name: string; finishedUnit: string; goodUnitsPerBatch: number | null; startedUnitsPerBatch: number | null; normalScrapUnitsPerBatch: number | null; batchesPerMonth: number | null; hoursPerBatch: number | null }[];
  costs: { product: string; unitMinor: number | null }[];
  evaluableProducts: string[];
  inputs: { name: string; consumptionUnit: string; usage: { product: string; quantityPerBatch: number | null }[] }[];
  recurringCosts: { name: string; allocation: "production_hours" | "finished_units" | "manual_percentage"; shares: { product: string; percent: number }[] }[];
};

export type DomainState = {
  revision: number;
  activePeriod: string;
  /** Where the business is (country code, city, timezone), when known. */
  organization: { id: string; name: string; currency: Currency; country?: string | null; city?: string | null; timeZone?: string | null };
  fxQuotes?: Partial<Record<Currency, FxQuote>>;
  products: Product[];
  materials: Material[];
  components: Component[];
  expenses: SharedExpense[];
  categories?: { id: string; name: string }[];
  productionWork?: ProductionWorkMap | null;
  investments?: Investment[];
};

export type CostLine = {
  kind: "material" | "labor" | "shared_expense";
  label: string;
  amountMinor: number;
  materialId?: string;
  quantityMilli?: number;
};

export type CostQuality = "complete" | "estimated" | "incomplete";

export type ProductCost = {
  productId: string;
  totalLotMinor: number | null;
  unitMinor: number | null;
  estimatedMarginPercent: number | null;
  lines: CostLine[];
  /** Blocking gaps: while any exists the unit cost is not presented as a number. */
  warnings: string[];
  /** Non-blocking simplifications the estimate relies on; each one lowers confidence. */
  assumptions: string[];
  quality: CostQuality;
  /** Per-unit cost of the parts that are known, useful while the full cost is incomplete. */
  partialUnitMinor: number;
  perUnit: { materialMinor: number; laborMinor: number; sharedMinor: number } | null;
  monthly: { batchesMilli: number; units: number; sharedMinor: number; assumedBatches: boolean; sharedByExpense: Record<string, number> };
  economics: { variableUnitMinor: number; contributionUnitMinor: number; breakEvenUnitsPerMonth: number | null } | null;
};

const ASSUMED_BATCHES_MILLI = 1000;

function productBatchesMilli(product: Product): { batchesMilli: number; assumed: boolean } {
  const value = product.batchesPerMonthMilli;
  return value != null && value > 0 ? { batchesMilli: value, assumed: false } : { batchesMilli: ASSUMED_BATCHES_MILLI, assumed: true };
}

/** An amount in thousandths of a currency, in the organization's currency at its money precision (cents or whole units). */
export function convertToOrganizationCurrency(state: DomainState, nativeAmountMilli: number, currency: Currency): number | null {
  if (currency === state.organization.currency) return roundMoney(nativeAmountMilli / 1000, currency);
  const quote = state.fxQuotes?.[currency];
  return quote ? convertNativeMilli(nativeAmountMilli, quote) : null;
}

/**
 * A price per purchase unit in the organization's currency, kept to thousandths: a screw at CLP 12.5 or a label at
 * USD 0.045 must not be rounded before it is multiplied by what a lot uses. Only the lot's total is rounded to money.
 */
export function convertUnitPrice(state: Pick<DomainState, "organization" | "fxQuotes">, nativeAmountMilli: number, currency: Currency): number | null {
  if (currency === state.organization.currency) return nativeAmountMilli / 1000;
  const quote = state.fxQuotes?.[currency];
  if (!quote) return null;
  return Number((BigInt(nativeAmountMilli) * BigInt(quote.ratePpm) + 500_000n) / 1_000_000n) / 1000;
}

/** Monthly expenses of the workshop for the active period. */
export function productionExpenses(state: Pick<DomainState, "expenses" | "activePeriod">): SharedExpense[] {
  return state.expenses.filter((item) => item.period === state.activePeriod && (item.area ?? "production") === "production");
}

/**
 * The costing period in force in a month: the latest one that started on or before it (the active one for months
 * after it). Before the first period the business had not recorded its monthly expenses yet: null.
 */
export function periodInForce(state: Pick<DomainState, "expenses" | "activePeriod">, month: string): string | null {
  const started = [...new Set(state.expenses.map((item) => item.period))].filter((period) => period <= month).sort();
  return started.at(-1) ?? null;
}

/**
 * The monthly expenses in force in a month, for its result and structure. A month before the first period only
 * carries the first period's expenses when it has activity of its own (sales or purchases), so a month recorded
 * afterwards does not show a profit without fixed costs, and an empty month before the business started shows none.
 */
export function expensesInForce(state: Pick<DomainState, "expenses" | "activePeriod">, month: string, hasActivity = true): { period: string | null; expenses: SharedExpense[] } {
  const first = state.expenses.map((item) => item.period).sort()[0] ?? null;
  const period = periodInForce(state, month) ?? (hasActivity ? first : null);
  return { period, expenses: period ? state.expenses.filter((item) => item.period === period) : [] };
}

const monthNumber = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

/**
 * An investment's share of a month, at its currency's money precision: straight-line over its useful life while it
 * lasts. Each month takes the rounded cumulative amount minus the previous one, so the shares of its whole life add up
 * to exactly its price.
 */
export function investmentMonthlyShare(item: Pick<Investment, "amountMinor" | "purchasedOn" | "usefulLifeMonths">, month: string, currency?: string | null): number {
  const life = item.usefulLifeMonths;
  const elapsed = monthNumber(month) - monthNumber(item.purchasedOn.slice(0, 7));
  if (!(life > 0) || elapsed < 0 || elapsed >= life) return 0;
  const scale = moneyScale(currency);
  const units = Math.round(item.amountMinor * scale);
  const through = (months: number) => Math.round(units * months / life);
  return (through(elapsed + 1) - through(elapsed)) / scale;
}

/**
 * Everything spread into each unit's cost: the workshop's monthly expenses plus the workshop investments the person
 * chose to include, as their monthly share. Investment sources carry an "investment:" id.
 */
export function productionCostSources(state: Pick<DomainState, "expenses" | "activePeriod" | "investments"> & { organization?: { currency: string } }): SharedExpense[] {
  const investments = (state.investments ?? []).filter((item) => item.area === "production" && item.includeInUnitCost).flatMap((item): SharedExpense[] => {
    const amountMinor = investmentMonthlyShare(item, state.activePeriod, state.organization?.currency);
    return amountMinor > 0 ? [{ id: `investment:${item.id}`, name: `${item.name} (inversión)`, period: state.activePeriod, area: "production", amountMinor, allocationBasis: item.allocationBasis, category: "Inversiones", version: 1 }] : [];
  });
  return [...productionExpenses(state), ...investments];
}

function safeInteger(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("Importe fuera del rango permitido");
  return number;
}

export function roundRatio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n || numerator < 0n) throw new Error("Cociente inválido");
  return safeInteger((numerator + denominator / 2n) / denominator);
}

// Resto mayor: la suma distribuida es siempre exactamente el importe original.
export function allocateMinor(
  amountMinor: number,
  activities: Array<{ id: string; weight: number }>,
): Record<string, number> {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error("Importe inválido");
  const weights = activities.map((activity) => {
    if (!Number.isSafeInteger(activity.weight) || activity.weight < 0) throw new Error("Actividad inválida");
    return { id: activity.id, weight: BigInt(activity.weight) };
  });
  const denominator = weights.reduce((sum, item) => sum + item.weight, 0n);
  if (denominator === 0n) {
    if (amountMinor === 0) return Object.fromEntries(weights.map((item) => [item.id, 0]));
    throw new Error("No hay actividad para repartir gastos comunes");
  }
  const amount = BigInt(amountMinor);
  const allocations = weights.map((item) => {
    const weighted = amount * item.weight;
    return { id: item.id, minor: safeInteger(weighted / denominator), remainder: weighted % denominator };
  });
  const remaining = amountMinor - allocations.reduce((sum, item) => sum + item.minor, 0);
  allocations.sort((a, b) => {
    if (a.remainder === b.remainder) return a.id.localeCompare(b.id);
    return a.remainder > b.remainder ? -1 : 1;
  });
  for (let i = 0; i < remaining; i++) allocations[i].minor++;
  return Object.fromEntries(allocations.map((item) => [item.id, item.minor]));
}

/**
 * Costs every product for the active period.
 *
 * Shared expenses are monthly amounts. Each one is split across products by
 * monthly activity (hours or good units per lot × lots per month, or agreed
 * percentages) and then spread over that product's lots, so a lot only carries
 * its own share of the month. A product without monthly volume is costed as if
 * it made one lot per month and the estimate says so in `assumptions`.
 *
 * Money is computed as integers of the currency's smallest unit (cents, or whole
 * units for currencies without them) so allocations add up exactly; material
 * prices enter with their thousandths and only each lot line is rounded.
 */
export function calculateCosts(
  state: DomainState,
  proposedMaterials: Record<string, number> = {},
  proposedExpenses: Record<string, number> = {},
): ProductCost[] {
  if (state.products.length === 0) return [];
  const currency = state.organization.currency;
  const scale = moneyScale(currency);
  const units = (amount: number) => Math.round(amount * scale);
  const money = (amountUnits: number) => amountUnits / scale;
  const materials = new Map(state.materials.map((item) => [item.id, item]));
  const components = new Map<string, Component[]>();
  for (const item of state.components) {
    const list = components.get(item.productId) ?? [];
    list.push(item);
    components.set(item.productId, list);
  }
  const volume = new Map(state.products.map((product) => [product.id, productBatchesMilli(product)]));

  const monthlyShared: Record<string, number> = Object.fromEntries(state.products.map((product) => [product.id, 0]));
  const sharedByExpense: Record<string, Record<string, number>> = Object.fromEntries(state.products.map((product) => [product.id, {}]));
  const unallocatedExpenses: string[] = [];
  const periodExpenses = productionCostSources(state);
  const missingExpenseFx = periodExpenses.some((expense) => expense.fxMissing);
  let sharedExpensesActive = false;
  for (const expense of periodExpenses) {
    const amount = units(proposedExpenses[expense.id] ?? expense.amountMinor);
    if (amount === 0) continue;
    sharedExpensesActive = true;
    const activities = state.products.map((product) => {
      const { batchesMilli } = volume.get(product.id)!;
      const weight = expense.allocationBasis === "hours" ? product.productionHoursMilli * batchesMilli
        : expense.allocationBasis === "units" ? product.lotUnits * batchesMilli
        : expense.allocationShares?.[product.id] ?? 0;
      return { id: product.id, weight };
    });
    const totalActivity = activities.reduce((sum, item) => sum + item.weight, 0);
    if (totalActivity <= 0 || (expense.allocationBasis === "manual" && activities.reduce((sum, item) => sum + (expense.allocationShares?.[item.id] ?? 0), 0) !== 10000)) {
      unallocatedExpenses.push(expense.name);
      continue;
    }
    const split = allocateMinor(amount, activities);
    for (const product of state.products) {
      monthlyShared[product.id] += split[product.id];
      if (split[product.id]) sharedByExpense[product.id][expense.id] = money(split[product.id]);
    }
  }

  return state.products.map((product) => {
    const lines: (CostLine & { units: number })[] = [];
    const warnings: string[] = unallocatedExpenses.map((name) => `Falta la base para repartir ${name}: horas por lote, unidades por lote o porcentajes que sumen 100 %`);
    const assumptions: string[] = [];
    if (missingExpenseFx) warnings.push("Falta cotización vigente para un gasto compartido");
    for (const component of components.get(product.id) ?? []) {
      const material = materials.get(component.materialId);
      if (!material) {
        warnings.push("Falta un insumo de la composición");
        continue;
      }
      const price = proposedMaterials[material.id] ?? material.priceMinor;
      if (price === null) {
        warnings.push("Falta el precio de " + material.name);
        continue;
      }
      // Price per purchase unit in thousandths × quantity per lot in thousandths, rounded once to money.
      const lineUnits = roundRatio(BigInt(Math.round(price * 1000)) * BigInt(component.quantityMilli) * BigInt(scale), 1_000_000n);
      lines.push({ kind: "material", label: material.name, materialId: material.id, quantityMilli: component.quantityMilli, amountMinor: money(lineUnits), units: lineUnits });
    }
    const { batchesMilli, assumed } = volume.get(product.id)!;
    if (assumed && sharedExpensesActive) assumptions.push(`Supone 1 lote al mes de ${product.name}; con los lotes reales por mes el reparto de gastos compartidos será más preciso`);
    if (!(components.get(product.id)?.length)) assumptions.push(`${product.name} aún no tiene insumos registrados en su receta`);
    const sharedLotUnits = roundRatio(BigInt(monthlyShared[product.id] ?? 0) * 1000n, BigInt(batchesMilli));
    const laborLotUnits = units(product.laborLotMinor);
    lines.push({ kind: "labor", label: "Trabajo directo", amountMinor: money(laborLotUnits), units: laborLotUnits });
    lines.push({ kind: "shared_expense", label: "Gastos compartidos asignados", amountMinor: money(sharedLotUnits), units: sharedLotUnits });
    if (product.lotUnits <= 0) warnings.push("El lote no tiene unidades vendibles");
    const lotUnits = Math.max(product.lotUnits, 1);
    const materialLotUnits = lines.filter((line) => line.kind === "material").reduce((sum, line) => sum + line.units, 0);
    const knownLotUnits = lines.reduce((sum, line) => sum + line.units, 0);
    const costLines: CostLine[] = lines.map(({ units: _units, ...line }) => { void _units; return line; });
    // A zero production cost is never a real answer: it only means nothing is linked to the product yet.
    if (knownLotUnits === 0 && !warnings.length) warnings.push(`Aún no hay insumos, trabajo ni gastos asociados a ${product.name}`);
    const monthly = {
      batchesMilli,
      units: roundRatio(BigInt(lotUnits) * BigInt(batchesMilli), 1000n),
      sharedMinor: money(monthlyShared[product.id] ?? 0),
      assumedBatches: assumed,
      sharedByExpense: sharedByExpense[product.id] ?? {},
    };
    const partialUnitMinor = money(roundRatio(BigInt(knownLotUnits), BigInt(lotUnits)));
    if (warnings.length) {
      return {
        productId: product.id, totalLotMinor: null, unitMinor: null, estimatedMarginPercent: null,
        lines: costLines, warnings, assumptions, quality: "incomplete", partialUnitMinor, perUnit: null, monthly, economics: null,
      };
    }
    const totalLotMinor = money(knownLotUnits);
    const unitMinor = money(roundRatio(BigInt(knownLotUnits), BigInt(lotUnits)));
    const perUnit = {
      materialMinor: money(roundRatio(BigInt(materialLotUnits), BigInt(lotUnits))),
      laborMinor: money(roundRatio(BigInt(laborLotUnits), BigInt(lotUnits))),
      sharedMinor: money(roundRatio(BigInt(sharedLotUnits), BigInt(lotUnits))),
    };
    const estimatedMarginPercent = product.salePriceMinor > 0
      ? Math.round(((product.salePriceMinor - product.salesVariableMinor - unitMinor) / product.salePriceMinor) * 1000) / 10
      : null;
    // Contribution treats lot-driven costs as variable and the shared month as fixed.
    const variableUnitMinor = roundMoney(perUnit.materialMinor + perUnit.laborMinor + product.salesVariableMinor, currency);
    const contributionUnitMinor = roundMoney(product.salePriceMinor - variableUnitMinor, currency);
    const economics = product.salePriceMinor > 0 ? {
      variableUnitMinor,
      contributionUnitMinor,
      breakEvenUnitsPerMonth: contributionUnitMinor > 0 ? Math.ceil(monthly.sharedMinor / contributionUnitMinor - 1e-9) : null,
    } : null;
    return {
      productId: product.id, totalLotMinor, unitMinor, estimatedMarginPercent, lines: costLines, warnings, assumptions,
      quality: assumptions.length ? "estimated" : "complete", partialUnitMinor, perUnit, monthly, economics,
    };
  });
}
