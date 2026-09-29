import { DRIVER_LABELS } from "./break-even";
import { productionExpenses, variableShareBps, type DomainState, type ProductCost, type SharedExpense } from "./domain";
import { roundMoney } from "./money";

/**
 * Production costs split the way they behave: variable costs grow with each unit made (the recipe's supplies, labor
 * paid per lot and the expenses that rise when more is made), fixed costs are paid the same whatever is made, and a
 * mixed expense has a fixed base and a part that grows. How each expense behaves is the business's own choice.
 */

export type BehaviorGroup = "variable" | "fixed" | "mixed";

export const BEHAVIOR_GROUPS: Record<BehaviorGroup, { title: string; hint: string }> = {
  variable: { title: "Costos variables", hint: "Crecen con cada unidad que producís: los insumos de la receta y los gastos que suben cuando hacés más." },
  fixed: { title: "Costos fijos", hint: "Los pagás igual aunque produzcas más o menos: alquiler, sueldos del mes, servicios con cuota fija." },
  mixed: { title: "Costos mixtos", hint: "Tienen una base fija y una parte que crece con la producción." },
};

/** Why a supply is always variable: each unit consumes its part of the recipe. */
export const SUPPLY_BEHAVIOR_HINT = "Los insumos de la receta siempre son variables: cada unidad consume su parte. Si algo se paga igual cada mes, cargalo como costo compartido y marcalo como fijo.";

export function behaviorGroup(expense: Pick<SharedExpense, "behavior">): BehaviorGroup {
  return expense.behavior === "variable" ? "variable" : expense.behavior === "mixed" ? "mixed" : "fixed";
}

/** An expense's type in a word and what drives it: "Variable" · "crece con cada tanda". */
export function behaviorLabel(expense: Pick<SharedExpense, "behavior" | "variableDriver" | "variableShareBps">): { label: string; detail: string } {
  const group = behaviorGroup(expense);
  const driver = DRIVER_LABELS[expense.variableDriver ?? "unit"];
  if (group === "variable") return { label: "Variable", detail: `Crece con ${driver}` };
  if (group === "mixed") return { label: "Mixto", detail: `El ${variableShareBps(expense) / 100} % crece con ${driver}` };
  return { label: "Fijo", detail: "Igual todos los meses" };
}

export type ProductionCostSplit = {
  /** Each supply's cost in a normal month (price × what the recipes use × lots per month). */
  materials: Record<string, number>;
  /** Labor paid per lot, in a normal month. */
  labor: number;
  expenses: Record<string, { variable: number; fixed: number }>;
  variable: number;
  fixed: number;
};

/** What a normal month of production costs, split into what grows with production and what does not. */
export function productionCostSplit(state: DomainState, costs: ProductCost[]): ProductionCostSplit {
  const currency = state.organization.currency;
  const round = (value: number) => roundMoney(value, currency);
  const materials: Record<string, number> = {};
  let labor = 0;
  for (const cost of costs) {
    const lots = cost.monthly.batchesMilli / 1000;
    for (const line of cost.lines) {
      if (line.kind === "material" && line.materialId) materials[line.materialId] = (materials[line.materialId] ?? 0) + line.amountMinor * lots;
      else if (line.kind === "labor") labor += line.amountMinor * lots;
    }
  }
  const expenses: ProductionCostSplit["expenses"] = {};
  for (const expense of productionExpenses(state)) {
    const variable = round(expense.amountMinor * variableShareBps(expense) / 10000);
    expenses[expense.id] = { variable, fixed: round(expense.amountMinor - variable) };
  }
  const roundedMaterials = Object.fromEntries(Object.entries(materials).map(([id, amount]) => [id, round(amount)]));
  const roundedLabor = round(labor);
  const parts = Object.values(expenses);
  return {
    materials: roundedMaterials,
    labor: roundedLabor,
    expenses,
    variable: round(Object.values(roundedMaterials).reduce((sum, amount) => sum + amount, 0) + roundedLabor + parts.reduce((sum, part) => sum + part.variable, 0)),
    fixed: round(parts.reduce((sum, part) => sum + part.fixed, 0)),
  };
}
