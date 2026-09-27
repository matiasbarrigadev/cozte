import { describe, expect, it } from "vitest";
import { cozteToolWrote } from "./cozte-tool-catalog";
import { WIDGET_KINDS, computeWidget, moveWidget, parseBoard, pinWidget, widgetFigures, widgetTitle } from "./cozte-widgets";
import { buildBusinessView } from "./business";
import { calculateCosts } from "./domain";
import { DEMO_MONTH, demoBusinessRecords, demoState } from "./demo";
import { cleanLegacyWording } from "./cozte-response-verifier";
import { actionableFlags, qualityChecks, qualityFeedback, qualityMode, summarizeQuality } from "./cozte-quality";
import { activityHeadline, discardedDraftMetadata, qualityNoteMetadata, turnActivity } from "./cozte-turn-activity";
import { LEVEL_INSTRUCTIONS } from "./cozte-levels";

describe("board", () => {
  it("pins a visual on top and moves it instead of duplicating", () => {
    let board = pinWidget([], { kind: "unit-cost", addedBy: "user" });
    board = pinWidget(board, { kind: "cost-breakdown", productId: "tofu", addedBy: "cozte" });
    board = pinWidget(board, { kind: "unit-cost", addedBy: "cozte" });
    expect(board.map((item) => item.kind)).toEqual(["unit-cost", "cost-breakdown"]);
    expect(pinWidget(board, { kind: "cost-breakdown", productId: "otro", addedBy: "user" })).toHaveLength(3);
  });

  it("keeps month, figures and title, and treats each combination as its own widget", () => {
    let board = pinWidget([], { kind: "kpis", metrics: ["revenue", "result"], addedBy: "cozte", title: "Cómo va la feria" });
    board = pinWidget(board, { kind: "kpis", metrics: ["revenue"], addedBy: "user" });
    board = pinWidget(board, { kind: "sales-by-channel", month: "2026-08", addedBy: "user" });
    expect(board).toHaveLength(3);
    board = pinWidget(board, { kind: "kpis", metrics: ["revenue", "result"], addedBy: "user" });
    expect(board[0]).toMatchObject({ kind: "kpis", title: "Cómo va la feria" });
    expect(moveWidget(board, board[0].id, 2).map((item) => item.title ?? item.kind)).toEqual(["sales-by-channel", "kpis", "Cómo va la feria"]);
    expect(widgetTitle({ kind: "sales-by-channel", month: "2026-08", addedBy: "user" })).toBe("Ventas por canal · Agosto de 2026");
    expect(widgetTitle({ kind: "cost-breakdown", productId: "t", addedBy: "user" }, "Tofu")).toBe("Costo de Tofu");
  });

  it("computes every widget live from the engine", () => {
    const sources = { state: demoState, costs: calculateCosts(demoState), analysis: null, now: "", views: { [DEMO_MONTH]: buildBusinessView(demoState, demoBusinessRecords(), DEMO_MONTH) } };
    for (const kind of WIDGET_KINDS) {
      const content = computeWidget({ kind, addedBy: "user" }, sources, DEMO_MONTH);
      expect(content.chart || content.kpis).toBeTruthy();
    }
    const month = computeWidget({ kind: "month", addedBy: "user" }, sources, DEMO_MONTH);
    expect(widgetFigures(month, "CLP").join(" ")).toMatch(/Ventas del mes/);
  });

  it("counts a widget as saved only when it was pinned", () => {
    expect(cozteToolWrote("showVisual", { ok: true, pinned: true })).toBe(true);
    expect(cozteToolWrote("showVisual", { ok: true, pinned: false })).toBe(false);
    expect(cozteToolWrote("manageBoard", { ok: true })).toBe(true);
  });

  it("reads a stored board defensively", () => {
    expect(parseBoard('[{"id":"a","kind":"month","addedBy":"user"},{"id":"b","kind":"nope"}, 3]')).toEqual([{ id: "a", kind: "month", productId: null, addedBy: "user" }]);
    expect(parseBoard("no json")).toEqual([]);
    expect(parseBoard([{ id: "old", kind: "sales", addedBy: "user" }, { id: "k", kind: "kpis", metrics: ["nope"], month: "2026-13", addedBy: "cozte" }])).toEqual([
      { id: "old", kind: "sales-by-channel", productId: null, addedBy: "user" },
      { id: "k", kind: "kpis", productId: null, metrics: ["revenue", "result", "sales-count", "break-even"], addedBy: "cozte" },
    ]);
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

describe("active quality review", () => {
  const summary = { answersRequest: 1.9, explainsAssumptions: 0.1, teaches: 1.2, levelFit: "too_technical", clarity: 1.8, flags: ["decidió sin explicar", "muy técnica para el nivel"] };
  it("rewrites only clear failures, and 'decided without explaining' only when something was saved", () => {
    expect(actionableFlags(summary, { wrote: false })).toEqual(["muy técnica para el nivel"]);
    expect(actionableFlags(summary, { wrote: true })).toEqual(["decidió sin explicar", "muy técnica para el nivel"]);
    expect(qualityFeedback(["muy técnica para el nivel"])).toMatch(/palabras simples/);
    expect(qualityFeedback(["poco clara"])).toMatch(/No menciones|ni menciones esta nota/);
    expect(qualityMode(undefined)).toBe("revise");
    expect(qualityMode("observe")).toBe("observe");
  });

  it("shows the review and the improvement in the collapsed trace", () => {
    expect(qualityChecks(summary).filter((check) => !check.ok).map((check) => check.label)).toEqual(["Explica sus supuestos", "A tu nivel"]);
    const items = turnActivity([
      { type: "reasoning", text: "Amortización lineal a 60 meses.", providerMetadata: discardedDraftMetadata("Revisión de calidad: muy técnica para el nivel") },
      { type: "reasoning", text: "Responde lo pedido ✓", providerMetadata: qualityNoteMetadata(summary, false) },
      { type: "tool-recordPurchase", toolCallId: "p", state: "output-available", output: { ok: true, done: ["Compra registrada: Laptop"] } },
      { type: "text", text: "Guardé la laptop como inversión: dura años, así que la reparto en 36 meses." },
      { type: "reasoning", text: "Responde lo pedido ✓", providerMetadata: qualityNoteMetadata({ ...summary, explainsAssumptions: 0.9, levelFit: "fits", flags: [] }, true) },
    ]);
    expect(items.map((item) => item.kind)).toEqual(["discarded", "quality", "tool", "quality"]);
    expect(activityHeadline(items)).toBe("Registró 1 compra · mejoró la respuesta");
  });
});

describe("verifier and absence", () => {
  it("does not read a description of what is missing as a claim of a save", async () => {
    const { verifyCozteResponse } = await import("./cozte-response-verifier");
    const read = [{ name: "showVisual", ok: true, write: false, output: { ok: true } }];
    expect(verifyCozteResponse("No hay mano de obra cargada al lote, por eso el costo es solo insumos y luz.", read).issues.map((issue) => issue.code)).not.toContain("unbacked-write-claim");
    expect(verifyCozteResponse("Tranquila, ya quedó cargada la receta.", read).issues.map((issue) => issue.code)).toContain("unbacked-write-claim");
  });
});
