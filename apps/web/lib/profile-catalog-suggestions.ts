import type { DomainState } from "./domain";
import type { ProductionProfile } from "./production-profile";

export type CatalogSuggestion = { key: string; label: string; details: string; action: Record<string, unknown> };

const sameName = (left: string, right: string) => left.trim().toLocaleLowerCase("es") === right.trim().toLocaleLowerCase("es");

export function profileCatalogSuggestions(profile: ProductionProfile | null, state: DomainState): { actions: CatalogSuggestion[]; missingProducts: string[]; issues: string[] } {
  if (!profile) return { actions: [], missingProducts: [], issues: [] };
  const actions: CatalogSuggestion[] = [];
  const issues: string[] = [];
  const missingProducts = profile.products.filter((item) => !state.products.some((product) => sameName(product.name, item.name))).map((item) => item.name);
  const everyProfileProductExists = missingProducts.length === 0;
  for (const input of profile.inputs) {
    const material = state.materials.find((item) => sameName(item.name, input.name));
    if (!material) {
      const price = input.pricePerPurchase ?? input.pricePerPurchaseMinor ?? undefined;
      actions.push({ key: `material:${input.name}`, label: `Agregar ${input.name}`, details: `${input.category} · por ${input.purchaseUnit}${price === undefined ? " · precio pendiente" : ` · ${price} ${input.priceCurrency ?? state.organization.currency}`}`, action: { action: "create-material", name: input.name, supplier: "", purchaseUnit: input.purchaseUnit, category: input.category, ...(price === undefined ? {} : { price }), currency: input.priceCurrency ?? state.organization.currency, source: input.evidence?.source ?? "Mapa de producción" } });
      continue;
    }
    if (input.unitsPerPurchase === null) { if (input.usage.length) issues.push(`Falta la conversión de compra para ${input.name}`); continue; }
    if (!sameName(material.purchaseUnit, input.purchaseUnit)) { issues.push(`Revisa la unidad de compra de ${input.name}: mapa ${input.purchaseUnit}, planilla ${material.purchaseUnit}`); continue; }
    for (const use of input.usage) {
      const product = state.products.find((item) => sameName(item.name, use.product));
      const profileProduct = profile.products.find((item) => sameName(item.name, use.product));
      if (!product || !profileProduct || use.quantityPerBatch === null) continue;
      if (profileProduct.goodUnitsPerBatch !== product.lotUnits) { issues.push(`Revisa el tamaño de lote de ${product.name} antes de asignar ${input.name}`); continue; }
      const exact = use.quantityPerBatch / input.unitsPerPurchase * 1000;
      const quantityMilli = Math.round(exact);
      if (!Number.isSafeInteger(quantityMilli) || quantityMilli < 0 || Math.abs(exact - quantityMilli) > 0.000001) { issues.push(`El consumo de ${input.name} en ${product.name} necesita una unidad más precisa`); continue; }
      const current = state.components.find((item) => item.productId === product.id && item.materialId === material.id)?.quantityMilli ?? 0;
      if (current !== quantityMilli) actions.push({ key: `usage:${material.id}:${product.id}`, label: `Asignar ${input.name} a ${product.name}`, details: `${quantityMilli / 1000} ${material.purchaseUnit} por lote`, action: { action: "set-component", productId: product.id, materialId: material.id, quantityMilli } });
    }
  }
  for (const cost of profile.recurringCosts) {
    if (!everyProfileProductExists) {
      issues.push(`Faltan fichas de ${missingProducts.join(", ")} para sincronizar el reparto de ${cost.name}`);
      continue;
    }
    const expense = state.expenses.find((item) => item.period === state.activePeriod && sameName(item.name, cost.name));
    const basis = cost.allocation === "production_hours" ? "hours" : cost.allocation === "finished_units" ? "units" : "manual";
    const shares = Object.fromEntries(cost.shares.flatMap((share) => { const product = state.products.find((item) => sameName(item.name, share.product)); return product ? [[product.id, Math.round(share.percent * 100)]] : []; }));
    const completeShares = basis !== "manual" || state.products.reduce((sum, product) => sum + (shares[product.id] ?? 0), 0) === 10000;
    if (!expense) {
      const original = cost.amount ?? cost.amountMinor;
      if (original === null) { issues.push(`Falta el importe de ${cost.name}`); continue; }
      if (!completeShares) { issues.push(`El reparto de ${cost.name} necesita porcentajes completos para los productos de la planilla`); continue; }
      const divisor = cost.frequency === "annual" ? 12 : cost.frequency === "quarterly" ? 3 : 1;
      const amount = Math.round(original / divisor * 1000) / 1000;
      actions.push({ key: `expense:${cost.name}`, label: `Agregar ${cost.name}`, details: `${cost.category} · ${amount} ${cost.amountCurrency ?? state.organization.currency} por mes · ${basis === "manual" ? "porcentajes" : basis === "hours" ? "horas" : "unidades"}`, action: { action: "create-expense", name: cost.name, period: state.activePeriod, amount, currency: cost.amountCurrency ?? state.organization.currency, allocationBasis: basis, shares: basis === "manual" ? shares : {}, category: cost.category, source: (cost.evidence?.source?.trim().length ?? 0) >= 2 ? cost.evidence?.source : "Mapa de producción" } });
      continue;
    }
    const changed = expense.allocationBasis !== basis || basis === "manual" && state.products.some((product) => (expense.allocationShares?.[product.id] ?? 0) !== (shares[product.id] ?? 0));
    if (changed && completeShares) actions.push({ key: `allocation:${expense.id}`, label: `Repartir ${cost.name}`, details: basis === "manual" ? "Porcentajes acordados por producto" : basis === "hours" ? "Por horas de producción" : "Por unidades del lote", action: { action: "update-expense-allocation", id: expense.id, basis, shares, acknowledgeImpact: true } });
    else if (changed) issues.push(`El reparto de ${cost.name} necesita porcentajes completos para los productos de la planilla`);
  }
  return { actions, missingProducts, issues };
}
