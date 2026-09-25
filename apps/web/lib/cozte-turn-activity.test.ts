import { describe, expect, it } from "vitest";
import { activityHeadline, toolOutcomeLine, turnActivity, type ActivityPart } from "./cozte-turn-activity";

const parts: ActivityPart[] = [
  { type: "reasoning", text: "La persona dio gas y luz; los guardo como gastos mensuales repartidos por horas." },
  { type: "text", text: "Voy con eso." },
  { type: "tool-saveExpense", toolCallId: "a", state: "output-available", input: { name: "Gas" }, output: { ok: true, done: ["Gasto Gas creado: 110000 ARS al mes"] } },
  { type: "tool-saveExpense", toolCallId: "b", state: "output-available", input: { name: "Luz" }, output: { ok: true, done: ["Gasto Luz creado: 350000 ARS al mes"] } },
  { type: "tool-readCosts", toolCallId: "c", state: "output-available", input: {}, output: { ok: true, products: [{}, {}], materials: [{}], monthlyExpenses: [{}, {}, {}] } },
  { type: "text", text: "Listo." },
];

describe("turn activity", () => {
  it("lists reasoning and tools in order without the answer text", () => {
    const items = turnActivity(parts);
    expect(items.map((item) => item.kind === "tool" ? item.name : item.kind)).toEqual(["reasoning", "saveExpense", "saveExpense", "readCosts"]);
    expect(items[1]).toMatchObject({ summary: "Gasto Gas creado: 110000 ARS al mes", failed: false, running: false });
    expect(items[3]).toMatchObject({ summary: "2 productos, 1 insumos y 3 gastos del mes" });
  });

  it("summarizes the turn in one line and shows what is running", () => {
    expect(activityHeadline(turnActivity(parts))).toBe("Guardó 2 gastos · revisó los costos");
    const live = turnActivity([...parts.slice(0, 2), { type: "tool-saveRecipe", toolCallId: "d", state: "input-available", input: {} }], true);
    expect(activityHeadline(live)).toBe("Guardando la receta…");
    expect(activityHeadline(turnActivity([{ type: "reasoning", text: "Pienso…" }], true))).toBe("Pensando…");
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
});
