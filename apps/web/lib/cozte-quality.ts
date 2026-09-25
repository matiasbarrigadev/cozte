import type { ExplanationLevel } from "./cozte-levels";

/**
 * Quality rubric for a finished Cozte turn, evaluated by TypeSafe Jev through the AI Gateway (structured,
 * calibrated answers). It judges what rules cannot (clarity, teaching, level fit, explained assumptions);
 * truth about saves, figures and ids stays with the deterministic verifier.
 */
export const QUALITY_QUESTIONS = {
  answers_request: {
    type: "score",
    instructions: "¿La respuesta final de Cozte responde lo que la persona pidió en su mensaje?",
    criteria: ["No responde lo que pidió", "Responde en parte", "Responde completo"],
  },
  explains_assumptions: {
    type: "boolean",
    instructions: "Si Cozte tomó una decisión o supuesto en nombre de la persona (vida útil, forma de reparto, área, cantidad, precio), ¿explica por qué y cómo cambiarlo? Si no tomó ninguna decisión por su cuenta, responde verdadero.",
    criteria: { true: "Explica sus supuestos, o no tomó ninguno", false: "Decidió algo sin explicar por qué" },
  },
  teaches: {
    type: "score",
    instructions: "¿Cuánto ayuda la respuesta a entender las finanzas del negocio, más allá de informar datos?",
    criteria: ["Solo informa datos", "Explica algo del porqué", "Enseña una idea útil con los números del negocio"],
  },
  level_fit: {
    type: "choice",
    instructions: "Según el nivel de explicación que eligió la persona (indicado en el estado), ¿el vocabulario y la profundidad de la respuesta son adecuados?",
    criteria: { too_technical: "Demasiado técnica o con jerga sin explicar para su nivel", fits: "Adecuada a su nivel", too_basic: "Demasiado básica o larga para su nivel" },
  },
  clarity: {
    type: "score",
    instructions: "¿Qué tan clara y fácil de leer es la respuesta final?",
    criteria: ["Confusa o desordenada", "Se entiende con esfuerzo", "Clara y fácil de leer"],
  },
} as const;

export type QualityAnswers = Record<string, { type: string; probability?: number; choice?: string; score?: number; probabilities?: Record<string, number> }>;

export function qualityState(input: { level: ExplanationLevel; userMessage: string; actions: string[]; answer: string }) {
  const levelName = { simple: "Simple (nueva en esto)", medium: "Medio (quiere mejorar)", advanced: "Avanzado (técnico)" }[input.level];
  return {
    nivel_de_explicacion: levelName,
    mensaje_de_la_persona: input.userMessage.slice(0, 3000),
    acciones_de_cozte_en_el_turno: input.actions.slice(0, 20),
    respuesta_final_de_cozte: input.answer.slice(0, 6000),
  };
}

/** One compact record per turn for logs and dashboards; flags are the failures worth reviewing. */
export function summarizeQuality(answers: QualityAnswers) {
  const score = (key: string) => answers[key]?.score ?? null;
  const fit = answers.level_fit;
  const fitConfidence = fit?.choice ? fit.probabilities?.[fit.choice] ?? 1 : 0;
  const flags = [
    (score("answers_request") ?? 2) < 1.2 && "no responde lo pedido",
    (answers.explains_assumptions?.probability ?? 1) < 0.35 && "decidió sin explicar",
    fit?.choice && fit.choice !== "fits" && fitConfidence >= 0.6 && (fit.choice === "too_technical" ? "muy técnica para el nivel" : "muy básica para el nivel"),
    (score("clarity") ?? 2) < 1 && "poco clara",
  ].filter(Boolean) as string[];
  return {
    answersRequest: score("answers_request"), explainsAssumptions: answers.explains_assumptions?.probability ?? null,
    teaches: score("teaches"), levelFit: fit?.choice ?? null, clarity: score("clarity"), flags,
  };
}

export type QualitySummary = ReturnType<typeof summarizeQuality>;
export type QualityMode = "off" | "observe" | "revise";

export function qualityMode(value: string | undefined): QualityMode {
  return value === "off" || value === "observe" ? value : "revise";
}

/**
 * The failures worth a rewrite. "Decided without explaining" only counts when the turn saved something:
 * explaining a cost involves no decision to justify, and Jev sometimes flags it anyway.
 */
export function actionableFlags(summary: QualitySummary, context: { wrote: boolean }): string[] {
  return summary.flags.filter((flag) => flag !== "decidió sin explicar" || context.wrote);
}

const FEEDBACK: Record<string, string> = {
  "no responde lo pedido": "No responde directamente lo que la persona preguntó: respóndelo primero, en una o dos frases.",
  "decidió sin explicar": "Tomaste una decisión o supuesto en su nombre sin decir por qué ni cómo cambiarlo: agrégalo en una frase.",
  "muy técnica para el nivel": "Es demasiado técnica para su nivel: usa palabras simples y explica cada término que no puedas evitar.",
  "muy básica para el nivel": "Es demasiado básica o larga para su nivel: sé más concisa y usa el vocabulario técnico que maneja.",
  "poco clara": "Cuesta leerla: ordénala para que el resultado se entienda de un vistazo.",
};

/** Internal note for the rewrite: what to improve, keeping every fact and figure of the verified answer. */
export function qualityFeedback(flags: string[]): string {
  return [
    "[Nota interna de Cozte: la persona no la ve y no debes mencionarla]",
    "Tu respuesta es correcta en los datos, pero se puede mejorar para la persona:",
    ...flags.map((flag) => `- ${FEEDBACK[flag] ?? flag}`),
    "Reescribe el mensaje final completo conservando las mismas cifras y lo que hiciste. No llames herramientas salvo que falte algo imprescindible, no digas que reescribes ni menciones esta nota.",
  ].join("\n");
}

/** The five checks as short labels, for the collapsed work trace. */
export function qualityChecks(summary: QualitySummary): { label: string; ok: boolean; value?: string }[] {
  const scoreText = (value: number | null) => value === null ? "—" : `${Math.round(value * 10) / 10}/2`;
  return [
    { label: "Responde lo pedido", ok: (summary.answersRequest ?? 2) >= 1.2 },
    { label: "Explica sus supuestos", ok: (summary.explainsAssumptions ?? 1) >= 0.35 },
    { label: "Enseña", ok: (summary.teaches ?? 2) >= 1, value: scoreText(summary.teaches) },
    { label: "A tu nivel", ok: summary.levelFit === null || summary.levelFit === "fits" || !summary.flags.some((flag) => flag.includes("para el nivel")) },
    { label: "Clara", ok: (summary.clarity ?? 2) >= 1 },
  ];
}

export function qualityLine(summary: QualitySummary): string {
  return qualityChecks(summary).map((check) => `${check.label} ${check.ok ? "✓" : "✗"}${check.value ? ` (${check.value})` : ""}`).join(" · ");
}
