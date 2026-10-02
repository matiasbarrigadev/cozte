import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import { asSchema } from "ai";
import { z } from "zod";
import { deckOperationSchema } from "./deck-schemas";
import { repairCozteToolInput, type ToolJsonSchema } from "./cozte-tool-repair";

describe("Cozte tool argument repair", () => {
  it("converts numeric strings without changing text values", () => {
    expect(JSON.parse(repairCozteToolInput("saveMaterial", '{"material":"Bolsa","price":"58.5","currency":"ARS","priceSource":"Factura 58.5"}')!)).toEqual({ material: "Bolsa", price: 58.5, currency: "ARS", priceSource: "Factura 58.5" });
  });

  it("parses lists that arrive as serialized strings", () => {
    const repaired = repairCozteToolInput("saveRecipe", '{"product":"Tofu 300g","items":"[{\\"material\\":\\"Soja\\",\\"perUnit\\":\\"0.21\\"}]"}');
    expect(JSON.parse(repaired!)).toEqual({ product: "Tofu 300g", items: [{ material: "Soja", perUnit: 0.21 }] });
  });

  it("unwraps fenced JSON and textual nulls in numeric fields", () => {
    const repaired = repairCozteToolInput("saveProduct", '```json\n{"name":"Tofu 500g","goodUnitsPerLot":"112","salePrice":"null"}\n```');
    expect(JSON.parse(repaired!)).toEqual({ name: "Tofu 500g", goodUnitsPerLot: 112, salePrice: null });
  });

  it("declines to repair unstructured text", () => {
    expect(repairCozteToolInput("saveProduct", "no tengo datos suficientes")).toBeNull();
  });

  it("unwraps lists a model wraps in an object, guided by the tool schema", () => {
    // The exact call MiniMax repeated in a real turn: every "bullets" list arrived as {"item": [...]}.
    const editPresentation = z.object({ presentation: z.string().optional(), changes: z.array(deckOperationSchema).max(20).optional(), undo: z.boolean().optional() });
    // The agent validates tool calls with Ajv against the schema the AI SDK derives; the repair reads the same one.
    const schema = asSchema(editPresentation).jsonSchema as ToolJsonSchema;
    const valid = new Ajv().compile(schema as object);
    const raw = JSON.stringify({ presentation: "Por qué el Tofu 300g cuesta más", changes: [{ action: "update", slide: 4, set: {
      left: { title: "Remisse cargado (más bloques)", bullets: { item: ["Viaje: $92.609 de gastos fijos", "Pasajeros: 112 (Tofu 500g)", "Cada uno paga: $827 de fijos"] } },
      right: { title: "Remisse semi-vacío (menos bloques)", bullets: { item: ["Viaje: $92.609 de gastos fijos", "Pasajeros: 93 (Tofu 300g)", "Cada uno paga: $996 de fijos"] } },
    } }] });
    expect(valid(JSON.parse(raw))).toBe(false);
    const repaired = JSON.parse(repairCozteToolInput("editPresentation", raw, schema)!);
    expect(valid(repaired)).toBe(true);
    expect(repaired.changes[0].set.right.bullets).toEqual(["Viaje: $92.609 de gastos fijos", "Pasajeros: 93 (Tofu 300g)", "Cada uno paga: $996 de fijos"]);
    // A single change sent without its list, bullets as lines of text and a slide number as text.
    const loose = JSON.parse(repairCozteToolInput("editPresentation", JSON.stringify({ changes: { action: "update", slide: "3", set: { bullets: "- Uno\n- Dos" } } }), schema)!);
    expect(valid(loose)).toBe(true);
    expect(loose.changes).toEqual([{ action: "update", slide: 3, set: { bullets: ["Uno", "Dos"] } }]);
  });

  it("takes the label of an option a model sends as an object", () => {
    // MiniMax sent askQuestions options as {label, description} four times in a row in a real turn.
    const askQuestions = z.object({ questions: z.array(z.object({ question: z.string(), options: z.array(z.string()).min(2) })).min(1) });
    const schema = asSchema(askQuestions).jsonSchema as ToolJsonSchema;
    const raw = JSON.stringify({ questions: [{ question: "¿Cómo seguimos?", options: [{ label: "Propones valores", description: "Estimación" }, { label: "Los consulto yo" }] }] });
    const repaired = JSON.parse(repairCozteToolInput("askQuestions", raw, schema)!);
    expect(new Ajv().compile(schema as object)(repaired)).toBe(true);
    expect(repaired.questions[0].options).toEqual(["Propones valores", "Los consulto yo"]);
  });
});
