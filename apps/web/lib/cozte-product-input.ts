type ProductInput = Record<string, unknown>;

function toOperationalProduct(product: ProductInput): ProductInput {
  const next = { ...product };
  if (typeof product.salePrice === "number") next.salePriceMinor = product.salePrice;
  if (typeof product.salesVariablePerUnit === "number") next.salesVariableMinor = product.salesVariablePerUnit;
  if (typeof product.laborCostPerLot === "number") next.laborLotMinor = product.laborCostPerLot;
  if (typeof product.productionHoursPerLot === "number") next.productionHoursMilli = Math.round(product.productionHoursPerLot * 1000);
  delete next.salePrice;
  delete next.salesVariablePerUnit;
  delete next.laborCostPerLot;
  delete next.productionHoursPerLot;
  return next;
}

/** Converts Cozte's plain-language product fields to the cost engine's stored units. */
export function normalizeCozteProductAction(action: ProductInput): ProductInput {
  if (action.action === "create-products" && Array.isArray(action.products)) {
    return { ...action, products: action.products.map((product) => product && typeof product === "object" && !Array.isArray(product) ? toOperationalProduct(product as ProductInput) : product) };
  }
  if (["create-product", "update-product"].includes(String(action.action))) return toOperationalProduct(action);
  return action;
}
