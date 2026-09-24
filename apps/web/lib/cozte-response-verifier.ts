/**
 * Deterministic checks on Cozte's final answer against what really happened in the turn.
 * The model is free to decide how to work; it is not free to report actions that no tool confirmed.
 */

export type TurnToolRecord = {
  name: string;
  /** The tool ran and its result did not report an error. */
  ok: boolean;
  /** The tool can change stored data. */
  write: boolean;
  output: unknown;
};

export type VerificationIssue = { code: "unbacked-write-claim" | "announced-not-executed" | "unknown-identifier" | "internal-detail" | "empty-answer"; detail: string };

export type Verification = { ok: boolean; issues: VerificationIssue[]; mustUseTools: boolean };

// Word boundaries are lookarounds on letters: \b treats accented letters such as "é" as non-word characters.

/** First-person reports of an action taken now: only a successful write in this turn backs them. */
const actionClaim = /(?<![\p{L}\p{N}])(?:guard[eé]|registr[eé]|cre[eé]|actualic[eé]|cargu[eé]|agregu[eé]|a[ñn]ad[ií]|modifiqu[eé]|apliqu[eé]|renombr[eé]|asign[eé]|vincul[eé]|conect[eé])(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:guardad|cread|aplicad)[oa]s?\s+en\s+firme(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])reporte\s+literal(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])resultado:?\s*\*{0,2}`?(?:applied|aplicado|guardado)/giu;

/** Statements about what is stored: a write or a fresh read in this turn backs them. */
const stateClaim = /(?<![\p{L}\p{N}])(?:qued[oó]|quedaron|fue|fueron|ya\s+est[aá]n?|est[aá]n?)\s+(?:correctamente\s+|bien\s+|ya\s+)?(?:guardad|registrad|cread|actualizad|cargad|aplicad|agregad|a[ñn]adid|vinculad|asignad)[oa]s?(?![\p{L}\p{N}])/giu;

/** Announcing an imminent action ("voy a guardar", "ahora ejecuto") and then ending the turn without doing it. */
const announcedAction = /(?<![\p{L}\p{N}])(?:(?:voy a|vamos a|procedo a|paso a|ahora mismo|ahora)\s+(?:\p{L}+\s+){0,2}?(?:guardar|registrar|crear|cargar|actualizar|ejecutar|agregar|aplicar|llamar|invocar)|(?:pruebo|ejecuto|guardo|actualizo|aplico|agrego|invoco))(?![\p{L}\p{N}])/iu;
const waitsForPerson = /\?\s*$|(?<![\p{L}\p{N}])(?:cuando|apenas|en cuanto|si me|si confirmas|si quieres|si quer[eé]s|cuando me)(?![\p{L}\p{N}])/iu;

const negatedContext = /(?:(?<![\p{L}\p{N}])(?:no|aún no|todavía no|nunca|sin|antes de|para|puedo|podemos|podría|voy a|vamos a|quieres que|si|cuando)|¿)\s+(?:\S+\s+){0,2}$/iu;

const identifierPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

const internalNames = /\b(?:readCosts|saveProduct|saveMaterial|saveRecipe|saveExpense|saveCategory|removeItem|saveNote|calculate|simulate|inspectCostBase|applyCostAction|updateMaterialPrice|updateExpenseAmount|updateProductionMap|upsertProductDraft|calculateCostRule|findMaterial|create-product|create-material|create-expense|set-component|bulk-prices|quantityMilli|\w+Minor|\w+Milli|toolCallId|null)\b/u;

function claims(text: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
    if (negatedContext.test(before)) continue;
    found.push(match[0]);
  }
  return found;
}

export function verifyCozteResponse(text: string, tools: TurnToolRecord[]): Verification {
  const issues: VerificationIssue[] = [];
  const answer = text.trim();
  if (!answer) {
    return { ok: false, mustUseTools: false, issues: [{ code: "empty-answer", detail: "No hubo respuesta final para la persona." }] };
  }
  const successfulWrites = tools.filter((tool) => tool.write && tool.ok);
  const freshRead = tools.some((tool) => tool.name === "readCosts" && tool.ok);
  const unbacked = [...claims(answer, actionClaim), ...(freshRead ? [] : claims(answer, stateClaim))];
  if (unbacked.length && !successfulWrites.length) {
    const failedWrites = tools.filter((tool) => tool.write && !tool.ok).length;
    issues.push({
      code: "unbacked-write-claim",
      detail: failedWrites
        ? `La respuesta afirma cambios guardados ("${unbacked.slice(0, 2).join('", "')}"), pero las escrituras de este turno fallaron.`
        : `La respuesta afirma cambios guardados ("${unbacked.slice(0, 2).join('", "')}"), pero en este turno no se ejecutó ninguna escritura.`,
    });
  }
  if (!unbacked.length && !successfulWrites.length && announcedAction.test(answer) && !waitsForPerson.test(answer)) {
    issues.push({ code: "announced-not-executed", detail: "La respuesta anuncia que va a guardar o ejecutar algo, pero el turno terminó sin hacerlo." });
  }
  const evidence = JSON.stringify(tools.map((tool) => tool.output)) ?? "";
  const unknownIds = [...new Set(answer.match(identifierPattern) ?? [])].filter((id) => !evidence.includes(id));
  if (unknownIds.length) issues.push({ code: "unknown-identifier", detail: `La respuesta muestra identificadores que no provienen de ningún resultado: ${unknownIds.slice(0, 3).join(", ")}.` });
  const leaked = answer.match(internalNames);
  if (leaked) issues.push({ code: "internal-detail", detail: `La respuesta expone detalles internos ("${leaked[0]}").` });
  return { ok: issues.length === 0, issues, mustUseTools: issues.some((issue) => issue.code === "unbacked-write-claim" || issue.code === "announced-not-executed") };
}

/** Feedback sent back to the model when the answer does not match the turn's evidence. */
export function correctionMessage(verification: Verification): string {
  const lines = verification.issues.map((issue) => `- ${issue.detail}`);
  return [
    "[Verificación automática de Cozte — no la escribió la persona]",
    "Tu respuesta anterior no se mostró porque no coincide con lo que realmente pasó en este turno:",
    ...lines,
    verification.mustUseTools
      ? "Si la persona pidió guardar algo y tienes los datos, ejecuta ahora la herramienta que corresponde y responde según su resultado. Si falta un dato, no afirmes que guardaste: pregunta solo lo indispensable."
      : "Vuelve a responder a la persona sin esos problemas.",
    "No menciones esta verificación ni nombres internos; responde directamente a la persona.",
  ].join("\n");
}
