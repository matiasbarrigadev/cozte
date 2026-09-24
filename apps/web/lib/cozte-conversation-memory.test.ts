import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { compactCozteConversation, compactToolOutputForHistory, COZTE_MAX_HISTORY_BYTES } from "./cozte-conversation-memory";

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

  it("keeps real tool receipts compact and drops unknown or unfinished tools", () => {
    const assistant = { id: "a1", role: "assistant", parts: [
      { type: "tool-readCosts", toolCallId: "c1", state: "output-available", input: {}, output: { ok: true, products: Array.from({ length: 50 }, (_, index) => ({ name: `P${index}` })) } },
      { type: "tool-saveExpense", toolCallId: "c2", state: "output-available", input: { name: "Gas", amount: 110000, splitBy: "hours" }, output: { ok: true, done: ["Gasto Gas creado"], costs: [{ product: "Tofu", unitCost: 900, status: "estimated", missing: [] }] } },
      { type: "tool-applyCostAction", toolCallId: "c3", state: "output-available", input: {}, output: {} },
      { type: "tool-saveProduct", toolCallId: "c4", state: "input-available", input: { name: "X" } },
      { type: "text", text: "Guardé el gas." },
    ] } as unknown as UIMessage;
    const [compact] = compactCozteConversation([assistant]);
    expect(compact.parts.map((part) => part.type)).toEqual(["tool-readCosts", "tool-saveExpense", "text"]);
    expect(JSON.stringify(compact.parts[0])).not.toContain("P49");
    expect((compact.parts[1] as unknown as { output: unknown }).output).toEqual({ ok: true, done: ["Gasto Gas creado"], costsAfter: [{ product: "Tofu", unitCost: 900, status: "estimated" }] });
    expect(compactToolOutputForHistory("saveMaterial", { ok: false, error: "Falta unidad" })).toEqual({ ok: false, error: "Falta unidad" });
  });
});
