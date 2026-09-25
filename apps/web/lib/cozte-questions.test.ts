import { describe, expect, it } from "vitest";
import { formatCozteAnswers, parseCozteQuestions } from "./cozte-questions";
import { verifyCozteResponse } from "./cozte-response-verifier";
import { turnActivity } from "./cozte-turn-activity";
import { questionsShown } from "./cozte-tool-catalog";

const input = {
  intro: "Con esto reparto bien los gastos del mes.",
  questions: [
    { question: "¿Cómo repartimos la luz?", options: ["Por horas de producción", "Por unidades producidas"] },
    { question: "¿Qué gastos tiene el taller?", options: ["Alquiler", "Gas", "Internet"], multiple: true },
    { question: "¿Cuántos lotes hacen al mes?", options: ["Menos de 10", "Entre 10 y 30"] },
  ],
};

describe("Cozte questions", () => {
  it("reads the tool input defensively", () => {
    expect(parseCozteQuestions(input)).toEqual({
      intro: input.intro,
      questions: [
        { question: "¿Cómo repartimos la luz?", options: ["Por horas de producción", "Por unidades producidas"], multiple: false },
        { question: "¿Qué gastos tiene el taller?", options: ["Alquiler", "Gas", "Internet"], multiple: true },
        { question: "¿Cuántos lotes hacen al mes?", options: ["Menos de 10", "Entre 10 y 30"], multiple: false },
      ],
    });
    expect(parseCozteQuestions({ questions: [{ question: "  " }] })).toBeNull();
    expect(parseCozteQuestions(null)).toBeNull();
  });

  it("formats choices and free text, one line per question", () => {
    const set = parseCozteQuestions(input)!;
    const text = formatCozteAnswers(set, [
      { choices: ["Por horas de producción"], other: "" },
      { choices: ["Alquiler", "Gas"], other: "  también seguridad " },
      undefined,
    ]);
    expect(text).toBe([
      "Mis respuestas:",
      "- ¿Cómo repartimos la luz? → Por horas de producción",
      "- ¿Qué gastos tiene el taller? → Alquiler; Gas; también seguridad",
      "- ¿Cuántos lotes hacen al mes? → prefiero no responder por ahora",
    ].join("\n"));
  });

  it("accepts a turn that ends with questions and no text, and keeps them out of the work trace", () => {
    const asked = [{ name: "askQuestions", ok: true, write: false, output: { ok: true, asked: 3 } }];
    expect(verifyCozteResponse("", asked).ok).toBe(true);
    expect(verifyCozteResponse("", []).issues[0].code).toBe("empty-answer");
    // Announcing the next save is fine when the turn waits for the person's answers.
    expect(verifyCozteResponse("Con tus respuestas voy a guardar los gastos.", asked).ok).toBe(true);
    expect(turnActivity([{ type: "tool-askQuestions", state: "output-available", input, output: { ok: true } }])).toEqual([]);
  });

  it("ends the turn only when the questions were really shown", () => {
    expect(questionsShown({ steps: [{ toolResults: [{ toolName: "askQuestions", output: { ok: true, asked: 2 } }] }] })).toBe(true);
    // A call without questions fails validation; the model must get the chance to fix it.
    expect(questionsShown({ steps: [{ toolResults: [{ toolName: "askQuestions", output: { ok: false, error: "Datos inválidos" } }] }] })).toBe(false);
    expect(questionsShown({ steps: [{ toolResults: [] }] })).toBe(false);
  });
});
