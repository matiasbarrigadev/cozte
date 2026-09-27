import { describe, expect, it } from "vitest";
import { activityHeadline, answerTextIndexes, discardedDraftMetadata, liveStatus, qualityNoteMetadata, toolOutcomeLine, turnActivity, type ActivityPart } from "./cozte-turn-activity";

const parts: ActivityPart[] = [
  { type: "reasoning", text: "La persona dio gas y luz; los guardo como gastos mensuales repartidos por horas." },
  { type: "text", text: "Voy con eso." },
  { type: "tool-saveExpense", toolCallId: "a", state: "output-available", input: { name: "Gas" }, output: { ok: true, done: ["Gasto Gas creado: 110000 ARS al mes"] } },
  { type: "tool-saveExpense", toolCallId: "b", state: "output-available", input: { name: "Luz" }, output: { ok: true, done: ["Gasto Luz creado: 350000 ARS al mes"] } },
  { type: "tool-readCosts", toolCallId: "c", state: "output-available", input: {}, output: { ok: true, products: [{}, {}], materials: [{}], monthlyExpenses: [{}, {}, {}] } },
  { type: "text", text: "Listo." },
];

describe("turn activity", () => {
  it("lists reasoning, working notes and tools in order without the answer text", () => {
    const items = turnActivity(parts);
    expect(items.map((item) => item.kind === "tool" ? item.name : item.kind)).toEqual(["reasoning", "note", "saveExpense", "saveExpense", "readCosts"]);
    expect(items[1]).toEqual({ kind: "note", text: "Voy con eso." });
    expect(items[2]).toMatchObject({ summary: "Gasto Gas creado: 110000 ARS al mes", failed: false, running: false });
    expect(items[4]).toMatchObject({ summary: "2 productos, 1 insumos y 3 gastos del mes" });
  });

  it("treats only the text after the last working tool as the answer", () => {
    expect([...answerTextIndexes(parts)]).toEqual([5]);
    // A confusing first attempt written before the save stays in the trace; the closing message is the answer.
    const confused: ActivityPart[] = [
      { type: "text", text: "En este turno no se guardaron cambios." },
      { type: "tool-saveExpense", toolCallId: "g", state: "output-available", output: { ok: true, done: ["Gasto Nafta creado"] } },
      { type: "text", text: "Listo, nafta del generador guardada." },
    ];
    expect([...answerTextIndexes(confused)]).toEqual([2]);
    // Asking questions ends the turn: the text before the form is the answer.
    expect([...answerTextIndexes([...confused, { type: "tool-askQuestions", toolCallId: "q", state: "output-available", output: { ok: true } }])]).toEqual([2]);
    // While a reply streams, a turn that is still working has no answer yet.
    expect([...answerTextIndexes(confused.slice(0, 2), true)]).toEqual([]);
    // Older turns that ran a tool after answering keep their last text once complete.
    expect([...answerTextIndexes(confused.slice(0, 2))]).toEqual([0]);
  });

  it("keeps a discarded draft reviewable with its reason and counts the correction", () => {
    const items = turnActivity([
      { type: "reasoning", text: "Listo, guardé el gas.", providerMetadata: discardedDraftMetadata("Decía que había guardado algo que no se guardó.") },
      { type: "tool-saveExpense", toolCallId: "g", state: "output-available", output: { ok: true, done: ["Gasto Gas creado"] } },
      { type: "text", text: "Guardé el gas." },
    ]);
    expect(items[0]).toEqual({ kind: "discarded", text: "Listo, guardé el gas.", reason: "Decía que había guardado algo que no se guardó." });
    expect(activityHeadline(items)).toBe("Guardó 1 gasto · corrigió 1 borrador");
  });

  it("summarizes the turn in one line and shows what is running", () => {
    expect(activityHeadline(turnActivity(parts))).toBe("Guardó 2 gastos · revisó los costos");
    const live = turnActivity([...parts.slice(0, 2), { type: "tool-saveRecipe", toolCallId: "d", state: "input-available", input: {} }], true);
    expect(activityHeadline(live)).toBe("Guardando la receta…");
    expect(activityHeadline(turnActivity([{ type: "reasoning", text: "Pienso…" }], true))).toBe("Pensando…");
  });

  it("says a malformed tool call plainly instead of showing the raw validation error", () => {
    const raw = "AI_InvalidToolInputError: Invalid input for tool editPresentation: AI_TypeValidationError: Type validation failed: Value: {...}. Error message: data/changes/0/set/left/bullets must be array";
    expect(toolOutcomeLine("editPresentation", undefined, raw)).toEqual({ text: "No se aplicó: Cozte mandó los datos con un formato equivocado", failed: true });
  });

  it("explains failures and missing data in plain language", () => {
    expect(toolOutcomeLine("saveExpense", { ok: false, error: "Faltan datos para crear el gasto.", needs: ["importe"] })).toEqual({ text: "Falta: importe", failed: false, needsInput: true });
    expect(activityHeadline(turnActivity([{ type: "tool-saveExpense", toolCallId: "n", state: "output-available", output: { ok: false, error: "x", needs: ["importe"] } }]))).toBe("Faltó un dato");
    expect(toolOutcomeLine("calculate", { ok: true, label: "Sueldos por tanda", result: 69565.22 }).text).toBe("Sueldos por tanda: 69.565,22");
    expect(toolOutcomeLine("simulate", { ok: true, products: [{ product: "Tofu 300g", unitCostBefore: 1070, unitCostAfter: 1176 }] }).text).toBe("Sin guardar: Tofu 300g 1.070 → 1.176");
    expect(activityHeadline(turnActivity([{ type: "tool-saveProduct", toolCallId: "e", state: "output-available", output: { ok: false, error: "x" } }]))).toBe("1 paso falló");
  });

  it("hides reasoning written in another script", () => {
    expect(turnActivity([{ type: "reasoning", text: "用户想要保存" }])).toEqual([]);
  });

  it("names the phase of a running turn from the last part that arrived", () => {
    const phase = (list: ActivityPart[]) => liveStatus(list).phase;
    expect(phase([])).toBe("start");
    expect(phase([{ type: "step-start" }, { type: "reasoning", text: "Veamos" }])).toBe("thinking");
    const reading: ActivityPart[] = [{ type: "reasoning", text: "Veamos" }, { type: "tool-readCosts", toolCallId: "r", state: "input-available" }];
    expect(liveStatus(reading)).toEqual({ phase: "tool:readCosts:r", titles: ["Revisando los costos…"] });
    const read: ActivityPart[] = [...reading.slice(0, 1), { ...reading[1], state: "output-available", output: { ok: true } }];
    expect(phase(read)).toBe("analyzing");
    expect(phase([...read, { type: "reasoning", text: "Con esto alcanza" }])).toBe("analyzing");
    expect(phase([...read, { type: "text", text: "Tu costo", state: "streaming" }])).toBe("writing");
    expect(phase([...read, { type: "text", text: "Tu costo es $3.010.", state: "done" }])).toBe("reviewing");
    expect(phase([...read, { type: "reasoning", text: "x", providerMetadata: discardedDraftMetadata("Cifra sin respaldo") }])).toBe("correcting");
    expect(phase([...read, { type: "reasoning", text: "x", providerMetadata: discardedDraftMetadata("Revisión de calidad: poco clara") }])).toBe("improving");
    const summary = { overall: 0.9, flags: [] } as unknown as Parameters<typeof qualityNoteMetadata>[0];
    expect(phase([...read, { type: "reasoning", text: "ok", providerMetadata: qualityNoteMetadata(summary, false) }])).toBe("finishing");
  });
});
