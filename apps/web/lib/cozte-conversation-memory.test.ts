import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { compactCozteConversation, COZTE_MAX_HISTORY_BYTES } from "./cozte-conversation-memory";

const turn = (index: number, content: string): UIMessage => ({ id: `turn-${index}`, role: index % 2 ? "assistant" : "user", parts: [{ type: "text", text: content }] });

describe("Cozte conversation memory", () => {
  it("retains considerably more than 20 short messages in order", () => {
    const history = compactCozteConversation(Array.from({ length: 60 }, (_, index) => turn(index, `Mensaje ${index}`)));
    expect(history).toHaveLength(60);
    expect(history[0].id).toBe("turn-0");
    expect(history.at(-1)?.id).toBe("turn-59");
  });

  it("keeps the latest contiguous context under the D1 value limit", () => {
    const history = compactCozteConversation(Array.from({ length: 60 }, (_, index) => turn(index, "á".repeat(8000))));
    expect(history.length).toBeGreaterThan(1);
    expect(history.length).toBeLessThan(60);
    expect(history.at(-1)?.id).toBe("turn-59");
    expect(new TextEncoder().encode(JSON.stringify(history)).byteLength).toBeLessThanOrEqual(COZTE_MAX_HISTORY_BYTES);
  });
});
