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

export type VerificationIssue = { code: "unbacked-write-claim" | "announced-not-executed" | "unverified-figures" | "unknown-identifier" | "internal-detail" | "empty-answer"; detail: string };

/** Text the answer may legitimately quote numbers from besides tool results: the turn's cost snapshot and the person's message. */
export type VerificationContext = { sources?: string[] };

export type Verification = { ok: boolean; issues: VerificationIssue[]; mustUseTools: boolean };

/** Issues that make an answer untrustworthy even after a correction; the rest are worth one retry but not a discard. */
export const HARD_ISSUES: ReadonlySet<VerificationIssue["code"]> = new Set(["unbacked-write-claim", "announced-not-executed", "unknown-identifier", "empty-answer"]);

export const hasHardIssue = (verification: Verification) => verification.issues.some((issue) => HARD_ISSUES.has(issue.code));

// Word boundaries are lookarounds on letters: \b treats accented letters such as "é" as non-word characters.

/** First-person reports of an action taken now: only a successful write in this turn backs them. */
const actionClaim = /(?<![\p{L}\p{N}])(?:guard[eé]|registr[eé]|cre[eé]|actualic[eé]|cargu[eé]|agregu[eé]|a[ñn]ad[ií]|modifiqu[eé]|apliqu[eé]|renombr[eé]|asign[eé]|vincul[eé]|conect[eé])(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:guardad|cread|aplicad)[oa]s?\s+en\s+firme(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])reporte\s+literal(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])resultado:?\s*\*{0,2}`?(?:applied|aplicado|guardado)/giu;

/**
 * Statements about what is stored: a write or a fresh read in this turn backs them.
 * Covers "quedaron guardados", "Gas y luz cargados", "quedaron las dos recetas" and openers like "Listo,".
 * Any affirmative storage participle counts: in a turn with no write and no read it has nothing behind it.
 */
const stateClaim = new RegExp([
  /(?<![\p{L}\p{N}])(?:qued[oó]|quedaron|ya\s+est[aá]n?|est[aá]n?)\s+(?:correctamente\s+|bien\s+|ya\s+)?complet[oa]s?(?![\p{L}\p{N}])/u.source,
  /(?<![\p{L}\p{N}])(?:qued[oó]|quedaron)\s+as[ií](?![\p{L}\p{N}])/u.source,
  /(?<![\p{L}\p{N}])(?:guardad|registrad|cread|actualizad|cargad|aplicad|agregad|a[ñn]adid|anotad|sumad|incluid)[oa]s?(?![\p{L}\p{N}])/u.source,
  /(?<![\p{L}\p{N}])(?:qued[oó]|quedaron|ya\s+qued[oó]|ya\s+quedaron|ya\s+tengo|ya\s+tenemos)\s+(?:(?:el|la|los|las|tu|tus|su|sus|dos|tres|cuatro|cinco|ambos|ambas|todos|todas|esos|esas|ese|esa)\s+){0,2}(?:recetas?|productos?|insumos?|gastos?|precios?|notas?|categor[ií]as?|sueldos?)(?![\p{L}\p{N}])/u.source,
].join("|"), "giu");

/** "Listo," / "Hecho." openers: only suspicious when the turn used no tool at all ("Listo, simulado sin guardar" is fine). */
const openerClaim = /^\s*¡?\s*(?:listo|hecho|ya\s+est[aá])(?![\p{L}\p{N}])/giu;

/** Model artifacts in another script (e.g. a stray Chinese or Japanese word): removed rather than worth a retry. */
export function stripForeignScript(text: string): string {
  return text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu, "").replace(/[ \t]{2,}/g, " ");
}

/**
 * Wording from Cozte's first versions ("en firme", "productos vivos") that confused people. Old conversations
 * still carry it and the model imitates it, so it is removed on screen, in storage and in the model's history.
 */
export function cleanLegacyWording(text: string): string {
  return text
    .replace(/(?<![\p{L}])(guardad[oa]s?|cread[oa]s?|aplicad[oa]s?|registrad[oa]s?|est[aá]n?|qued[oó]|quedaron)\s+en\s+firme(?![\p{L}])/giu, "$1")
    .replace(/\s+en\s+firme(?![\p{L}])/giu, "")
    .replace(/(?<![\p{L}])(productos|insumos|gastos|costos)\s+vivos(?![\p{L}])/giu, "$1");
}

/** Illustrative amounts ("por ejemplo, si pagaras ARS 5.000") are teaching, not claims about stored costs. */
const illustrative = /(?<![\p{L}])(?:por ejemplo|ejemplo|supongamos|imagin[aá]|hipot[eé]tic|digamos)(?![\p{L}])/iu;

/** Announcing an imminent action ("voy a guardar", "ahora ejecuto") and then ending the turn without doing it. */
const announcedAction = /(?<![\p{L}\p{N}])(?:(?:voy a|vamos a|procedo a|paso a|ahora mismo|ahora)\s+(?:\p{L}+\s+){0,2}?(?:guardar|registrar|crear|cargar|actualizar|ejecutar|agregar|aplicar|llamar|invocar)|(?:pruebo|ejecuto|guardo|actualizo|aplico|agrego|invoco))(?![\p{L}\p{N}])/iu;
const waitsForPerson = /\?\s*$|(?<![\p{L}\p{N}])(?:cuando|apenas|en cuanto|si me|si confirmas|si quieres|si quer[eé]s|cuando me|m[aá]s adelante|antes de (?:guardar|seguir|cargar)|falta(?:n)? (?:definir|saber|confirmar))(?![\p{L}\p{N}])/iu;

const negatedContext = /(?:(?<![\p{L}\p{N}])(?:no|nada|ni|aún no|todavía no|nunca|sin|antes de|para|puedo|podemos|podría|voy a|vamos a|quieres que|quer[eé]s que|si|cuando)\s+|¿\s*)(?:\S+\s+){0,2}$/iu;

/** Money figures: a number next to "$" or a currency code, in either order. */
const moneyFigure = /(?:\$|(?<!\p{L})(?:ARS|CLP|USD|EUR|BRL|MXN|COP|PEN|UYU|PYG|BOB|CRC|DOP|GTQ|HNL|NIO|PAB|BZD)(?!\p{L}))\s*(\d[\d.,]*)|(\d[\d.,]*)\s*(?:\$|(?<!\p{L})(?:ARS|CLP|USD|EUR|BRL|MXN|COP|PEN|UYU|PYG|BOB|CRC|DOP|GTQ|HNL|NIO|PAB|BZD)(?!\p{L}))/gu;

/** Integer value of a figure written with Spanish or English separators ("1.070", "1,070", "1.070,50", "271.14"). */
function figureValue(token: string): number | null {
  const cleaned = token.replace(/[.,]+$/, "");
  const integer = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(/,\d{1,2}$/, "").replace(/[.,]/g, "")
    : /\.\d{1,2}$/.test(cleaned) && !/\.\d{3}/.test(cleaned) ? cleaned.replace(/\.\d{1,2}$/, "").replace(/,/g, "")
    : cleaned.replace(/[.,]/g, "");
  const value = Number(integer);
  return integer && Number.isFinite(value) ? value : null;
}

/** Every integer a source text could be quoting, under both separator conventions and JSON decimals. */
function sourceFigures(texts: string[]): Set<number> {
  const figures = new Set<number>();
  for (const text of texts) for (const [token] of text.matchAll(/\d[\d.,]*/g)) {
    const spanish = figureValue(token);
    if (spanish !== null) figures.add(spanish);
    const plain = /^\d+(?:\.\d+)?/.exec(token)?.[0];
    if (plain) { figures.add(Math.floor(Number(plain))); figures.add(Math.round(Number(plain))); }
  }
  return figures;
}

const identifierPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

const internalNames = /\b(?:readCosts|saveProduct|saveMaterial|saveRecipe|saveExpense|saveCategory|removeItem|saveNote|askQuestions|saveChannel|recordPurchase|recordSale|setInvestmentCost|voidRecord|readBusiness|showVisual|manageBoard|setExplanationLevel|createPresentation|editPresentation|readPresentation|sharePresentation|calculate|simulate|inspectCostBase|applyCostAction|updateMaterialPrice|updateExpenseAmount|updateProductionMap|upsertProductDraft|calculateCostRule|findMaterial|create-product|create-material|create-expense|set-component|bulk-prices|quantityMilli|\w+Minor|\w+Milli|toolCallId|null)\b/u;

/** Sentence markers for actions from earlier turns ("antes guardé…"), which a fresh read can confirm. */
const earlierTurn = /(?<![\p{L}\p{N}])(?:antes|anteriormente|previamente|hace un rato|ayer|la vez pasada|en (?:esta|la) (?:charla|conversación)|en (?:el|los) mensajes? anteriores?|más temprano)(?![\p{L}\p{N}])/iu;

const sentenceMarks = [".", "\n", "!", "?"];

function sentenceAround(text: string, index: number): string {
  const start = Math.max(...sentenceMarks.map((mark) => text.lastIndexOf(mark, index))) + 1;
  const ends = sentenceMarks.map((mark) => text.indexOf(mark, index)).filter((position) => position >= 0);
  return text.slice(start, ends.length ? Math.min(...ends) : text.length);
}

function claims(text: string, pattern: RegExp, allowEarlierTurns = false): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (negatedContext.test(text.slice(Math.max(0, index - 40), index))) continue;
    if (allowEarlierTurns && earlierTurn.test(sentenceAround(text, index))) continue;
    found.push(match[0]);
  }
  return found;
}

export function verifyCozteResponse(text: string, tools: TurnToolRecord[], context: VerificationContext = {}): Verification {
  const issues: VerificationIssue[] = [];
  const answer = text.trim();
  // Questions shown on screen are a complete turn: the person answers them next.
  const askedPerson = tools.some((tool) => tool.name === "askQuestions" && tool.ok);
  if (!answer) {
    return askedPerson ? { ok: true, mustUseTools: false, issues: [] } : { ok: false, mustUseTools: false, issues: [{ code: "empty-answer", detail: "No hubo respuesta final para la persona." }] };
  }
  const successfulWrites = tools.filter((tool) => tool.write && tool.ok);
  const freshRead = tools.some((tool) => tool.name === "readCosts" && tool.ok);
  const unbacked = [...claims(answer, actionClaim, freshRead), ...(freshRead ? [] : claims(answer, stateClaim)), ...(tools.length ? [] : claims(answer, openerClaim))];
  if (unbacked.length && !successfulWrites.length) {
    const failedWrites = tools.filter((tool) => tool.write && !tool.ok).length;
    issues.push({
      code: "unbacked-write-claim",
      detail: failedWrites
        ? `La respuesta afirma cambios guardados ("${unbacked.slice(0, 2).join('", "')}"), pero las escrituras de este turno fallaron.`
        : `La respuesta afirma cambios guardados ("${unbacked.slice(0, 2).join('", "')}"), pero en este turno no se ejecutó ninguna escritura.`,
    });
  }
  if (!unbacked.length && !successfulWrites.length && !askedPerson && announcedAction.test(answer) && !waitsForPerson.test(answer)) {
    issues.push({ code: "announced-not-executed", detail: "La respuesta anuncia que va a guardar o ejecutar algo, pero el turno terminó sin hacerlo." });
  }
  const evidence = JSON.stringify(tools.map((tool) => tool.output)) ?? "";
  // A turn that used no tool can only quote money figures already in its snapshot or the person's message.
  if (!tools.length && context.sources) {
    const known = sourceFigures([...context.sources, evidence]);
    const figures = [...answer.matchAll(moneyFigure)]
      .filter((match) => !illustrative.test(sentenceAround(answer, match.index ?? 0)))
      .map((match) => figureValue(match[1] ?? match[2] ?? "")).filter((value): value is number => value !== null && value >= 100);
    const unverified = [...new Set(figures.filter((value) => !known.has(value) && !known.has(value - 1) && !known.has(value + 1)))];
    if (unverified.length) issues.push({ code: "unverified-figures", detail: `La respuesta muestra montos que no salen del motor ni de lo que dijo la persona (${unverified.slice(0, 4).join(", ")}). Obtén esas cifras con simulate, calculate o readCosts antes de mostrarlas.` });
  }
  const unknownIds = [...new Set(answer.match(identifierPattern) ?? [])].filter((id) => !evidence.includes(id));
  if (unknownIds.length) issues.push({ code: "unknown-identifier", detail: `La respuesta muestra identificadores que no provienen de ningún resultado: ${unknownIds.slice(0, 3).join(", ")}.` });
  const leaked = answer.match(internalNames);
  if (leaked) issues.push({ code: "internal-detail", detail: `La respuesta expone detalles internos ("${leaked[0]}").` });
  return { ok: issues.length === 0, issues, mustUseTools: issues.some((issue) => issue.code === "unbacked-write-claim" || issue.code === "announced-not-executed" || issue.code === "unverified-figures") };
}

/**
 * Index of the step whose text is the turn's answer: the last one, unless it stopped to run tools
 * (asking the person questions ends a turn; it is not work). Text written before tools is a working note.
 */
export function finalAnswerStep(steps: { toolCalls: { toolName: string }[] }[]): number {
  const last = steps.length - 1;
  return last >= 0 && steps[last].toolCalls.every((call) => call.toolName === "askQuestions") ? last : -1;
}

const DISCARD_REASONS: Record<VerificationIssue["code"], string> = {
  "unbacked-write-claim": "Decía que había guardado algo que no se guardó.",
  "announced-not-executed": "Anunciaba una acción que no llegó a hacer.",
  "unverified-figures": "Mostraba montos que no salían del cálculo.",
  "unknown-identifier": "Mostraba un código interno.",
  "internal-detail": "Usaba nombres internos del sistema.",
  "empty-answer": "Quedó sin mensaje final.",
};

/** Plain-language reason shown next to a discarded draft in the collapsed work trace. */
export function discardReason(verification: Verification): string {
  const issue = verification.issues.find((item) => HARD_ISSUES.has(item.code)) ?? verification.issues[0];
  return issue ? DISCARD_REASONS[issue.code] : "No coincidía con lo que pasó.";
}

const INTERNAL_NOTE = "[Nota interna de Cozte: la persona no la ve y no debes mencionarla]";

/** Feedback sent back to the model when the answer does not match the turn's evidence, or is missing. */
export function correctionMessage(verification: Verification): string {
  if (verification.issues.length && verification.issues.every((issue) => issue.code === "empty-answer")) {
    return [
      INTERNAL_NOTE,
      "Terminaste de trabajar sin escribir el mensaje final. Escríbelo ahora, breve y completo: qué hiciste según los resultados de las herramientas, cómo queda el costo y cuál es el próximo paso. Usa herramientas solo si falta algo imprescindible.",
    ].join("\n");
  }
  return [
    INTERNAL_NOTE,
    "Tu borrador no se mostró porque no coincide con lo que pasó:",
    ...verification.issues.map((issue) => `- ${issue.detail}`),
    verification.mustUseTools
      ? "Si la persona pidió guardar algo y tienes los datos, ejecuta ahora la herramienta que corresponde y responde según su resultado. Si pregunta qué quedó guardado, lee primero el estado actual y responde con esa lectura. Si falta un dato, pregúntalo sin afirmar que guardaste."
      : "Vuelve a escribir la respuesta sin esos problemas.",
    "Lo que escribas al terminar es el mensaje final que verá la persona: escríbelo completo, como si fuera tu primera respuesta, y conserva lo que tu borrador explicaba bien. No menciones esta nota, ni borradores, ni lo que pasó \"en este turno\"; no te disculpes ni digas que tiene razón, y no uses nombres internos.",
  ].join("\n");
}

/** Deterministic fallback when the model cannot produce an answer consistent with its receipts. */
export function receiptOnlyAnswer(records: TurnToolRecord[]): string {
  const done = records.filter((item) => item.write && item.ok).flatMap((item) => {
    const output = item.output as Record<string, unknown>;
    return Array.isArray(output.done) ? output.done.map(String) : [];
  });
  const failed = records.filter((item) => item.write && !item.ok).map((item) => {
    const output = item.output as Record<string, unknown> | null;
    return typeof output?.error === "string" ? output.error : "Un cambio no se pudo guardar.";
  });
  const lines = [
    done.length ? `Esto quedó guardado: ${done.join("; ")}.` : "No llegué a guardar cambios.",
    failed.length ? `No se guardó: ${[...new Set(failed)].join(" ")}` : "",
    storedSummary(records),
    "Si quieres, dime qué dato registrar o revisar y sigo.",
  ];
  return lines.filter(Boolean).join(" ");
}

/** What the latest read in the turn shows, so a fallback still answers "what is saved?". */
function storedSummary(records: TurnToolRecord[]): string {
  const read = [...records].reverse().find((item) => item.name === "readCosts" && item.ok && Array.isArray((item.output as Record<string, unknown> | null)?.products));
  if (!read) return "";
  const overview = read.output as { currency?: string; products: { name: string; cost?: { unitCost?: number | null; status?: string } | null }[]; materials?: unknown[]; monthlyExpenses?: { name: string; monthlyAmount: number }[]; gaps?: string[] };
  const money = (value: number) => `${overview.currency ?? ""} ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(value)}`.trim();
  const status = { complete: "completo", estimated: "estimado", incomplete: "incompleto" } as Record<string, string>;
  const products = overview.products.map((item) => item.cost?.unitCost != null ? `${item.name} (${money(item.cost.unitCost)} por unidad, ${status[item.cost.status ?? ""] ?? "sin estado"})` : `${item.name} (costo incompleto)`);
  const expenses = (overview.monthlyExpenses ?? []).map((item) => `${item.name} (${money(item.monthlyAmount)} al mes)`);
  return [
    "Según la base, ahora mismo:",
    products.length ? `productos ${products.join(", ")};` : "no hay productos;",
    `${overview.materials?.length ?? 0} insumos;`,
    expenses.length ? `gastos mensuales ${expenses.join(", ")}.` : "no hay gastos mensuales.",
    overview.gaps?.length ? `Para afinar el costo convendría sumar: ${overview.gaps.slice(0, 4).join("; ")}.` : "",
  ].filter(Boolean).join(" ");
}
