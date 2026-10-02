import { moneyDecimals } from "./money";

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

export type VerificationIssue = { code: "unbacked-write-claim" | "announced-not-executed" | "unverified-figures" | "unknown-identifier" | "internal-detail" | "empty-answer" | "unfinished-answer"; detail: string };

/** Text the answer may legitimately quote numbers from besides tool results: the turn's cost snapshot and the person's message. */
export type VerificationContext = { sources?: string[] };

export type Verification = { ok: boolean; issues: VerificationIssue[]; mustUseTools: boolean };

/** Issues that make an answer untrustworthy even after a correction; the rest are worth one retry but not a discard. */
export const HARD_ISSUES: ReadonlySet<VerificationIssue["code"]> = new Set(["unbacked-write-claim", "announced-not-executed", "unknown-identifier", "empty-answer", "unfinished-answer"]);

export const hasHardIssue = (verification: Verification) => verification.issues.some((issue) => HARD_ISSUES.has(issue.code));

// Word boundaries are lookarounds on letters: \b treats accented letters such as "é" as non-word characters.

/** First-person reports of an action taken now: only a successful write in this turn backs them. */
const actionClaim = /(?<![\p{L}\p{N}])(?:guard[eé]|registr[eé]|cre[eé]|actualic[eé]|cargu[eé]|agregu[eé]|a[ñn]ad[ií]|modifiqu[eé]|apliqu[eé]|renombr[eé]|asign[eé]|vincul[eé]|conect[eé])(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:guardad|cread|aplicad)[oa]s?\s+en\s+firme(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])reporte\s+literal(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])resultado:?\s*\*{0,2}`?(?:applied|aplicado|guardado)|(?<![\p{L}\p{N}])lo\s+que\s+(?:ya\s+)?(?:te\s+)?(?:guardo|registro|anoto|cargo)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:guardo|anoto)\s+ya(?![\p{L}\p{N}])/giu;

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
    // The time mark that starts each of the person's messages is context for the model, never part of an answer.
    .replace(/^\s*\[(?:Escrito el )?[^\]\n]{0,40}\d{1,2}:\d{2}\]\s*/u, "")
    .replace(/(?<![\p{L}])(guardad[oa]s?|cread[oa]s?|aplicad[oa]s?|registrad[oa]s?|est[aá]n?|qued[oó]|quedaron)\s+en\s+firme(?![\p{L}])/giu, "$1")
    .replace(/\s+en\s+firme(?![\p{L}])/giu, "")
    .replace(/(?<![\p{L}])(productos|insumos|gastos|costos)\s+vivos(?![\p{L}])/giu, "$1");
}

/** Illustrative amounts ("por ejemplo, si pagaras ARS 5.000") are teaching, not claims about stored costs. */
const illustrative = /(?<![\p{L}])(?:por ejemplo|ejemplo|supongamos|imagin[aá]|hipot[eé]tic|digamos)(?![\p{L}])/iu;

/** Announcing an imminent action ("voy a guardar", "ahora ejecuto") and then ending the turn without doing it. */
const announcedAction = /(?<![\p{L}\p{N}])(?:(?:voy a|vamos a|procedo a|paso a|ahora mismo|ahora)\s+(?:\p{L}+\s+){0,2}?(?:guardar|registrar|crear|cargar|actualizar|ejecutar|agregar|aplicar|llamar|invocar)|(?:pruebo|ejecuto|guardo|actualizo|aplico|agrego|invoco))(?![\p{L}\p{N}])/iu;
/** A sentence that makes the action depend on the person ("si te dice un precio, me lo pasás y lo guardo") or asks. */
const conditionalSentence = /[¿?]|(?<![\p{L}\p{N}])(?:si|cuando|apenas|en cuanto|una vez que|me (?:lo |la |los |las )?(?:pas[aá]s|pasas|dec[ií]s|dices|mand[aá]s|mandas|confirm[aá]s|confirmas|avis[aá]s|avisas)|av[ií]same|dime|decime)(?![\p{L}\p{N}])/iu;

/** Whether the answer announces an action outright, outside a condition or a question. */
function announcesOutright(answer: string): boolean {
  for (const match of answer.matchAll(new RegExp(announcedAction.source, "giu"))) if (!conditionalSentence.test(sentenceAround(answer, match.index ?? 0))) return true;
  return false;
}

const waitsForPerson = /\?\s*$|(?<![\p{L}\p{N}])(?:cuando|apenas|en cuanto|si me|si confirmas|si quieres|si quer[eé]s|cuando me|m[aá]s adelante|antes de (?:guardar|seguir|cargar)|falta(?:n)? (?:definir|saber|confirmar))(?![\p{L}\p{N}])/iu;

const negatedContext = /(?:(?<![\p{L}\p{N}])(?:no|nada|ni|aún no|todavía no|nunca|sin|antes de|para|puedo|podemos|podría|voy a|vamos a|quieres que|quer[eé]s que|si|cuando)\s+|¿\s*)(?:\S+\s+){0,2}$/iu;

/** Describing that something is missing ("no hay mano de obra cargada", "no tiene precio cargado") is not a claim of a save. */
const absentContext = /(?<![\p{L}\p{N}])(?:no\s+hay|no\s+tiene|no\s+tienen|no\s+tenés|no\s+tienes|no\s+figura|no\s+figuran|no\s+aparece|no\s+aparecen)\s+(?:\S+\s+){0,4}$/iu;

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

/** Percentages an answer shows ("3,3 %", "28%"). */
const percentFigure = /(?<![\d.,])(\d{1,3}(?:[.,]\d{1,2})?)\s?%/gu;

const percentValue = (token: string) => Number(token.replace(",", "."));

/**
 * Percentages a turn can back: the ones written in its sources, results of calculate, fields that are percentages or
 * ratios in tool outputs, and percentages inside their texts. Only those, so an answer cannot pass a made-up share
 * because some unrelated number happens to match.
 */
function knownPercents(sources: string[], tools: TurnToolRecord[]): number[] {
  const values: number[] = [];
  const fromText = (text: string) => { for (const match of text.matchAll(/(-?\d{1,3}(?:[.,]\d+)?)\s?%/g)) values.push(percentValue(match[1])); };
  const walk = (value: unknown, key = ""): void => {
    if (typeof value === "number") {
      if (/percent|share|ratio|margin|rate/i.test(key)) { values.push(value); if (Math.abs(value) <= 1.5) values.push(value * 100); }
      if (/bps$/i.test(key)) values.push(value / 100);
    } else if (typeof value === "string") fromText(value);
    else if (Array.isArray(value)) for (const item of value) walk(item, key);
    else if (value && typeof value === "object") for (const [name, item] of Object.entries(value)) walk(item, name);
  };
  for (const source of sources) fromText(source);
  for (const tool of tools) {
    const result = (tool.output as { result?: unknown } | null)?.result;
    if (tool.name === "calculate" && typeof result === "number") { values.push(result); if (Math.abs(result) <= 1.5) values.push(result * 100); }
    walk(tool.output);
  }
  return values.flatMap((value) => [value, Math.abs(value)]);
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

const internalNames = /\b(?:readCosts|saveProduct|saveMaterial|saveRecipe|saveExpense|saveCategory|removeItem|saveNote|askQuestions|saveChannel|recordPurchase|recordSale|updateSale|updateDelivery|readDeliveries|setInvestmentCost|voidRecord|readBusiness|showVisual|manageBoard|setExplanationLevel|createPresentation|editPresentation|readPresentation|sharePresentation|searchConversation|setCompanyLocation|readCustomers|saveCustomer|saveDeliveryZone|readSuppliers|saveSupplier|planRoute|readBreakEven|setCostBehavior|setSalesMix|searchWebPrices|setPricePolicy|setBusinessMode|confirmRecipe|calculate|simulate|inspectCostBase|applyCostAction|updateMaterialPrice|updateExpenseAmount|updateProductionMap|upsertProductDraft|calculateCostRule|findMaterial|create-product|create-material|create-expense|set-component|bulk-prices|quantityMilli|\w+Minor|\w+Milli|toolCallId|null)\b/u;

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
    if (negatedContext.test(text.slice(Math.max(0, index - 40), index)) || absentContext.test(text.slice(Math.max(0, index - 60), index))) continue;
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
  // Any fresh read of stored data (costs, customers, deliveries, the month) backs statements about what is stored.
  const freshRead = tools.some((tool) => /^read[A-Z]/.test(tool.name) && tool.ok);
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
  if (!unbacked.length && !successfulWrites.length && !askedPerson && announcesOutright(answer) && !waitsForPerson.test(answer)) {
    issues.push({ code: "announced-not-executed", detail: "La respuesta anuncia que va a guardar o ejecutar algo, pero el turno terminó sin hacerlo." });
  }
  // An answer that ends announcing a list or questions ("contame dos cosas:") that never come leaves the person waiting.
  // What follows the colon can be on screen instead of in the text: questions, a visual, a deck, a simulation.
  const showsSomething = tools.some((tool) => tool.ok && ["askQuestions", "showVisual", "createPresentation", "editPresentation", "simulate"].includes(tool.name));
  if (!showsSomething && !issues.some((issue) => issue.code === "announced-not-executed") && endsAnnouncing(answer)) {
    issues.push({ code: "unfinished-answer", detail: "La respuesta termina anunciando algo (una frase que termina en dos puntos) que no aparece. Escribe esa lista completa o muestra esas preguntas con askQuestions." });
  } else if (emptyHeadings(answer.split("\n")).size) {
    issues.push({ code: "unfinished-answer", detail: "La respuesta tiene un título que anuncia una lista (termina en dos puntos) y no la trae. Escribe la lista o quita el título." });
  }
  const evidence = JSON.stringify(tools.map((tool) => tool.output)) ?? "";
  // Every amount and percentage shown comes from a tool of this turn or from the conversation: none is worked out by heart.
  if (context.sources) {
    const known = sourceFigures([...context.sources, evidence]);
    const quoted = (index: number) => !illustrative.test(sentenceAround(answer, index));
    const figures = [...answer.matchAll(moneyFigure)].filter((match) => quoted(match.index ?? 0))
      .map((match) => figureValue(match[1] ?? match[2] ?? "")).filter((value): value is number => value !== null && value >= 100);
    const unverified = [...new Set(figures.filter((value) => !known.has(value) && !known.has(value - 1) && !known.has(value + 1)))];
    const percents = knownPercents(context.sources, tools);
    const shares = [...answer.matchAll(percentFigure)].filter((match) => quoted(match.index ?? 0)).map((match) => match[1]).filter((token) => {
      const value = percentValue(token);
      const tolerance = /[.,]/.test(token) ? 0.15 : 1;
      return value !== 0 && value !== 100 && !percents.some((known) => Math.abs(known - value) <= tolerance);
    });
    const unbackedShares = [...new Set(shares)];
    if (unverified.length || unbackedShares.length) {
      const parts = [unverified.length ? `montos ${unverified.slice(0, 4).join(", ")}` : "", unbackedShares.length ? `porcentajes ${unbackedShares.slice(0, 4).map((token) => `${token} %`).join(", ")}` : ""].filter(Boolean);
      issues.push({ code: "unverified-figures", detail: `La respuesta muestra cifras que no salen de las herramientas ni de la conversación (${parts.join("; ")}). Toda cuenta (sumas, diferencias, totales del mes, porcentajes, qué parte del costo es cada cosa) se hace con calculate, o se toma tal cual de simulate, readCosts u otra herramienta; no hagas cuentas de cabeza.` });
    }
  }
  const unknownIds = [...new Set(answer.match(identifierPattern) ?? [])].filter((id) => !evidence.includes(id));
  if (unknownIds.length) issues.push({ code: "unknown-identifier", detail: `La respuesta muestra identificadores que no provienen de ningún resultado: ${unknownIds.slice(0, 3).join(", ")}.` });
  const leaked = answer.match(internalNames);
  if (leaked) issues.push({ code: "internal-detail", detail: `La respuesta expone detalles internos ("${leaked[0]}").` });
  return { ok: issues.length === 0, issues, mustUseTools: issues.some((issue) => issue.code === "unbacked-write-claim" || issue.code === "announced-not-executed" || issue.code === "unverified-figures") };
}

/** The last thing written promises more ("Para seguir, contame dos cosas:"), with nothing after it. */
function endsAnnouncing(answer: string): boolean {
  return /[:：]\s*$/.test(answer.replace(/[*_`>\s]+$/g, ""));
}

/** Headings that announce a list ("**Lo que voy a buscar:**") followed by a question or nothing instead of it. */
function emptyHeadings(lines: string[]): Set<number> {
  const empty = new Set<number>();
  lines.forEach((line, index) => {
    if (!/^\s*(?:\*\*|#{1,6}\s)/.test(line) || !/[:：]\s*$/.test(line.replace(/[*_`\s]+$/g, ""))) return;
    const next = lines.slice(index + 1).find((item) => item.trim());
    if (next === undefined || /^\s*[*_]*¿/.test(next) || /\?\s*[*_]*\s*$/.test(next)) empty.add(index);
  });
  return empty;
}

/** An answer's lines split into sentences (a table row stays whole), so one bad sentence can go and the rest stay. */
function answerUnits(line: string): string[] {
  if (/^\s*\|/.test(line)) return [line];
  return line.match(/.+?(?:[.!?](?=\s|$)|$)/g) ?? [line];
}

/** Drops tables left without rows and headings left without content. */
function tidyAnswer(lines: string[]): string {
  const withRows: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const separator = /^\s*\|?\s*:?-{3,}/;
    if (/^\s*\|/.test(lines[index]) && separator.test(lines[index + 1] ?? "") && !/^\s*\|/.test(lines[index + 2] ?? "")) { index += 1; continue; }
    withRows.push(lines[index]);
  }
  const heading = /^\s*#{1,6}\s/;
  const kept = withRows.filter((line, index) => {
    if (!heading.test(line)) return true;
    const next = withRows.slice(index + 1).find((item) => item.trim());
    return next !== undefined && !heading.test(next);
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The answer without the sentences (or table rows) that carry its problems: an announced action, a save it did not
 * make, a figure no tool backs, an internal name. Returns it when it passes the verifier on its own and keeps most of
 * the answer; otherwise null, and the fallback takes over.
 */
export function salvageAnswer(text: string, verification: Verification, tools: TurnToolRecord[], context: VerificationContext = {}): string | null {
  const codes = new Set<VerificationIssue["code"]>(verification.issues.map((issue) => issue.code).filter((code) => code !== "empty-answer"));
  if (!codes.size || !text.trim()) return null;
  // A promise left hanging at the end goes away whole; a line ending in a colon in the middle is followed by its list.
  let source = text;
  if (codes.delete("unfinished-answer")) {
    const lines = text.trimEnd().split("\n");
    const headings = emptyHeadings(lines);
    const kept = lines.filter((_, index) => !headings.has(index));
    while (kept.length && (kept.at(-1)!.trim() === "" || endsAnnouncing(kept.at(-1)!))) kept.pop();
    source = kept.join("\n");
    if (!codes.size) {
      const trimmed = tidyAnswer(source.split("\n"));
      return trimmed.length >= text.trim().length * 0.4 && verifyCozteResponse(trimmed, tools, context).ok ? trimmed : null;
    }
  }
  const offends = (unit: string) => unit.trim() !== "" && verifyCozteResponse(unit, tools, context).issues.some((issue) => codes.has(issue.code));
  const lines = source.split("\n").flatMap((line) => {
    if (!line.trim()) return [line];
    const kept = answerUnits(line).filter((unit) => !offends(unit)).join("").trimEnd();
    return kept.trim() ? [kept] : [];
  });
  const salvaged = tidyAnswer(lines);
  if (salvaged.length < text.trim().length * 0.4) return null;
  return verifyCozteResponse(salvaged, tools, context).ok ? salvaged : null;
}

/**
 * Index of the step whose text is the turn's answer: the last one, unless it stopped to run tools
 * (asking the person questions ends a turn; it is not work). Text written before tools is a working note.
 */
export function finalAnswerStep(steps: { toolCalls: { toolName: string }[] }[]): number {
  const last = steps.length - 1;
  if (last < 0) return -1;
  const calls = steps[last].toolCalls;
  // Showing questions ends the turn: that step's text is what the person reads, even with other tools called beside them.
  return calls.length === 0 || calls.some((call) => call.toolName === "askQuestions") ? last : -1;
}

const DISCARD_REASONS: Record<VerificationIssue["code"], string> = {
  "unbacked-write-claim": "Decía que había guardado algo que no se guardó.",
  "announced-not-executed": "Anunciaba una acción que no llegó a hacer.",
  "unverified-figures": "Mostraba cifras que no salían del cálculo.",
  "unknown-identifier": "Mostraba un código interno.",
  "internal-detail": "Usaba nombres internos del sistema.",
  "empty-answer": "Quedó sin mensaje final.",
  "unfinished-answer": "Terminaba anunciando algo que no llegó.",
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
  const results = turnResults(records);
  const attempted = records.some((item) => item.write);
  const lines = [
    done.length ? `Esto quedó guardado: ${done.join("; ")}.` : attempted || !results.length ? "No llegué a guardar cambios." : "",
    failed.length ? `No se guardó: ${[...new Set(failed)].join(" ")}` : "",
    results.length ? results.join(" ") : storedSummary(records),
    results.length ? "Si quieres, seguimos desde acá." : "Si quieres, dime qué dato registrar o revisar y sigo.",
  ];
  return lines.filter(Boolean).join(" ");
}

/**
 * What the turn's own work found (a simulation, calculations, what a chart shows), in plain words: a fallback that
 * still answers what was asked, with figures taken as the tools gave them.
 */
export function turnResults(records: TurnToolRecord[]): string[] {
  const format = (value: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(value);
  const lines: string[] = [];
  for (const item of records) {
    if (!item.ok || item.write) continue;
    const output = item.output as Record<string, unknown> | null;
    if (!output) continue;
    if (item.name === "simulate" && Array.isArray(output.products)) {
      const currency = typeof output.currency === "string" ? `${output.currency} ` : "";
      const changes = (output.products as { product?: string; unitCostBefore?: number | null; unitCostAfter?: number | null; changePercent?: number | null }[])
        .filter((product) => typeof product.unitCostBefore === "number" && typeof product.unitCostAfter === "number")
        .map((product) => `${product.product}: de ${currency}${format(product.unitCostBefore!)} a ${currency}${format(product.unitCostAfter!)} por unidad${typeof product.changePercent === "number" ? ` (${product.changePercent > 0 ? "+" : ""}${format(product.changePercent)} %)` : ""}`);
      if (changes.length) lines.push(`Con el cambio simulado: ${changes.join("; ")}. La simulación no guarda nada.`);
    }
    if (item.name === "calculate" && typeof output.result === "number" && typeof output.label === "string" && output.label.trim()) {
      lines.push(`${output.label.trim().replace(/^./, (first) => first.toUpperCase())}: ${format(output.result)}.`);
    }
    if (item.name === "showVisual" && typeof output.conclusion === "string" && output.conclusion.trim()) lines.push(output.conclusion.trim());
    if (item.name === "searchWebPrices" && Array.isArray(output.results) && output.results.length) {
      const found = (output.results as { title?: string; excerpt?: string; snippet?: string }[]).slice(0, 3)
        .map((result) => `${String(result.title ?? "").trim()}${result.excerpt && /\d/.test(result.excerpt) && result.excerpt.length <= 160 ? `: ${result.excerpt.trim()}` : ""}`).filter((line) => line.trim());
      if (found.length) lines.push(`En la web (${typeof output.query === "string" ? output.query : "búsqueda"}${typeof output.searchedAt === "string" ? `, ${output.searchedAt}` : ""}): ${found.join("; ")}.`);
    }
  }
  return lines;
}

/** What the latest read in the turn shows, so a fallback still answers "what is saved?". */
function storedSummary(records: TurnToolRecord[]): string {
  const read = [...records].reverse().find((item) => item.name === "readCosts" && item.ok && Array.isArray((item.output as Record<string, unknown> | null)?.products));
  if (!read) return "";
  const overview = read.output as { currency?: string; products: { name: string; cost?: { unitCost?: number | null; status?: string } | null }[]; materials?: unknown[]; monthlyExpenses?: { name: string; monthlyAmount: number }[]; gaps?: string[] };
  const money = (value: number) => `${overview.currency ?? ""} ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: moneyDecimals(overview.currency) }).format(value)}`.trim();
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
