import { COZTE_TOOL_LABELS } from "./cozte-tool-catalog";
import type { QualitySummary } from "./cozte-quality";

/** Minimal shape of the UI message parts this module reads (text, reasoning and tool parts). */
export type ActivityPart = { type: string; text?: string; state?: string; input?: unknown; output?: unknown; errorText?: string; toolCallId?: string; providerMetadata?: unknown };

export type ActivityItem =
  | { kind: "reasoning"; text: string; streaming: boolean }
  | { kind: "note"; text: string }
  | { kind: "discarded"; text: string; reason: string }
  | { kind: "quality"; summary: QualitySummary; revised: boolean }
  | { kind: "tool"; toolCallId: string; name: string; label: string; running: boolean; failed: boolean; needsInput: boolean; summary: string; input?: unknown; output?: unknown; errorText?: string };

const running: Record<string, string> = {
  readCosts: "Revisando los costos",
  calculate: "Calculando",
  simulate: "Simulando el escenario",
  saveProduct: "Guardando el producto",
  saveMaterial: "Guardando el insumo",
  saveRecipe: "Guardando la receta",
  saveExpense: "Guardando el gasto",
  saveCategory: "Guardando la categoría",
  removeItem: "Preparando la baja",
  saveNote: "Anotando el dato",
  saveChannel: "Guardando el canal",
  recordPurchase: "Registrando la compra",
  recordSale: "Registrando la venta",
  setInvestmentCost: "Ajustando la inversión",
  voidRecord: "Anulando el registro",
  readBusiness: "Revisando el mes",
  showVisual: "Preparando el gráfico",
  setExplanationLevel: "Guardando tu nivel",
  updateSale: "Corrigiendo la venta",
  updateDelivery: "Actualizando la entrega",
  readDeliveries: "Revisando las entregas",
  manageBoard: "Ordenando el tablero",
  createPresentation: "Armando la presentación",
  editPresentation: "Editando la presentación",
  readPresentation: "Revisando la presentación",
  sharePresentation: "Preparando el link",
  searchConversation: "Buscando en conversaciones anteriores",
  setCompanyLocation: "Guardando dónde está la empresa",
  readCustomers: "Revisando tus clientes",
  saveCustomer: "Guardando el cliente",
  saveDeliveryZone: "Guardando la zona de entrega",
  readSuppliers: "Revisando tus proveedores",
  saveSupplier: "Guardando el proveedor",
  planRoute: "Armando la ruta",
  askQuestions: "Preparando unas preguntas",
};

/** How each tool reads in a collapsed summary, singular and plural. */
const summaryVerb: Record<string, [string, string]> = {
  readCosts: ["revisó los costos", "revisó los costos"],
  calculate: ["hizo 1 cálculo", "hizo {n} cálculos"],
  simulate: ["simuló 1 escenario", "simuló {n} escenarios"],
  saveProduct: ["guardó 1 producto", "guardó {n} productos"],
  saveMaterial: ["guardó 1 insumo", "guardó {n} insumos"],
  saveRecipe: ["guardó 1 receta", "guardó {n} recetas"],
  saveExpense: ["guardó 1 gasto", "guardó {n} gastos"],
  saveCategory: ["guardó 1 categoría", "guardó {n} categorías"],
  removeItem: ["pidió 1 baja", "pidió {n} bajas"],
  saveNote: ["anotó 1 dato", "anotó {n} datos"],
  saveChannel: ["guardó 1 canal", "guardó {n} canales"],
  recordPurchase: ["registró 1 compra", "registró {n} compras"],
  recordSale: ["registró 1 venta", "registró {n} ventas"],
  setInvestmentCost: ["ajustó 1 inversión", "ajustó {n} inversiones"],
  voidRecord: ["anuló 1 registro", "anuló {n} registros"],
  readBusiness: ["revisó el mes", "revisó el mes"],
  showVisual: ["mostró 1 gráfico", "mostró {n} gráficos"],
  setExplanationLevel: ["guardó tu nivel", "guardó tu nivel"],
  updateSale: ["corrigió 1 venta", "corrigió {n} ventas"],
  updateDelivery: ["actualizó 1 entrega", "actualizó {n} entregas"],
  readDeliveries: ["revisó las entregas", "revisó las entregas"],
  manageBoard: ["ordenó el tablero", "ordenó el tablero"],
  createPresentation: ["armó 1 presentación", "armó {n} presentaciones"],
  editPresentation: ["editó la presentación", "editó la presentación {n} veces"],
  readPresentation: ["revisó la presentación", "revisó las presentaciones"],
  sharePresentation: ["compartió la presentación", "compartió {n} presentaciones"],
  searchConversation: ["buscó en conversaciones anteriores", "buscó {n} veces en conversaciones anteriores"],
  setCompanyLocation: ["guardó dónde está la empresa", "guardó dónde está la empresa"],
  readCustomers: ["revisó tus clientes", "revisó tus clientes"],
  saveCustomer: ["guardó 1 cliente", "guardó {n} clientes"],
  saveDeliveryZone: ["guardó 1 zona de entrega", "guardó {n} zonas de entrega"],
  readSuppliers: ["revisó tus proveedores", "revisó tus proveedores"],
  saveSupplier: ["guardó 1 proveedor", "guardó {n} proveedores"],
  planRoute: ["armó la ruta", "armó {n} rutas"],
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const number = (value: unknown) => typeof value === "number" ? new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(value) : String(value);

/** One plain-language line describing what a finished tool call did. */
export function toolOutcomeLine(name: string, output: unknown, errorText?: string): { text: string; failed: boolean; needsInput?: boolean } {
  // Malformed arguments are a technical slip of the model: said plainly here, the full error stays in the details.
  if (errorText && /InvalidToolInputError|Type validation failed|must NOT have|must be (?:array|object|string|number|integer|boolean)/.test(errorText)) return { text: "No se aplicó: Cozte mandó los datos con un formato equivocado", failed: true };
  if (errorText && /NoSuchToolError/.test(errorText)) return { text: "No se aplicó: Cozte pidió una herramienta que no existe", failed: true };
  if (errorText) return { text: errorText, failed: true };
  const result = record(output);
  // Missing or ambiguous data is a question for the person, not a failure.
  if (Array.isArray(result.needs) && result.needs.length) return { text: `Falta: ${result.needs.map(String).join("; ")}`, failed: false, needsInput: true };
  if (Array.isArray(result.options) && result.options.length) return { text: `Hay que elegir entre: ${result.options.map(String).join(", ")}`, failed: false, needsInput: true };
  if (typeof result.error === "string") return { text: result.error, failed: true };
  if (result.pendingReview === true) return { text: "Quedó pendiente de tu confirmación", failed: false };
  if (result.unchanged === true) return { text: "Ya estaba así; no hubo cambios", failed: false };
  if (Array.isArray(result.done) && result.done.length) return { text: result.done.map(String).join(" · "), failed: false };
  if (name === "calculate" && result.result !== undefined) return { text: `${typeof result.label === "string" && result.label ? `${result.label}: ` : ""}${number(result.result)}`, failed: false };
  if (name === "simulate" && Array.isArray(result.products)) {
    const changes = result.products.map(record).filter((item) => typeof item.unitCostAfter === "number").map((item) => `${String(item.product)} ${number(item.unitCostBefore)} → ${number(item.unitCostAfter)}`);
    return { text: `Sin guardar${changes.length ? `: ${changes.join(" · ")}` : ""}`, failed: false };
  }
  if (name === "searchConversation" && Array.isArray(result.matches)) return { text: result.matches.length ? `Encontró ${result.matches.length} mensaje${result.matches.length === 1 ? "" : "s"}` : "No encontró mensajes con eso", failed: false };
  if (name === "readSuppliers" && Array.isArray(result.suppliers)) return { text: `${result.suppliers.length} proveedor${result.suppliers.length === 1 ? "" : "es"}`, failed: false };
  if (name === "readSuppliers" && record(result.supplier).name) return { text: `Ficha de ${String(record(result.supplier).name)}`, failed: false };
  if (name === "readCustomers" && Array.isArray(result.customers)) return { text: `${result.customers.length} cliente${result.customers.length === 1 ? "" : "s"}`, failed: false };
  if (name === "readCustomers" && record(result.customer).name) return { text: `Ficha de ${String(record(result.customer).name)}`, failed: false };
  if (name === "readBusiness") {
    const count = (key: string) => Array.isArray(result[key]) ? (result[key] as unknown[]).length : 0;
    return { text: `${count("sales")} ventas y ${count("purchases")} compras en el mes`, failed: false };
  }
  if (name === "readCosts") {
    if (typeof result.product === "string") return { text: `Desglose de ${result.product}`, failed: false };
    const count = (key: string) => Array.isArray(result[key]) ? (result[key] as unknown[]).length : 0;
    return { text: `${count("products")} productos, ${count("materials")} insumos y ${count("monthlyExpenses")} gastos del mes`, failed: false };
  }
  return { text: "Listo", failed: false };
}

/** Reasoning in another script (models sometimes think in Chinese) is not shown to the person. */
const readableReasoning = (text: string) => text.trim().length > 0 && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);

/**
 * A draft answer the verifier took off the screen travels as a reasoning part with this metadata: it stays
 * reviewable in the collapsed trace and, like all reasoning, is never replayed to the model.
 */
export function discardedDraftMetadata(reason: string) {
  return { cozte: { kind: "discarded", reason } };
}

/** Jev's review of an answer travels the same way: shown in the trace, never replayed to the model. */
export function qualityNoteMetadata(summary: QualitySummary, revised: boolean) {
  return { cozte: { kind: "quality", revised, summary } };
}

function qualityNote(part: ActivityPart): { summary: QualitySummary; revised: boolean } | null {
  if (part.type !== "reasoning" || !part.providerMetadata || typeof part.providerMetadata !== "object") return null;
  const cozte = (part.providerMetadata as Record<string, unknown>).cozte as Record<string, unknown> | undefined;
  return cozte?.kind === "quality" && cozte.summary && typeof cozte.summary === "object" ? { summary: cozte.summary as QualitySummary, revised: cozte.revised === true } : null;
}

function discardedDraft(part: ActivityPart): { reason: string } | null {
  if (part.type !== "reasoning" || !part.providerMetadata || typeof part.providerMetadata !== "object") return null;
  const cozte = (part.providerMetadata as Record<string, unknown>).cozte as Record<string, unknown> | undefined;
  return cozte?.kind === "discarded" ? { reason: typeof cozte.reason === "string" ? cozte.reason : "" } : null;
}

const isWorkTool = (part: ActivityPart) => part.type.startsWith("tool-") && part.type !== "tool-askQuestions";
const hasText = (part: ActivityPart) => part.type === "text" && Boolean(part.text?.trim());

/**
 * Which text parts are the answer the person reads: the ones after the turn's last working tool call.
 * Text written before a tool is a working note and goes in the trace; asking questions ends a turn, it is not work.
 * Older turns sometimes ran a tool after answering, so once the reply is complete their last text still counts.
 */
export function answerTextIndexes(parts: ActivityPart[], streaming = false): Set<number> {
  const lastWork = parts.findLastIndex(isWorkTool);
  const after = parts.flatMap((part, index) => index > lastWork && hasText(part) ? [index] : []);
  if (streaming) return new Set(after);
  // A finished turn has one answer: the last text. Earlier texts after the last tool are notes whose tool call was not
  // stored (turns saved before failed calls were kept), and showing them all repeated the answer after a reload.
  if (after.length) return new Set([after.at(-1)!]);
  const last = parts.findLastIndex(hasText);
  return new Set(last >= 0 ? [last] : []);
}

/** Ordered work trace of an assistant message: reasoning, working notes, discarded drafts and tool calls, without the answer. */
export function turnActivity(parts: ActivityPart[], streaming = false): ActivityItem[] {
  const items: ActivityItem[] = [];
  const answer = answerTextIndexes(parts, streaming);
  parts.forEach((part, index) => {
    const quality = qualityNote(part);
    if (quality) { items.push({ kind: "quality", ...quality }); return; }
    const draft = discardedDraft(part);
    if (draft) {
      if (part.text?.trim()) items.push({ kind: "discarded", text: part.text.trim(), reason: draft.reason });
      return;
    }
    if (part.type === "text") {
      if (hasText(part) && !answer.has(index)) items.push({ kind: "note", text: part.text!.trim() });
      return;
    }
    if (part.type === "reasoning" && typeof part.text === "string" && readableReasoning(part.text)) {
      items.push({ kind: "reasoning", text: part.text.trim(), streaming: streaming && index === parts.length - 1 });
      return;
    }
    if (!part.type.startsWith("tool-")) return;
    const name = part.type.slice("tool-".length);
    // Questions are shown as their own form below the answer, not as a step of the trace.
    if (name === "askQuestions") return;
    const label = (COZTE_TOOL_LABELS as Record<string, string>)[name] ?? "Herramienta";
    const done = part.state === "output-available" || part.state === "output-error";
    const outcome = done ? toolOutcomeLine(name, part.output, part.state === "output-error" ? part.errorText ?? "No se completó" : undefined) : { text: `${running[name] ?? "Trabajando"}…`, failed: false };
    items.push({ kind: "tool", toolCallId: part.toolCallId ?? `${name}-${index}`, name, label, running: !done, failed: outcome.failed, needsInput: Boolean(outcome.needsInput), summary: outcome.text, input: part.input, output: part.output, errorText: part.errorText });
  });
  return items;
}

/** Collapsed one-line summary: what is happening now, or what the turn did. */
export function activityHeadline(items: ActivityItem[]): string {
  const active = items.findLast((item) => item.kind === "tool" && item.running);
  if (active && active.kind === "tool") return active.summary;
  const tools = items.filter((item): item is Extract<ActivityItem, { kind: "tool" }> => item.kind === "tool");
  // Drafts rewritten for quality are counted as an improvement, not as a correction.
  const drafts = items.filter((item) => item.kind === "discarded" && !item.reason.startsWith("Revisión de calidad")).length;
  const improved = items.some((item) => item.kind === "discarded" && item.reason.startsWith("Revisión de calidad"));
  if (!tools.length && !drafts && !improved) return items.some((item) => item.kind === "reasoning" && item.streaming) ? "Pensando…" : "Razonamiento";
  const counts = new Map<string, number>();
  for (const tool of tools) if (!tool.failed && !tool.needsInput) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  const phrases = [...counts].map(([name, count]) => {
    const [one, many] = summaryVerb[name] ?? ["usó 1 herramienta", "usó {n} herramientas"];
    return count === 1 ? one : many.replace("{n}", String(count));
  });
  const pending = tools.filter((tool) => tool.needsInput).length;
  if (pending) phrases.push(pending === 1 ? "faltó un dato" : `faltaron ${pending} datos`);
  const failed = tools.filter((tool) => tool.failed).length;
  if (failed) phrases.push(failed === 1 ? "1 paso falló" : `${failed} pasos fallaron`);
  if (drafts) phrases.push(drafts === 1 ? "corrigió 1 borrador" : `corrigió ${drafts} borradores`);
  if (improved) phrases.push("mejoró la respuesta");
  const text = phrases.join(" · ");
  return text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
}

/** What Cozte is doing while a turn runs: a stable phase and the titles shown for it, in rotation. */
export type LiveStatus = { phase: string; titles: string[] };

const LIVE_TITLES = {
  start: ["Leyendo tu mensaje…", "Pensando por dónde empezar…"],
  thinking: ["Pensando…", "Ordenando las ideas…"],
  analyzing: ["Analizando lo que encontró…", "Pensando el siguiente paso…"],
  writing: ["Redactando la respuesta…", "Poniéndolo en palabras claras…"],
  reviewing: ["Revisando la respuesta…", "Verificando las cifras…", "Comprobando que se entienda bien…"],
  correcting: ["Corrigiendo un detalle…", "Verificando de nuevo…"],
  improving: ["Mejorando la explicación…", "Haciéndolo más claro…"],
  finishing: ["Dando los últimos toques…"],
} satisfies Record<string, string[]>;

/**
 * The phase of a turn that is still running, read from the last part that arrived. Nothing written while the turn
 * runs is final (the verifier or the quality review can still take it back), so the screen shows these titles and
 * the answer appears only when the turn ends.
 */
export function liveStatus(parts: ActivityPart[]): LiveStatus {
  const meaningful = parts.filter((part) => part.type !== "step-start" && !((part.type === "text" || part.type === "reasoning") && !part.text?.trim()));
  const last = meaningful.at(-1);
  const status = (phase: keyof typeof LIVE_TITLES): LiveStatus => ({ phase, titles: LIVE_TITLES[phase] });
  if (!last) return status("start");
  if (qualityNote(last)) return status("finishing");
  const draft = discardedDraft(last);
  if (draft) return status(draft.reason.startsWith("Revisión de calidad") ? "improving" : "correcting");
  if (last.type.startsWith("tool-")) {
    const name = last.type.slice("tool-".length);
    const done = last.state === "output-available" || last.state === "output-error";
    return done ? status("analyzing") : { phase: `tool:${name}:${last.toolCallId ?? ""}`, titles: [`${running[name] ?? "Trabajando"}…`] };
  }
  if (last.type === "reasoning") return status(meaningful.some((part) => part.type.startsWith("tool-")) ? "analyzing" : "thinking");
  if (last.type === "text") return status(last.state === "done" ? "reviewing" : "writing");
  return status("thinking");
}
