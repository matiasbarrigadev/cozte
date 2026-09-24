import type { UIMessage } from "ai";

export const COZTE_MAX_HISTORY_MESSAGES = 80;
export const COZTE_MAX_HISTORY_BYTES = 90_000;

/** Keep a contiguous recent conversation within the bridge's 100 KB SQL-value limit. */
export function compactCozteConversation(messages: UIMessage[]): UIMessage[] {
  const encoder = new TextEncoder();
  const recent: UIMessage[] = [];
  let bytes = 2; // Array brackets.
  for (const message of messages.slice(-COZTE_MAX_HISTORY_MESSAGES).reverse()) {
    const parts = message.parts.filter((part) => part.type === "text")
      .map((part) => ({ type: "text" as const, text: part.text.slice(0, 8000) }));
    if (!parts.length) continue;
    const compact: UIMessage = { id: message.id, role: message.role, parts };
    const nextBytes = encoder.encode(JSON.stringify(compact)).byteLength + (recent.length ? 1 : 0);
    if (bytes + nextBytes > COZTE_MAX_HISTORY_BYTES) break;
    bytes += nextBytes;
    recent.unshift(compact);
  }
  return recent;
}
