const numericKeys = new Set([
  "goodUnitsPerLot", "lotsPerMonth", "hoursPerLot", "directLaborPerLot", "salePrice", "salesVariablePerUnit",
  "price", "amount", "monthlyAmount", "perUnit", "perLot", "quantityPerLot", "usageUnitsPerPurchaseUnit", "percent",
  "commissionPercent", "feePerSale", "deliveryCostPerOrder", "unitsPerOrder", "priceAdjustmentPercent", "total", "quantity", "unitPrice", "deliveryCost", "usefulLifeMonths",
]);
const structuredKeys = new Set(["items", "percentages", "materialPrices", "expenseAmounts", "products", "recipe", "questions", "options"]);

function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const candidates = [trimmed, trimmed.match(/\{[\s\S]*\}/)?.[0], trimmed.match(/\[[\s\S]*\]/)?.[0]].filter((item): item is string => !!item);
  for (const candidate of candidates) {
    try { return JSON.parse(candidate) as unknown; } catch { /* Try the next bounded JSON shape. */ }
  }
  return value;
}

function normalize(value: unknown, key = ""): unknown {
  if (structuredKeys.has(key) && typeof value === "string") value = parseStructuredValue(value);
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, normalize(child, childKey)]));
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (text === "null" && numericKeys.has(key)) return null;
  if (numericKeys.has(key) && /^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return Number(text);
  return value;
}

/** Deterministically fixes common malformed tool arguments (numbers as text, JSON sent as a string) without changing their meaning. */
export function repairCozteToolInput(_toolName: string, rawInput: string): string | null {
  const input = parseStructuredValue(rawInput);
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  try { return JSON.stringify(normalize(input)); } catch { return null; }
}
