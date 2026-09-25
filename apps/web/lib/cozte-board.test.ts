import { describe, expect, it } from "vitest";
import { parseBoard, pinWidget } from "./cozte-widgets";
import { cleanLegacyWording } from "./cozte-response-verifier";
import { summarizeQuality } from "./cozte-quality";
import { LEVEL_INSTRUCTIONS } from "./cozte-levels";

describe("board", () => {
  it("pins a visual on top and moves it instead of duplicating", () => {
    let board = pinWidget([], { kind: "unit-cost", addedBy: "user" });
    board = pinWidget(board, { kind: "cost-breakdown", productId: "tofu", addedBy: "cozte" });
    board = pinWidget(board, { kind: "unit-cost", addedBy: "cozte" });
    expect(board.map((item) => item.kind)).toEqual(["unit-cost", "cost-breakdown"]);
    expect(pinWidget(board, { kind: "cost-breakdown", productId: "otro", addedBy: "user" })).toHaveLength(3);
  });

  it("reads a stored board defensively", () => {
    expect(parseBoard('[{"id":"a","kind":"month","addedBy":"user"},{"id":"b","kind":"nope"}, 3]')).toEqual([{ id: "a", kind: "month", productId: null, addedBy: "user" }]);
    expect(parseBoard("no json")).toEqual([]);
  });
});

describe("legacy wording", () => {
  it("removes the confusing words of the first versions", () => {
    expect(cleanLegacyWording("Todo está en firme y consistente. Productos vivos (2): tofu. Insumos vivos (5).")).toBe("Todo está y consistente. Productos (2): tofu. Insumos (5).");
    expect(cleanLegacyWording("Quedaron guardados en firme")).toBe("Quedaron guardados");
    expect(cleanLegacyWording("Los precios vivos del mercado")).toBe("Los precios vivos del mercado");
  });
});

describe("quality", () => {
  it("flags only clear failures", () => {
    expect(summarizeQuality({
      answers_request: { type: "score", score: 1.9 }, explains_assumptions: { type: "boolean", probability: 0.1 },
      teaches: { type: "score", score: 0.4 }, level_fit: { type: "choice", choice: "too_technical", probabilities: { too_technical: 0.8, fits: 0.2, too_basic: 0 } }, clarity: { type: "score", score: 1.7 },
    }).flags).toEqual(["decidió sin explicar", "muy técnica para el nivel"]);
    expect(summarizeQuality({ level_fit: { type: "choice", choice: "too_basic", probabilities: { too_basic: 0.4, fits: 0.35, too_technical: 0.25 } } }).flags).toEqual([]);
  });

  it("gives each level its own depth", () => {
    expect(LEVEL_INSTRUCTIONS.simple).toMatch(/Palabras del día a día/);
    expect(LEVEL_INSTRUCTIONS.advanced).toMatch(/costeo por absorción/);
  });
});
