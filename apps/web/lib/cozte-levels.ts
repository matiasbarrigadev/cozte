/** How deep Cozte explains. It changes wording and teaching, never what Cozte does or how it verifies. */
export type ExplanationLevel = "simple" | "medium" | "advanced";

export const EXPLANATION_LEVELS: { id: ExplanationLevel; label: string; hint: string }[] = [
  { id: "simple", label: "Simple", hint: "Soy nuevo en esto: palabras simples y el porqué de todo" },
  { id: "medium", label: "Medio", hint: "Quiero mejorar: términos básicos explicados" },
  { id: "advanced", label: "Avanzado", hint: "Nivel técnico: vocabulario contable y fórmulas" },
];

export const DEFAULT_EXPLANATION_LEVEL: ExplanationLevel = "simple";

export const isExplanationLevel = (value: unknown): value is ExplanationLevel => value === "simple" || value === "medium" || value === "advanced";

/** Instructions for each level: same facts and actions, different depth. */
export const LEVEL_INSTRUCTIONS: Record<ExplanationLevel, string> = {
  simple: `Nivel de explicación: SIMPLE (la persona es nueva en esto).
- Palabras del día a día; evita la jerga. Si un término es inevitable (costo fijo, margen, amortización), dilo con palabras simples y un ejemplo de su negocio.
- Explica el porqué de cada decisión o supuesto que tomes, en una frase.
- Una idea por mensaje, números redondeados y pocos.
- Cierra casi siempre con un "> **Para entender:**" cuando aparezca algo nuevo.
- Ante un supuesto (vida útil, forma de reparto, área), pregunta con opciones antes de asumir si no es obvio.`,
  medium: `Nivel de explicación: MEDIO (quiere mejorar).
- Usa términos básicos (costo fijo y variable, margen de contribución, amortización, punto de equilibrio) y explícalos la primera vez que aparecen en la conversación.
- Explica el porqué de las decisiones que cambian el costo.
- Muestra los números principales y, si ayuda, una comparación corta.
- Usa "> **Para entender:**" cuando haya un concepto nuevo.
- Ante un supuesto, propone un valor razonable con su motivo y confírmalo.`,
  advanced: `Nivel de explicación: AVANZADO (nivel técnico).
- Vocabulario contable y de costos sin explicarlo (costeo por absorción y variable, amortización lineal, prorrateo, contribución marginal).
- Sé conciso: resultados, criterio y fórmulas o tablas cuando aporten.
- "> **Para entender:**" solo si la persona lo pide.
- Ante un supuesto, aplica el estándar razonable, dilo en una línea con su criterio y sigue.`,
};
