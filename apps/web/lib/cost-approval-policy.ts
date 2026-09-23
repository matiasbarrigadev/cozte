import type { DomainState } from "./domain";
import { evaluableProfileProducts, type ProductionProfile } from "./production-profile";
import type { Mutation } from "./server/mutations";

/** Human review is reserved for creating/evaluating products or changing their active cost basis. */
export function mutationNeedsHumanReview(state: DomainState, mutation: Mutation, profiles: Array<ProductionProfile | null> = []): boolean {
  const materialAffectsProduct = (materialId: string) => state.components.some((component) => component.materialId === materialId && state.products.some((product) => product.id === component.productId));
  const evaluatedNames = (profile: ProductionProfile) => new Set(evaluableProfileProducts(profile, state.organization.currency, state.fxQuotes).map((name) => name.toLocaleLowerCase()));
  const profileUsesMaterial = (materialId: string) => {
    const name = state.materials.find((material) => material.id === materialId)?.name.toLocaleLowerCase();
    if (!name) return false;
    return profiles.some((profile) => {
      if (!profile) return false;
      const evaluated = evaluatedNames(profile);
      return profile.inputs.some((input) => input.name.toLocaleLowerCase() === name && input.usage.some((usage) => evaluated.has(usage.product.toLocaleLowerCase())));
    });
  };
  const profileUsesExpense = (expenseId: string) => {
    const name = state.expenses.find((expense) => expense.id === expenseId)?.name.toLocaleLowerCase();
    return name ? profileUsesExpenseName(name) : false;
  };
  const profileUsesExpenseName = (name: string) => {
    return profiles.some((profile) => {
      if (!profile) return false;
      const evaluated = evaluatedNames(profile);
      return profile.recurringCosts.some((cost) => {
        if (cost.name.toLocaleLowerCase() !== name) return false;
        return profile.products.some((product) => {
          if (!evaluated.has(product.name.toLocaleLowerCase())) return false;
          if (cost.allocation === "manual_percentage") return (cost.shares.find((share) => share.product.toLocaleLowerCase() === product.name.toLocaleLowerCase())?.percent ?? 0) > 0;
          if (cost.allocation === "production_hours") return (product.batchesPerMonth ?? 0) * (product.hoursPerBatch ?? 0) > 0;
          return (product.batchesPerMonth ?? 0) * (product.goodUnitsPerBatch ?? 0) > 0;
        });
      });
    });
  };
  const operationalExpenseAffectsProduct = (basis: "hours" | "units" | "manual", shares: Record<string, number> | undefined) => state.products.some((product) => {
    if (basis === "hours") return product.productionHoursMilli > 0;
    if (basis === "units") return product.lotUnits > 0;
    return (shares?.[product.id] ?? 0) > 0;
  });

  switch (mutation.action) {
    case "create-product":
    case "create-products":
    case "update-product":
    case "set-component":
      return true;
    case "bulk-prices":
      return mutation.materials.some((item) => materialAffectsProduct(item.id) || profileUsesMaterial(item.id)) || mutation.expenses.some((item) => {
        const expense = state.expenses.find((row) => row.id === item.id);
        return !!expense && expense.period === state.activePeriod && (operationalExpenseAffectsProduct(expense.allocationBasis, expense.allocationShares) || profileUsesExpense(item.id));
      });
    case "update-material-meta":
      return mutation.field === "purchaseUnit" && (materialAffectsProduct(mutation.id) || profileUsesMaterial(mutation.id));
    case "create-expense":
      return mutation.amount > 0 && (operationalExpenseAffectsProduct(mutation.allocationBasis, mutation.shares) || profileUsesExpenseName(mutation.name.toLocaleLowerCase()));
    case "update-expense-meta": {
      if (mutation.field !== "period" && mutation.field !== "allocationBasis") return false;
      const expense = state.expenses.find((item) => item.id === mutation.id);
      if (!expense || expense.amountMinor <= 0 || expense.period !== state.activePeriod) return false;
      if (mutation.field === "allocationBasis") {
        const nextBasis = mutation.value === "hours" || mutation.value === "units" ? mutation.value : expense.allocationBasis;
        return operationalExpenseAffectsProduct(expense.allocationBasis, expense.allocationShares) || operationalExpenseAffectsProduct(nextBasis, expense.allocationShares) || profileUsesExpense(mutation.id);
      }
      return operationalExpenseAffectsProduct(expense.allocationBasis, expense.allocationShares) || profileUsesExpense(mutation.id);
    }
    case "update-expense-allocation": {
      const expense = state.expenses.find((item) => item.id === mutation.id);
      return !!expense && expense.amountMinor > 0 && expense.period === state.activePeriod && (operationalExpenseAffectsProduct(expense.allocationBasis, expense.allocationShares) || operationalExpenseAffectsProduct(mutation.basis, mutation.shares) || profileUsesExpense(mutation.id));
    }
    case "create-material":
    case "create-category":
    case "rename-category":
    case "record-decision":
      return false;
  }
}
