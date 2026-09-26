import { z } from "zod";
import { LAYOUT_GUIDE } from "./deck-design";
import { CHART_KINDS, CHART_KIND_KEYS, DECK_TEMPLATES, DECK_TEMPLATE_KEYS, DECK_THEME_KEYS, LIMITS, METRICS, METRIC_KEYS, SLIDE_LAYOUTS, SLIDE_LAYOUT_KEYS, type ChartKind, type DeckTemplate, type DeckTheme, type MetricKey, type SlideLayout } from "./decks";

/** Input schemas for presentations, shared by Cozte's tools and the editor's API. */

const list = (record: Record<string, { hint: string }>) => Object.entries(record).map(([key, value]) => `${key}: ${value.hint}`).join("; ");

export const deckMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Usa AAAA-MM");
export const deckTheme = z.enum(DECK_THEME_KEYS as [DeckTheme, ...DeckTheme[]]);
export const deckTemplate = z.enum(DECK_TEMPLATE_KEYS as [DeckTemplate, ...DeckTemplate[]]);
const layout = z.enum(SLIDE_LAYOUT_KEYS as [SlideLayout, ...SlideLayout[]]);
const chart = z.enum(CHART_KIND_KEYS as [ChartKind, ...ChartKind[]]);
const metric = z.enum(METRIC_KEYS as [MetricKey, ...MetricKey[]]);
const column = z.object({ title: z.string().trim().min(1).max(80), bullets: z.array(z.string().trim().min(1).max(LIMITS.bullet)).max(LIMITS.columnBullets) });

const slideFields = {
  layout: layout.optional().describe(`Diseño. ${(Object.keys(SLIDE_LAYOUTS) as SlideLayout[]).map((key) => `${key}: ${LAYOUT_GUIDE[key].use} ${LAYOUT_GUIDE[key].budget}`).join("; ")}. Si lo omites se deduce del contenido`),
  title: z.string().trim().min(1).max(LIMITS.title).describe("Título corto: mejor una pregunta o una conclusión que un rótulo"),
  subtitle: z.string().trim().max(LIMITS.subtitle).optional(),
  text: z.string().trim().max(LIMITS.text).optional().describe("Conclusión o explicación breve. En gráficos reemplaza la conclusión automática: úsalo para interpretar, no para repetir cifras nuevas"),
  bullets: z.array(z.string().trim().min(1).max(LIMITS.bullet)).max(LIMITS.bullets).optional().describe("Hasta 6 puntos breves"),
  left: column.optional().describe("Columna izquierda de una comparación"),
  right: column.optional().describe("Columna derecha de una comparación"),
  product: z.string().trim().min(1).max(160).optional().describe("Producto (nombre o ID) para gráficos o cifras de un producto"),
  month: deckMonth.optional().describe("Mes AAAA-MM de este gráfico o cifras; por defecto el de la presentación"),
  notes: z.string().trim().max(LIMITS.notes).optional().describe("Notas para quien presenta; no se ven en la diapositiva"),
};

export const slideInputSchema = z.object({
  ...slideFields,
  chart: chart.optional().describe(`Gráfico con datos reales del motor. ${list(CHART_KINDS)}`),
  metrics: z.array(metric).min(1).max(LIMITS.metrics).optional().describe(`Cifras grandes calculadas por el motor. ${list(METRICS)}`),
});

export const slideChangesSchema = slideInputSchema.partial().extend({
  chart: chart.nullable().optional().describe("Otro gráfico, o null para quitarlo"),
  metrics: z.array(metric).max(LIMITS.metrics).nullable().optional().describe("Otras cifras, o null para quitarlas"),
}).describe("Solo los campos que cambian; un texto vacío lo borra");

const slideNumber = z.number().int().min(1).max(40).describe("Número de diapositiva, empezando en 1");

export const deckOperationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), slide: slideInputSchema, position: z.number().int().min(1).max(40).optional().describe("Dónde insertarla; por defecto al final") }),
  z.object({ action: z.literal("update"), slide: slideNumber, set: slideChangesSchema }),
  z.object({ action: z.literal("remove"), slide: slideNumber }),
  z.object({ action: z.literal("move"), slide: slideNumber, to: slideNumber }),
  z.object({ action: z.literal("duplicate"), slide: slideNumber }),
  z.object({ action: z.literal("settings"), title: z.string().trim().min(1).max(LIMITS.title).optional(), subtitle: z.string().trim().max(LIMITS.subtitle).optional(), theme: deckTheme.optional().describe("cozte, noche (oscuro, para proyectar), claro o terracota"), month: deckMonth.optional().describe("Cambia el período de toda la presentación") }),
  z.object({ action: z.literal("refresh").describe("Recalcula cifras y gráficos con los datos de hoy") }),
]);

export const createDeckSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.title).optional(),
  subtitle: z.string().trim().max(LIMITS.subtitle).optional(),
  theme: deckTheme.optional(),
  month: deckMonth.optional(),
  template: deckTemplate.optional().describe(`Estructura de partida. ${list(DECK_TEMPLATES)}`),
  slides: z.array(slideInputSchema).max(20).optional(),
});
