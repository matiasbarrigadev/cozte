import type { UIMessage } from "ai";
import { COZTE_TOOL_NAMES } from "./cozte-tool-catalog";
import { answerTextIndexes, type ActivityPart } from "./cozte-turn-activity";
import { cleanLegacyWording } from "./cozte-response-verifier";

export const COZTE_MAX_HISTORY_MESSAGES = 80;
export const COZTE_MAX_HISTORY_BYTES = 90_000;
/** What Cozte reads of the conversation each turn: the latest messages, within a size budget. */
export const COZTE_MODEL_HISTORY_MESSAGES = 30;
export const COZTE_MODEL_HISTORY_BYTES = 60_000;
/** Messages per page when the chat loads, and each time the person scrolls up for more. */
export const COZTE_CHAT_PAGE_SIZE = 20;
/** Largest stored message: a D1 value must stay under 100 KB. */
const MAX_MESSAGE_BYTES = 90_000;

const knownTools = new Set<string>(COZTE_TOOL_NAMES);

function clip(value: unknown, max: number): unknown {
  const text = JSON.stringify(value) ?? "";
  if (text.length <= max) return value;
  return { clipped: text.slice(0, max) };
}

/**
 * What a past tool call leaves in the conversation: enough for the model to know what really
 * happened (saved, failed, what was missing), without replaying whole snapshots.
 */
export function compactToolOutputForHistory(toolName: string, output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) return { ok: false, note: "Sin resultado registrado" };
  const record = output as Record<string, unknown>;
  if (toolName === "readCosts" || toolName === "simulate" || toolName === "readBusiness") {
    return { ok: record.ok !== false, note: toolName === "simulate" ? "Simulación sin guardar." : "Lectura del estado en ese momento; puede haber cambiado, vuelve a leer si lo necesitas.", ...(typeof record.error === "string" ? { error: record.error } : {}) };
  }
  if (toolName === "calculate") return { ok: record.ok !== false, label: record.label, expression: record.expression, result: record.result, error: record.error };
  const kept: Record<string, unknown> = { ok: record.ok !== false };
  for (const key of ["done", "error", "needs", "options", "pendingReview", "unchanged", "saved", "presentationId", "title", "publicUrl", "shows", "board"] as const) if (record[key] !== undefined) kept[key] = clip(record[key], 1200);
  const costs = Array.isArray(record.costs) ? record.costs : Array.isArray(record.impact) ? record.impact : null;
  if (costs) kept.costsAfter = costs.slice(0, 12).map((item) => {
    const cost = item as Record<string, unknown>;
    return { product: cost.product, unitCost: cost.unitCost, status: cost.status };
  });
  return kept;
}

type Part = UIMessage["parts"][number];

function compactPart(part: Part): Part | null {
  if (part.type === "text") return { type: "text", text: part.text.slice(0, 8000) };
  // Metadata marks discarded drafts, which keep a little more room so the person can read what was corrected.
  if (part.type === "reasoning") return part.text.trim() ? { type: "reasoning", text: part.text.slice(0, part.providerMetadata ? 4000 : 2000), ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}) } as Part : null;
  if (!part.type.startsWith("tool-")) return null;
  const tool = part as Extract<Part, { type: `tool-${string}` }> & { state?: string; input?: unknown; output?: unknown; errorText?: string; toolCallId: string };
  const toolName = part.type.slice("tool-".length);
  // Failed calls are kept for the trace only (the model never sees them), so their input need not match the schema.
  if (knownTools.has(toolName) && tool.state === "output-error") {
    const input = (JSON.stringify(tool.input) ?? "").length > 4000 ? {} : tool.input;
    return { type: part.type, toolCallId: tool.toolCallId, state: "output-error", input, errorText: (tool.errorText ?? "No se completó").slice(0, 1500) } as Part;
  }
  // Inputs are replayed as real tool calls and must still match the tool schema, so they are kept whole or dropped.
  if (!knownTools.has(toolName) || tool.state !== "output-available" || (JSON.stringify(tool.input) ?? "").length > 4000) return null;
  return { type: part.type, toolCallId: tool.toolCallId, state: "output-available", input: tool.input, output: compactToolOutputForHistory(toolName, tool.output) } as Part;
}

/** Keep a contiguous recent conversation, including real tool receipts, within the bridge's 100 KB SQL-value limit. */
export function compactCozteConversation(messages: UIMessage[]): UIMessage[] {
  const encoder = new TextEncoder();
  const recent: UIMessage[] = [];
  let bytes = 2; // Array brackets.
  for (const message of messages.slice(-COZTE_MAX_HISTORY_MESSAGES).reverse()) {
    const parts = message.parts.map(compactPart).filter((part): part is Part => part !== null);
    if (!parts.length) continue;
    const compact: UIMessage = { id: message.id, role: message.role, parts };
    const nextBytes = encoder.encode(JSON.stringify(compact)).byteLength + (recent.length ? 1 : 0);
    if (bytes + nextBytes > COZTE_MAX_HISTORY_BYTES) break;
    bytes += nextBytes;
    recent.unshift(compact);
  }
  return recent;
}

export const COZTE_ASSISTANT_ID_PREFIX = "cozte-v2-";
export const COZTE_FALLBACK_ID_PREFIX = "cozte-v2-fallback-";

/**
 * What the model sees of the stored conversation. Every person's message stays. Assistant text is replayed only when it
 * was produced under the verified harness: older answers contained fabricated saves and figures the model would imitate,
 * and receipt-only fallbacks are system text rather than the assistant's voice (their tool receipts are kept).
 */
export function modelHistory(messages: UIMessage[]): UIMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant") return [message];
    // Stored reasoning and discarded drafts are for the person to review; working notes written before a tool are
    // superseded by the turn's answer. Replaying either would feed stale or wrong text back to the model.
    const answer = answerTextIndexes(message.parts as ActivityPart[]);
    message = { ...message, parts: message.parts.filter((part, index) => part.type !== "reasoning" && (part.type !== "text" || answer.has(index))).map((part) => part.type === "text" ? { ...part, text: cleanLegacyWording(part.text) } : part) };
    const tools = message.parts.filter((part) => part.type.startsWith("tool-"));
    if (message.id.startsWith(COZTE_FALLBACK_ID_PREFIX)) return tools.length ? [{ ...message, parts: tools }] : [];
    // Verified turns carry the prefix; earlier verified turns are recognizable by their real tool receipts.
    if (message.id.startsWith(COZTE_ASSISTANT_ID_PREFIX) || tools.length) return [message];
    return [];
  });
}

/** When a stored message was written (ISO 8601), if known. */
export function messageCreatedAt(message: Pick<UIMessage, "metadata">): string | null {
  const value = (message.metadata as { createdAt?: unknown } | undefined)?.createdAt;
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** The same message with the time it was written. */
export function withCreatedAt(message: UIMessage, createdAt: string): UIMessage {
  return { ...message, metadata: { ...(message.metadata as Record<string, unknown> | undefined), createdAt } };
}

/** Lowercase text without accents or extra spaces, so a search for "reunion" finds "Reunión". */
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** What a stored message is found by: the person's text, or Cozte's answer (not its notes, reasoning or tools). */
export function messageSearchText(message: UIMessage): string {
  const answer = message.role === "assistant" ? answerTextIndexes(message.parts as ActivityPart[]) : null;
  const text = message.parts.flatMap((part, index) => part.type === "text" && (!answer || answer.has(index)) ? [part.text] : []).join(" ");
  return normalizeSearch(text).slice(0, 6_000);
}

/** A message as it is stored: compact parts, within the size of one database value. Null when nothing is left. */
export function storableMessage(message: UIMessage): UIMessage | null {
  const encoder = new TextEncoder();
  let parts = message.parts.map(compactPart).filter((part): part is Part => part !== null);
  if (encoder.encode(JSON.stringify(parts)).byteLength > MAX_MESSAGE_BYTES) parts = parts.filter((part) => part.type === "text" || part.type === "reasoning");
  if (encoder.encode(JSON.stringify(parts)).byteLength > MAX_MESSAGE_BYTES) parts = parts.filter((part) => part.type === "text").map((part) => ({ ...part, text: (part as { text: string }).text.slice(0, 20_000) }) as Part);
  return parts.length ? { id: message.id, role: message.role, parts, ...(message.metadata ? { metadata: message.metadata } : {}) } : null;
}

/** The latest messages Cozte reads each turn, within the message and size budget, starting at a message of the person. */
export function modelWindow(messages: UIMessage[]): UIMessage[] {
  const encoder = new TextEncoder();
  const window: UIMessage[] = [];
  let bytes = 0;
  for (const message of messages.slice(-COZTE_MODEL_HISTORY_MESSAGES).reverse()) {
    const size = encoder.encode(JSON.stringify(message.parts)).byteLength;
    if (window.length && bytes + size > COZTE_MODEL_HISTORY_BYTES) break;
    bytes += size;
    window.unshift(message);
  }
  while (window.length > 1 && window[0].role !== "user") window.shift();
  return window;
}

/** "sáb 27/09/2026 10:32" in the business's timezone. */
export function messageTimeLabel(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("es-AR", { timeZone, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(date).replace(",", "");
  const time = new Intl.DateTimeFormat("es-AR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return `${day} ${time}`;
}

/**
 * Each message of the person starts, for the model only, with when it was written, so "mañana" in yesterday's
 * message reads as today. Cozte's own messages are left as they are, so it does not start imitating the mark.
 */
export function withMessageTimes(messages: UIMessage[], timeZone: string): UIMessage[] {
  return messages.map((message) => {
    const createdAt = messageCreatedAt(message);
    if (message.role !== "user" || !createdAt) return message;
    return { ...message, parts: [{ type: "text", text: `[Escrito el ${messageTimeLabel(createdAt, timeZone)}]` } as Part, ...message.parts] };
  });
}
