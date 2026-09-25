/** Cozte tool names shared by the agent, the answer verifier and the chat UI. */
export const COZTE_TOOL_LABELS = {
  readCosts: "Revisar costos",
  calculate: "Calcular",
  simulate: "Simular un escenario",
  saveProduct: "Guardar producto",
  saveMaterial: "Guardar insumo",
  saveRecipe: "Guardar receta",
  saveExpense: "Guardar gasto mensual",
  saveCategory: "Guardar categoría",
  removeItem: "Pedir baja",
  saveNote: "Recordar dato",
  saveChannel: "Guardar canal de venta",
  recordPurchase: "Registrar compra",
  recordSale: "Registrar venta",
  voidRecord: "Anular registro",
  readBusiness: "Revisar el mes",
  askQuestions: "Preguntarte",
} as const;

export type CozteToolName = keyof typeof COZTE_TOOL_LABELS;

export const COZTE_TOOL_NAMES = Object.keys(COZTE_TOOL_LABELS) as CozteToolName[];

/** Tools that can change stored data; the UI refreshes and the verifier requires their receipts. */
export const COZTE_WRITE_TOOLS: ReadonlySet<string> = new Set<CozteToolName>(["saveProduct", "saveMaterial", "saveRecipe", "saveExpense", "saveCategory", "removeItem", "saveNote", "saveChannel", "recordPurchase", "recordSale", "voidRecord"]);

/** Tools whose successful result changes costs shown elsewhere in the app. */
export const COZTE_COST_WRITE_TOOLS: ReadonlySet<string> = new Set<CozteToolName>(["saveProduct", "saveMaterial", "saveRecipe", "saveExpense", "saveCategory", "removeItem", "saveChannel", "recordPurchase", "recordSale", "voidRecord"]);

export function cozteToolSucceeded(output: unknown): boolean {
  if (!output || typeof output !== "object" || Array.isArray(output)) return false;
  const record = output as Record<string, unknown>;
  return record.ok !== false && typeof record.error !== "string";
}

/**
 * Stop condition: the turn ends once questions were really shown. An invalid call (no questions) does not stop it,
 * so the model sees the error and can fix the call.
 */
export function questionsShown({ steps }: { steps: { toolResults: { toolName: string; output: unknown }[] }[] }): boolean {
  return steps.at(-1)?.toolResults.some((result) => result.toolName === "askQuestions" && cozteToolSucceeded(result.output)) ?? false;
}
