import { calculateCosts, type DomainState, type ProductCost } from "./domain";

/** Accent-, case- and punctuation-insensitive key used to match names people type. */
export function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export type Resolution<T> = { item: T } | { item: null; candidates: string[] };

/** Resolves an id or a name without guessing: exact id, exact name, then a single unambiguous partial match. */
export function resolveEntity<T extends { id: string; name: string }>(items: T[], reference: string): Resolution<T> {
  const byId = items.find((item) => item.id === reference);
  if (byId) return { item: byId };
  const key = normalizeName(reference);
  if (!key) return { item: null, candidates: items.slice(0, 12).map((item) => item.name) };
  const exact = items.filter((item) => normalizeName(item.name) === key);
  if (exact.length === 1) return { item: exact[0] };
  const compact = key.replace(/ /g, "");
  const partial = items.filter((item) => {
    const name = normalizeName(item.name);
    const nameCompact = name.replace(/ /g, "");
    return name.includes(key) || key.includes(name) || nameCompact === compact;
  });
  if (partial.length === 1) return { item: partial[0] };
  return { item: null, candidates: (partial.length ? partial : items).slice(0, 12).map((item) => item.name) };
}

const unitFamilies: Record<string, { family: string; factor: number }> = {
  kg: { family: "mass", factor: 1000 }, kilo: { family: "mass", factor: 1000 }, kilos: { family: "mass", factor: 1000 }, kilogramo: { family: "mass", factor: 1000 }, kilogramos: { family: "mass", factor: 1000 },
  g: { family: "mass", factor: 1 }, gr: { family: "mass", factor: 1 }, grs: { family: "mass", factor: 1 }, gramo: { family: "mass", factor: 1 }, gramos: { family: "mass", factor: 1 },
  mg: { family: "mass", factor: 0.001 }, t: { family: "mass", factor: 1_000_000 }, tonelada: { family: "mass", factor: 1_000_000 }, toneladas: { family: "mass", factor: 1_000_000 },
  l: { family: "volume", factor: 1000 }, lt: { family: "volume", factor: 1000 }, litro: { family: "volume", factor: 1000 }, litros: { family: "volume", factor: 1000 },
  ml: { family: "volume", factor: 1 }, cc: { family: "volume", factor: 1 }, mililitro: { family: "volume", factor: 1 }, mililitros: { family: "volume", factor: 1 },
  m: { family: "length", factor: 1000 }, metro: { family: "length", factor: 1000 }, metros: { family: "length", factor: 1000 },
  cm: { family: "length", factor: 10 }, centimetro: { family: "length", factor: 10 }, centimetros: { family: "length", factor: 10 }, mm: { family: "length", factor: 1 },
  m2: { family: "area", factor: 10_000 }, "metro cuadrado": { family: "area", factor: 10_000 }, "metros cuadrados": { family: "area", factor: 10_000 }, cm2: { family: "area", factor: 1 },
  u: { family: "count", factor: 1 }, un: { family: "count", factor: 1 }, unidad: { family: "count", factor: 1 }, unidades: { family: "count", factor: 1 }, docena: { family: "count", factor: 12 }, docenas: { family: "count", factor: 12 },
};

function unitInfo(unit: string) {
  const key = normalizeName(unit).replace(/\s*2$/, "2").replace(/\.$/, "");
  return unitFamilies[key] ?? unitFamilies[key.replace(/ /g, "")] ?? null;
}

/** How many purchase units one usage unit represents, when both are standard units of the same kind. */
export function standardUnitRatio(usageUnit: string, purchaseUnit: string): number | null {
  if (normalizeName(usageUnit) === normalizeName(purchaseUnit)) return 1;
  const usage = unitInfo(usageUnit);
  const purchase = unitInfo(purchaseUnit);
  if (!usage || !purchase || usage.family !== purchase.family) return null;
  return usage.factor / purchase.factor;
}

/**
 * Safe arithmetic for + - * / ^ %, parentheses and dot decimals. No identifiers are evaluated.
 * Thousands separators are rejected rather than guessed: "0.350" and "1.600" must never be ambiguous.
 */
export function evaluateExpression(expression: string): number {
  const source = expression.replace(/\s+/g, "");
  if (source.includes(",")) throw new Error("Escribe los números sin separador de miles y con punto decimal, por ejemplo 1600000 o 0.35");
  if (!source || source.length > 400 || !/^[\d.+\-*/^%()]+$/.test(source)) throw new Error("Usa solo números y operadores + - * / ^ % ( )");
  let index = 0;
  const peek = () => source[index];
  const number = (): number => {
    const match = /^\d+(?:\.\d+)?|^\.\d+/.exec(source.slice(index));
    if (!match) throw new Error("Expresión incompleta");
    index += match[0].length;
    return Number(match[0]);
  };
  const primary = (): number => {
    if (peek() === "-") { index++; return -primary(); }
    if (peek() === "+") { index++; return primary(); }
    if (peek() === "(") {
      index++;
      const value = sum();
      if (peek() !== ")") throw new Error("Falta cerrar un paréntesis");
      index++;
      return value;
    }
    const value = number();
    if (peek() === "%") { index++; return value / 100; }
    return value;
  };
  const power = (): number => {
    const base = primary();
    if (peek() === "^") { index++; return base ** power(); }
    return base;
  };
  const product = (): number => {
    let value = power();
    while (peek() === "*" || peek() === "/") {
      const operator = source[index++];
      const right = power();
      if (operator === "/" && right === 0) throw new Error("División por cero");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (peek() === "+" || peek() === "-") {
      const operator = source[index++];
      const right = product();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  const result = sum();
  if (index !== source.length) throw new Error("Expresión inválida");
  if (!Number.isFinite(result)) throw new Error("El resultado no es un número finito");
  return Math.round(result * 1_000_000) / 1_000_000;
}

const perUnitOfLot = (amountLot: number, lotUnits: number) => Math.round(amountLot / Math.max(lotUnits, 1) * 100) / 100;
const lots = (milli: number | null | undefined) => milli == null ? null : milli / 1000;

function costSummary(cost: ProductCost | undefined) {
  if (!cost) return null;
  return {
    status: cost.quality,
    unitCost: cost.unitMinor,
    knownUnitCostSoFar: cost.unitMinor === null && cost.partialUnitMinor > 0 ? cost.partialUnitMinor : undefined,
    perUnit: cost.perUnit ? { materials: cost.perUnit.materialMinor, directLabor: cost.perUnit.laborMinor, sharedExpenses: cost.perUnit.sharedMinor } : null,
    lotCost: cost.totalLotMinor,
    marginPercent: cost.estimatedMarginPercent,
    contributionPerUnit: cost.economics?.contributionUnitMinor ?? null,
    breakEvenUnitsPerMonth: cost.economics?.breakEvenUnitsPerMonth ?? null,
    missing: cost.warnings,
    assumptions: cost.assumptions,
  };
}

/** Ordered list of the facts that would most improve the estimate. */
export function costGaps(state: DomainState, costs: ProductCost[]): string[] {
  const gaps = new Set<string>();
  for (const cost of costs) for (const warning of cost.warnings) gaps.add(warning);
  const activeExpenses = state.expenses.filter((item) => item.period === state.activePeriod && item.amountMinor > 0);
  for (const product of state.products) {
    if (activeExpenses.length && product.batchesPerMonthMilli == null) gaps.add(`Lotes que se producen al mes de ${product.name}`);
    if (activeExpenses.some((item) => item.allocationBasis === "hours") && product.productionHoursMilli <= 0) gaps.add(`Horas de trabajo por lote de ${product.name}`);
    if (!state.components.some((item) => item.productId === product.id)) gaps.add(`Insumos y cantidades de la receta de ${product.name}`);
  }
  for (const material of state.materials) {
    if (material.priceMinor === null) gaps.add(`Precio de ${material.name}`);
    else if (!material.source) gaps.add(`Fuente del precio de ${material.name}`);
    if (!state.components.some((item) => item.materialId === material.id)) gaps.add(`En qué productos se usa ${material.name} y cuánto por lote`);
  }
  if (state.products.length && !activeExpenses.length) gaps.add("Gastos mensuales del taller (sueldos, luz, gas, alquiler u otros) si existen");
  return [...gaps].slice(0, 20);
}

/** Compact, id-bearing snapshot the agent reads before acting. Amounts are in the organization currency. */
export function buildCostOverview(state: DomainState, costs: ProductCost[] = calculateCosts(state)) {
  const materialNames = new Map(state.materials.map((item) => [item.id, item.name]));
  const productNames = new Map(state.products.map((item) => [item.id, item.name]));
  return {
    currency: state.organization.currency,
    activePeriod: state.activePeriod,
    revision: state.revision,
    products: state.products.map((product) => ({
      id: product.id,
      name: product.name,
      goodUnitsPerLot: product.lotUnits,
      lotsPerMonth: lots(product.batchesPerMonthMilli),
      hoursPerLot: product.productionHoursMilli / 1000,
      directLaborPerLot: product.laborLotMinor,
      salePrice: product.salePriceMinor > 0 ? product.salePriceMinor : null,
      salesVariablePerUnit: product.salesVariableMinor,
      recipe: state.components.filter((item) => item.productId === product.id).map((item) => {
        const material = state.materials.find((entry) => entry.id === item.materialId);
        const quantity = item.quantityMilli / 1000;
        return {
          materialId: item.materialId, material: materialNames.get(item.materialId) ?? "Insumo no encontrado",
          quantityPerLot: quantity, perUnit: Math.round(quantity / Math.max(product.lotUnits, 1) * 100000) / 100000, unit: material?.purchaseUnit ?? "",
          costPerLot: material?.priceMinor == null ? null : Math.round(material.priceMinor * quantity),
          costPerUnit: material?.priceMinor == null ? null : Math.round(material.priceMinor * quantity / Math.max(product.lotUnits, 1) * 100) / 100,
        };
      }),
      cost: costSummary(costs.find((item) => item.productId === product.id)),
    })),
    materials: state.materials.map((item) => ({
      id: item.id, name: item.name, purchaseUnit: item.purchaseUnit, price: item.priceMinor,
      originalPrice: item.currency && item.currency !== state.organization.currency && item.nativeAmountMilli != null ? { amount: item.nativeAmountMilli / 1000, currency: item.currency } : undefined,
      source: item.source, effectiveDate: item.effectiveDate, supplier: item.supplier || null, category: item.category,
      usedBy: state.components.filter((component) => component.materialId === item.id).map((component) => productNames.get(component.productId)).filter(Boolean),
    })),
    monthlyExpenses: state.expenses.filter((item) => item.period === state.activePeriod).map((item) => ({
      id: item.id, name: item.name, monthlyAmount: item.amountMinor, category: item.category,
      originalAmount: item.currency && item.currency !== state.organization.currency && item.nativeAmountMilli != null ? { amount: item.nativeAmountMilli / 1000, currency: item.currency } : undefined,
      splitBy: item.allocationBasis === "hours" ? "production hours" : item.allocationBasis === "units" ? "good units" : "agreed percentages",
      percentages: item.allocationBasis === "manual" ? Object.fromEntries(Object.entries(item.allocationShares ?? {}).map(([id, share]) => [productNames.get(id) ?? id, share / 100])) : undefined,
    })),
    categories: (state.categories ?? []).map((item) => item.name),
    gaps: costGaps(state, costs),
  };
}

/** Full explanation of one product's cost: per lot, per unit, drivers and shared-expense shares. */
export function buildProductDetail(state: DomainState, productId: string, costs: ProductCost[] = calculateCosts(state)) {
  const product = state.products.find((item) => item.id === productId);
  const cost = costs.find((item) => item.productId === productId);
  if (!product || !cost) return null;
  const expenseNames = new Map(state.expenses.map((item) => [item.id, item]));
  const lotTotal = cost.totalLotMinor ?? cost.lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const drivers = cost.lines.filter((line) => line.amountMinor > 0).map((line) => ({
    concept: line.label,
    type: line.kind === "material" ? "direct material" : line.kind === "labor" ? "direct labor" : "shared expenses",
    perLot: line.amountMinor,
    perUnit: perUnitOfLot(line.amountMinor, product.lotUnits),
    shareOfCostPercent: lotTotal > 0 ? Math.round(line.amountMinor / lotTotal * 1000) / 10 : null,
  })).sort((a, b) => b.perLot - a.perLot);
  return {
    product: product.name,
    goodUnitsPerLot: product.lotUnits,
    lotsPerMonth: lots(product.batchesPerMonthMilli),
    assumedLotsPerMonth: cost.monthly.assumedBatches ? 1 : undefined,
    unitsPerMonth: cost.monthly.units,
    ...costSummary(cost),
    drivers,
    sharedExpenseShares: Object.entries(cost.monthly.sharedByExpense).map(([id, monthly]) => {
      const expense = expenseNames.get(id);
      return {
        expense: expense?.name ?? id,
        monthlyExpense: expense?.amountMinor ?? null,
        assignedToThisProductPerMonth: monthly,
        perLot: Math.round(monthly * 1000 / cost.monthly.batchesMilli),
        perUnit: Math.round(monthly * 1000 / cost.monthly.batchesMilli / Math.max(product.lotUnits, 1) * 100) / 100,
        splitBy: expense?.allocationBasis,
      };
    }),
  };
}

export type ScenarioInput = {
  materialPrices?: { material: string; price: number }[];
  expenseAmounts?: { expense: string; monthlyAmount: number }[];
  products?: { product: string; goodUnitsPerLot?: number; lotsPerMonth?: number; hoursPerLot?: number; directLaborPerLot?: number; salePrice?: number }[];
  recipe?: { product: string; material: string; quantityPerLot: number }[];
};

/** What-if analysis on a copy of the state; nothing is saved. */
export function simulateScenario(state: DomainState, scenario: ScenarioInput) {
  const next = structuredClone(state);
  const unresolved: string[] = [];
  for (const change of scenario.materialPrices ?? []) {
    const found = resolveEntity(next.materials, change.material);
    if (found.item) found.item.priceMinor = Math.round(change.price);
    else unresolved.push(`Insumo "${change.material}" no identificado (opciones: ${found.candidates.join(", ")})`);
  }
  for (const change of scenario.expenseAmounts ?? []) {
    const found = resolveEntity(next.expenses.filter((item) => item.period === next.activePeriod), change.expense);
    if (found.item) found.item.amountMinor = Math.round(change.monthlyAmount);
    else unresolved.push(`Gasto "${change.expense}" no identificado (opciones: ${found.candidates.join(", ")})`);
  }
  for (const change of scenario.products ?? []) {
    const found = resolveEntity(next.products, change.product);
    if (!found.item) { unresolved.push(`Producto "${change.product}" no identificado (opciones: ${found.candidates.join(", ")})`); continue; }
    if (change.goodUnitsPerLot !== undefined) found.item.lotUnits = Math.round(change.goodUnitsPerLot);
    if (change.lotsPerMonth !== undefined) found.item.batchesPerMonthMilli = Math.round(change.lotsPerMonth * 1000);
    if (change.hoursPerLot !== undefined) found.item.productionHoursMilli = Math.round(change.hoursPerLot * 1000);
    if (change.directLaborPerLot !== undefined) found.item.laborLotMinor = Math.round(change.directLaborPerLot);
    if (change.salePrice !== undefined) found.item.salePriceMinor = Math.round(change.salePrice);
  }
  for (const change of scenario.recipe ?? []) {
    const product = resolveEntity(next.products, change.product);
    const material = resolveEntity(next.materials, change.material);
    if (!product.item || !material.item) { unresolved.push(`No identifiqué ${!product.item ? `el producto "${change.product}"` : `el insumo "${change.material}"`}`); continue; }
    const productId = product.item.id;
    const materialId = material.item.id;
    next.components = next.components.filter((item) => item.productId !== productId || item.materialId !== materialId);
    if (change.quantityPerLot > 0) next.components.push({ productId, materialId, quantityMilli: Math.round(change.quantityPerLot * 1000) });
  }
  const before = calculateCosts(state);
  const after = calculateCosts(next);
  return {
    saved: false,
    unresolved,
    products: state.products.map((product) => {
      const was = before.find((item) => item.productId === product.id);
      const now = after.find((item) => item.productId === product.id);
      const unitBefore = was?.unitMinor ?? null;
      const unitAfter = now?.unitMinor ?? null;
      return {
        product: product.name, unitCostBefore: unitBefore, unitCostAfter: unitAfter,
        change: unitBefore !== null && unitAfter !== null ? unitAfter - unitBefore : null,
        changePercent: unitBefore && unitAfter !== null ? Math.round((unitAfter - unitBefore) / unitBefore * 1000) / 10 : null,
        marginBefore: was?.estimatedMarginPercent ?? null, marginAfter: now?.estimatedMarginPercent ?? null,
        statusAfter: now?.quality ?? null,
      };
    }),
  };
}
