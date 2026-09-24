const numericKeys = new Set([
  "amount", "price", "lotUnits", "salePriceMinor", "salesVariableMinor", "laborLotMinor",
  "productionHoursMilli", "quantityMilli", "quantityPerBatch", "percent", "ratePpm", "unitsPerPurchase",
  "goodUnitsPerBatch", "startedUnitsPerBatch", "normalScrapUnitsPerBatch", "batchesPerMonth", "hoursPerBatch",
  "salePrice", "salesVariablePerUnit", "laborCostPerLot", "productionHoursPerLot",
  "pricePerPurchaseMinor", "pricePerPurchase", "amountMinor",
]);

function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const candidates = [trimmed, trimmed.match(/\{[\s\S]*\}/)?.[0], trimmed.match(/\[[\s\S]*\]/)?.[0]].filter((item): item is string => !!item);
  for (const candidate of candidates) {
    try { return JSON.parse(candidate) as unknown; } catch { /* Try the next bounded JSON shape. */ }
  }
  return value;
}

function normalizeNumbers(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeNumbers(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, key === "shares" ? normalizeNumbers(child, "amount") : normalizeNumbers(child, childKey)]));
  }
  if (typeof value !== "string") return value;
  if (numericKeys.has(key) || key === "shares") {
    const text = value.trim();
    if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return Number(text);
  }
  return value;
}

/** Deterministically fixes common malformed Cozte tool arguments without changing their meaning. */
export function repairCozteToolInput(toolName: string, rawInput: string): string | null {
  const input = parseStructuredValue(rawInput);
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  let normalized = normalizeNumbers(input) as Record<string, unknown>;
  if (toolName === "applyCostAction" || toolName === "proposeCostAction") {
    if (typeof normalized.change === "string") normalized = { ...normalized, change: parseStructuredValue(normalized.change) };
    if (!normalized.change && typeof normalized.action === "string") {
      const { action: _action, label, brief, ...changeFields } = normalized;
      normalized = {
        label: typeof label === "string" && label.trim().length >= 3 ? label : `Actualizar ${String(changeFields.name ?? changeFields.action ?? "costos")}`,
        ...(typeof brief === "string" ? { brief } : {}),
        change: { action: _action, ...changeFields },
      };
    }
    if (normalized.change && typeof normalized.change === "object" && !Array.isArray(normalized.change)) normalized = { ...normalized, change: normalizeNumbers(normalized.change) };
  }
  try { return JSON.stringify(normalized); } catch { return null; }
}
