import { describe, expect, it } from "vitest";
import type { ModelCallStreamPart } from "@ai-sdk/workflow";
import { createCozteVerifiedStreamTransform, verifiedCozteResponse } from "./cozte-response-verifier";

describe("Cozte write receipt verification", () => {
  it("does not let a read-only turn claim it created a product", () => {
    const answer = verifiedCozteResponse("Ya creé Tofu 500 g y guardé sus costos.", [{ toolName: "inspectCostBase", output: { products: [] } }]);
    expect(answer).toContain("Todavía no guardé ese cambio");
  });
  it("does not treat a failed tool as a successful write", () => {
    const answer = verifiedCozteResponse("Guardé Tofu 500 g.", [{ toolName: "applyCostAction", output: { error: "D1 bridge failed (500)" } }]);
    expect(answer).toContain("No pude guardar el cambio");
  });
  it("allows confirmed direct writes and honest explanations", () => {
    expect(verifiedCozteResponse("Guardé Tofu 500 g.", [{ toolName: "applyCostAction", output: { applied: true } }])).toBe("Guardé Tofu 500 g.");
    expect(verifiedCozteResponse("Necesito el precio de venta antes de crear la ficha.", [])).toBe("Necesito el precio de venta antes de crear la ficha.");
  });
  it("does not confuse a saved map draft with a new operational product", () => {
    const answer = verifiedCozteResponse("Creé la ficha del producto Tofu 500 g.", [{ toolName: "upsertProductDraft", output: { status: "building" } }]);
    expect(answer).toContain("todavía no creé una ficha");
  });
  it("streams tools but withholds unsupported prose until the turn finishes", async () => {
    const parts: ModelCallStreamPart[] = [
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", text: "Ya creé Tofu 500 g." },
      { type: "text-end", id: "answer" },
      { type: "tool-result", toolCallId: "lookup", toolName: "inspectCostBase", input: {}, output: { products: [] } },
    ];
    const stream = new ReadableStream<ModelCallStreamPart>({ start(controller) { parts.forEach((part) => controller.enqueue(part)); controller.close(); } }).pipeThrough(createCozteVerifiedStreamTransform());
    const reader = stream.getReader();
    const output: ModelCallStreamPart[] = [];
    for (;;) { const next = await reader.read(); if (next.done) break; output.push(next.value); }
    expect(output[0]).toMatchObject({ type: "tool-result", toolName: "inspectCostBase" });
    expect(output.find((part) => part.type === "text-delta")).toMatchObject({ text: expect.stringContaining("Todavía no guardé") });
  });
});
