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

/** The subset of JSON Schema that tool input schemas use. */
export type ToolJsonSchema = {
  type?: string | string[]; properties?: Record<string, ToolJsonSchema>; items?: ToolJsonSchema | ToolJsonSchema[];
  anyOf?: ToolJsonSchema[]; oneOf?: ToolJsonSchema[]; allOf?: ToolJsonSchema[]; required?: string[];
  const?: unknown; enum?: unknown[]; $ref?: string; $defs?: Record<string, ToolJsonSchema>; definitions?: Record<string, ToolJsonSchema>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function resolve(schema: ToolJsonSchema | undefined, root: ToolJsonSchema): ToolJsonSchema | undefined {
  let current = schema;
  for (let depth = 0; current?.$ref && depth < 8; depth += 1) {
    const name = current.$ref.replace(/^#\/(?:\$defs|definitions)\//, "");
    current = root.$defs?.[name] ?? root.definitions?.[name];
  }
  return current;
}

const typesOf = (schema: ToolJsonSchema) => Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];

/** The branch of a union that fits the value: the one whose fixed fields (like `action`) match, then the first that fits its type. */
function branchFor(value: unknown, branches: ToolJsonSchema[], root: ToolJsonSchema): ToolJsonSchema | undefined {
  const resolved = branches.map((branch) => resolve(branch, root)).filter((branch): branch is ToolJsonSchema => Boolean(branch));
  if (value === null) return resolved.find((branch) => typesOf(branch).includes("null"));
  if (isRecord(value)) {
    const fixed = resolved.find((branch) => {
      const markers = Object.entries(branch.properties ?? {}).filter(([, property]) => property.const !== undefined || property.enum?.length === 1);
      return markers.length > 0 && markers.every(([key, property]) => value[key] === (property.const ?? property.enum?.[0]));
    });
    if (fixed) return fixed;
  }
  const kind = Array.isArray(value) ? "array" : isRecord(value) ? "object" : typeof value;
  return resolved.find((branch) => typesOf(branch).some((type) => type === kind || (type === "integer" && kind === "number")))
    ?? resolved.find((branch) => !typesOf(branch).includes("null"));
}

const numeric = /^-?(?:\d+\.?\d*|\.\d+)$/;

/**
 * Brings a value to the shape its schema expects, only where the meaning is unambiguous: a list wrapped in an
 * object (`{"item": [...]}`), a list sent as text or as one item, numbers and booleans sent as text.
 */
export function coerceToSchema(value: unknown, schema: ToolJsonSchema | undefined, root: ToolJsonSchema = schema ?? {}): unknown {
  const current = resolve(schema, root);
  if (!current || value === undefined) return value;
  if (current.allOf?.length) return current.allOf.reduce<unknown>((result, part) => coerceToSchema(result, part, root), value);
  const union = current.anyOf ?? current.oneOf;
  if (union?.length) {
    const branch = branchFor(value, union, root);
    return branch ? coerceToSchema(value, branch, root) : value;
  }
  const types = typesOf(current);
  if (types.includes("array")) {
    let list = value;
    if (typeof list === "string") {
      const parsed = parseStructuredValue(list);
      const itemType = !Array.isArray(current.items) ? resolve(current.items, root)?.type : undefined;
      list = Array.isArray(parsed) ? parsed : itemType === "string" ? list.split(/\r?\n+/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean) : list;
    } else if (isRecord(list)) {
      const item = !Array.isArray(current.items) ? resolve(current.items, root) : undefined;
      const itemFields = new Set([item, ...(item?.anyOf ?? item?.oneOf ?? []).map((branch) => resolve(branch, root))].flatMap((part) => Object.keys(part?.properties ?? {})));
      const record = list;
      const keys = Object.keys(record);
      const only: unknown = keys.length === 1 ? record[keys[0]] : undefined;
      if (keys.length && keys.every((key) => itemFields.has(key))) list = [record];
      // XML-style wrappers some models use for lists: {"item": [...]}, or {"item": "one"} for a list of text or numbers.
      else if (Array.isArray(only)) list = only;
      else if (only !== undefined && !isRecord(only) && !itemFields.size) list = [only];
    }
    if (Array.isArray(list)) {
      const items = current.items;
      return list.map((item, index) => coerceToSchema(item, Array.isArray(items) ? items[index] : items, root));
    }
    return value;
  }
  if (types.includes("object")) {
    const record = typeof value === "string" ? parseStructuredValue(value) : value;
    if (!isRecord(record)) return value;
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, current.properties?.[key] ? coerceToSchema(child, current.properties[key], root) : child]));
  }
  if (typeof value === "string") {
    const text = value.trim();
    if ((types.includes("number") || types.includes("integer")) && numeric.test(text)) return Number(text);
    if (types.includes("boolean") && (text === "true" || text === "false")) return text === "true";
    if (types.includes("null") && text === "null") return null;
  }
  if (typeof value === "number" && types.includes("string") && !types.includes("number")) return String(value);
  if (isRecord(value) && types.includes("string") && !types.includes("object")) {
    const label = ["label", "text", "value", "option", "title", "name"].map((key) => value[key]).find((item) => typeof item === "string" && item.trim());
    if (label !== undefined) return label;
  }
  return value;
}

/**
 * Deterministically fixes common malformed tool arguments (numbers as text, JSON sent as a string, lists wrapped
 * in objects) without changing their meaning. With the tool's schema, the fixes follow what each field expects.
 */
export function repairCozteToolInput(_toolName: string, rawInput: string, schema?: ToolJsonSchema): string | null {
  const input = parseStructuredValue(rawInput);
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  try {
    const normalized = normalize(input);
    return JSON.stringify(schema ? coerceToSchema(normalized, schema) : normalized);
  } catch { return null; }
}
