import { CHART_KINDS, DECK_THEMES, SLIDE_LAYOUTS, type ChartKind, type DeckTheme, type SlideLayout } from "./decks";

/**
 * Cozte's design system for presentations, in one place: what Cozte reads before designing a deck and what the
 * editor shows as design tips. The visual system itself (Manrope titles, Geist text, the brand's paper, ink and lime,
 * the validated chart palette) is applied by the slides; this guide says how to use it well.
 */

export const DECK_STRUCTURE = [
  "Portada: el tema en pocas palabras y, en el subtítulo, qué pregunta responde la presentación.",
  "La respuesta primero: una diapositiva de cifras o de mensaje clave con el resultado principal, antes del detalle.",
  "El detalle: una pregunta por diapositiva, cada una con el gráfico que mejor la responde, ordenadas de lo general a lo particular.",
  "Qué significa: una comparación o una lección cuando ayuda a decidir (qué conviene, qué cambió, qué aprender).",
  "Cierre: 3 o 4 próximos pasos concretos que empiecen con un verbo, o un resumen de hallazgos.",
];

export const LAYOUT_GUIDE: Record<SlideLayout, { use: string; budget: string }> = {
  cover: { use: "Siempre la primera. Una sola por presentación.", budget: "Título de 2 a 6 palabras; subtítulo de una frase con lo que responde." },
  section: { use: "Para el hallazgo más importante o para abrir un bloque. Como mucho 2 por presentación: si todo es clave, nada lo es.", budget: "Una frase de hasta 12 palabras; texto opcional de una o dos frases." },
  bullets: { use: "Ideas, contexto o recomendaciones que no son un número.", budget: "3 a 5 puntos de hasta 15 palabras cada uno; nunca párrafos." },
  chart: { use: "Toda pregunta que se responde con números. Es el diseño principal de un informe.", budget: "Título con la conclusión o la pregunta; conclusión de 1 o 2 frases (hasta 220 caracteres) que interprete, sin cifras nuevas." },
  kpis: { use: "Las cifras que resumen el tema, al principio. Del mismo mes y que se lean juntas.", budget: "2 a 4 cifras; texto opcional de una frase que diga qué significan juntas." },
  comparison: { use: "Dos opciones o dos momentos: antes y después, fortalezas y a mejorar, un canal contra otro.", budget: "2 a 4 puntos por columna, cortos y paralelos." },
  closing: { use: "Siempre la última.", budget: "3 o 4 pasos que empiecen con un verbo (\"Subir el precio de…\", \"Revisar…\"). Si no hay pasos claros, un resumen de hallazgos." },
};

export const CHART_GUIDE: { question: string; charts: ChartKind[] }[] = [
  { question: "¿Cuánto cuesta hacer cada producto y en qué se va?", charts: ["unit-cost", "cost-breakdown"] },
  { question: "¿Qué producto deja más? ¿Alguno pierde?", charts: ["margins"] },
  { question: "¿Qué y cuánto se produce?", charts: ["production"] },
  { question: "¿Cuánto se vendió, dónde, qué y cuándo?", charts: ["sales-by-channel", "sales-by-product", "sales-by-day"] },
  { question: "¿Qué canal conviene? ¿Cuánto queda después de vender y entregar?", charts: ["channels"] },
  { question: "¿Cómo llegaron los pedidos y cuánto costó entregarlos?", charts: ["deliveries"] },
  { question: "¿Ganamos o perdimos? ¿Dónde se fue la plata?", charts: ["month-result"] },
  { question: "¿Cuánto hay que vender para no perder?", charts: ["break-even"] },
  { question: "¿Cuánto cuesta la estructura de la empresa?", charts: ["expenses-by-area"] },
  { question: "¿Cómo cambió el costo en el tiempo?", charts: ["cost-evolution"] },
  { question: "¿Qué se compró este mes?", charts: ["purchases"] },
];

export const THEME_GUIDE: Record<DeckTheme, string> = {
  cozte: "La de la marca y la opción por defecto: sirve para casi todo.",
  noche: "Para proyectar en una sala o pantalla grande: fondo oscuro, alto contraste.",
  claro: "Para informes formales: banco, contador, inversores, un concurso.",
  terracota: "Para algo cercano: el equipo, socios, una feria o una clase.",
};

export const COLOR_MEANING = [
  "El color principal de cada estilo (verde en Cozte, lima en Noche, azul en Claro, terracota en Terracota) marca la magnitud principal: ventas, lo que queda, lo que pesa más.",
  "Naranja son los costos que se descuentan en la cascada del resultado; rojo es una pérdida o algo que queda negativo; verde, una ganancia.",
  "En la composición del costo, azul son los insumos, naranja la mano de obra y verde los gastos del taller, siempre en ese orden.",
  "Los colores los pone el sistema según el significado: nómbralos así si los explicas, y no prometas otros colores.",
];

export const WRITING_GUIDE = [
  "Títulos que dicen la conclusión o hacen la pregunta (\"Las ferias dejan más por unidad\", \"¿Dónde se vendió?\"), no rótulos (\"Ventas por canal\").",
  "Cada diapositiva responde una sola pregunta. Si necesitas dos ideas, son dos diapositivas.",
  "Las cifras de gráficos y tarjetas las calcula el motor. En los textos interpreta (qué significa, por qué importa, qué hacer); no repitas todos los números ni escribas montos que no vengan de una herramienta.",
  "Escribe al nivel de explicación de la persona; si usas un término (margen de contribución, punto de equilibrio), explícalo en palabras simples en la conclusión o en las notas.",
  "Frases en mayúscula inicial, sin emojis, sin signos de exclamación de más y sin texto en mayúsculas.",
  "Notas para presentar: 2 a 4 frases por diapositiva con qué decir y cómo explicar el gráfico, para que la persona pueda presentarla sola.",
  "Los textos largos achican la letra: mejor corto y claro que completo y apretado.",
];

export const DECK_CHECKLIST = [
  "La portada dice el tema y el subtítulo qué responde.",
  "Después de la portada va la respuesta principal, no el detalle.",
  "Ningún gráfico quedó sin datos; si falta, cambiaste de mes o de diapositiva y lo explicaste.",
  "Todos los gráficos y cifras son del mismo mes, salvo que la comparación lo pida.",
  "Cada título es una conclusión o una pregunta.",
  "El cierre tiene pasos concretos o un resumen útil.",
  "Entre 5 y 8 diapositivas, salvo que la persona pida otra cosa.",
];

/** The guide as Cozte reads it in its instructions. */
export function deckDesignGuideText(): string {
  return [
    "Estructura (el arco de una buena presentación):",
    ...DECK_STRUCTURE.map((item, index) => `${index + 1}. ${item}`),
    "Diseños de diapositiva (layout), cuándo usarlos y cuánto texto admiten:",
    ...(Object.keys(LAYOUT_GUIDE) as SlideLayout[]).map((key) => `- ${key} (${SLIDE_LAYOUTS[key].label}): ${LAYOUT_GUIDE[key].use} ${LAYOUT_GUIDE[key].budget}`),
    "Qué gráfico (chart) responde cada pregunta:",
    ...CHART_GUIDE.map((item) => `- ${item.question} → ${item.charts.join(" o ")}`),
    "Estilos (theme), según dónde se va a ver:",
    ...(Object.keys(THEME_GUIDE) as DeckTheme[]).map((key) => `- ${key} (${DECK_THEMES[key].label}): ${THEME_GUIDE[key]}`),
    "Colores con significado:",
    ...COLOR_MEANING.map((item) => `- ${item}`),
    "Cómo escribir:",
    ...WRITING_GUIDE.map((item) => `- ${item}`),
    "Antes de entregar, revisa:",
    ...DECK_CHECKLIST.map((item) => `- ${item}`),
  ].join("\n");
}

/** Chart names as the editor shows them next to each question. */
export const chartLabel = (kind: ChartKind) => CHART_KINDS[kind].label;
