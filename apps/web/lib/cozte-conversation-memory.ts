import type { UIMessage } from "ai";
import { COZTE_TOOL_NAMES } from "./cozte-tool-catalog";
import { answerTextIndexes, type ActivityPart } from "./cozte-turn-activity";
import { cleanLegacyWording } from "./cozte-response-verifier";

export const COZTE_MAX_HISTORY_MESSAGES = 80;
export const COZTE_MAX_HISTORY_BYTES = 90_000;

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
  for (const key of ["done", "error", "needs", "options", "pendingReview", "unchanged", "saved"] as const) if (record[key] !== undefined) kept[key] = clip(record[key], 1200);
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
  const tool = part as Extract<Part, { type: `tool-${string}` }> & { state?: string; input?: unknown; output?: unknown; toolCallId: string };
  const toolName = part.type.slice("tool-".length);
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
