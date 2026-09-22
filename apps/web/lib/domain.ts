export type Product = {
  id: string;
  name: string;
  lotUnits: number;
  salePriceMinor: number;
  salesVariableMinor: number;
  laborLotMinor: number;
  productionHoursMilli: number;
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
};

export type Component = {
  productId: string;
  materialId: string;
  quantityMilli: number;
};

export type SharedExpense = {
  id: string;
  name: string;
  period: string;
  amountMinor: number;
  allocationBasis: "hours" | "units";
  category: string;
  version: number;
};

export type DomainState = {
  revision: number;
  activePeriod: string;
  organization: { id: string; name: string; currency: string };
  products: Product[];
  materials: Material[];
  components: Component[];
  expenses: SharedExpense[];
};

export type CostLine = {
  kind: "material" | "labor" | "shared_expense";
  label: string;
  amountMinor: number;
  materialId?: string;
  quantityMilli?: number;
};

export type ProductCost = {
  productId: string;
  totalLotMinor: number | null;
  unitMinor: number | null;
  estimatedMarginPercent: number | null;
  lines: CostLine[];
  warnings: string[];
};

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

export function calculateCosts(
  state: DomainState,
  proposedMaterials: Record<string, number> = {},
  proposedExpenses: Record<string, number> = {},
): ProductCost[] {
  if (state.products.length === 0) return [];
  const materials = new Map(state.materials.map((item) => [item.id, item]));
  const components = new Map<string, Component[]>();
  for (const item of state.components) {
    const list = components.get(item.productId) ?? [];
    list.push(item);
    components.set(item.productId, list);
  }

  // Pilot assumption: one lot of each active product in the selected period.
  // Expenses sharing a basis are allocated together, avoiding rounding drift
  // between expense rows and the product-level total.
  const expenseAllocation: Record<string, number> = Object.fromEntries(
    state.products.map((product) => [product.id, 0]),
  );
  const unallocatedExpenseBases: string[] = [];
  for (const basis of ["hours", "units"] as const) {
    const total = state.expenses
      .filter((expense) => expense.period === state.activePeriod && expense.allocationBasis === basis)
      .reduce((sum, expense) => sum + (proposedExpenses[expense.id] ?? expense.amountMinor), 0);
    if (total === 0) continue;
    const totalActivity = state.products.reduce(
      (sum, product) => sum + (basis === "hours" ? product.productionHoursMilli : product.lotUnits), 0,
    );
    if (totalActivity === 0) {
      unallocatedExpenseBases.push(basis === "hours" ? "horas de producción" : "unidades producidas");
      continue;
    }
    const split = allocateMinor(
      total,
      state.products.map((product) => ({
        id: product.id,
        weight: basis === "hours" ? product.productionHoursMilli : product.lotUnits,
      })),
    );
    for (const product of state.products) expenseAllocation[product.id] += split[product.id];
  }

  return state.products.map((product) => {
    const lines: CostLine[] = [];
    const warnings: string[] = unallocatedExpenseBases.map((basis) => `Falta actividad para repartir gastos por ${basis}`);
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
      lines.push({
        kind: "material",
        label: material.name,
        materialId: material.id,
        quantityMilli: component.quantityMilli,
        amountMinor: roundRatio(BigInt(price) * BigInt(component.quantityMilli), 1000n),
      });
    }
    lines.push({ kind: "labor", label: "Trabajo directo", amountMinor: product.laborLotMinor });
    lines.push({
      kind: "shared_expense",
      label: "Gastos compartidos asignados",
      amountMinor: expenseAllocation[product.id] ?? 0,
    });
    if (product.lotUnits <= 0) warnings.push("El lote no tiene unidades vendibles");
    if (warnings.length) {
      return {
        productId: product.id,
        totalLotMinor: null,
        unitMinor: null,
        estimatedMarginPercent: null,
        lines,
        warnings,
      };
    }
    const totalLotMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
    const unitMinor = roundRatio(BigInt(totalLotMinor), BigInt(product.lotUnits));
    const estimatedMarginPercent = product.salePriceMinor > 0
      ? Math.round(
          ((product.salePriceMinor - product.salesVariableMinor - unitMinor) /
            product.salePriceMinor) *
            1000,
        ) / 10
      : null;
    return { productId: product.id, totalLotMinor, unitMinor, estimatedMarginPercent, lines, warnings };
  });
}
