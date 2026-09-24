type ProductInput = Record<string, unknown>;

const requiredProductLabels = {
  lotUnits: "unidades vendibles por lote",
  salePrice: "precio de venta por unidad",
  salesVariablePerUnit: "gasto variable por unidad",
  laborCostPerLot: "trabajo directo por lote",
  productionHoursPerLot: "horas de producción por lote",
} as const;

/** Lists facts still needed before an operational product card can be created. */
export function missingCozteProductFields(product: ProductInput): string[] {
  return Object.entries(requiredProductLabels)
    .filter(([field]) => product[field] == null)
    .map(([, label]) => label);
}

const zeroFields = ["salePrice", "salesVariablePerUnit", "laborCostPerLot", "productionHoursPerLot"] as const;
const zeroContext: Record<(typeof zeroFields)[number], RegExp> = {
  salePrice: /precio(?:\s+de\s+venta)?/i,
  salesVariablePerUnit: /(?:gasto|costo)\s+variable|venta/i,
  laborCostPerLot: /(?:mano\s+de\s+obra|trabajo\s+directo|labor|sueldo)/i,
  productionHoursPerLot: /horas?/i,
};

/** A zero is a fact, not a placeholder: require a user quote that confirms its meaning. */
export function unconfirmedCozteProductZeroFields(product: ProductInput, userMessages: string[]): string[] {
  const evidence = product.zeroEvidence && typeof product.zeroEvidence === "object" ? product.zeroEvidence as Record<string, unknown> : {};
  return zeroFields.filter((field) => {
    if (product[field] !== 0) return false;
    const quote = evidence[field];
    if (typeof quote !== "string" || quote.length < 8 || quote.length > 160) return true;
    if (!/(?:\b0\b|\bcero\b|\bsin\b)/i.test(quote) || !zeroContext[field].test(quote)) return true;
    return !userMessages.some((message) => message.toLocaleLowerCase().includes(quote.toLocaleLowerCase()));
  }).map((field) => requiredProductLabels[field]);
}

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
