import { CHART_KINDS, CHART_KIND_KEYS, METRICS, METRIC_KEYS, buildChart, buildKpi, chartRows, formatValue, isMonth, monthLabel, type ChartKind, type ChartSnapshot, type DeckSources, type Kpi, type MetricKey } from "./decks";

/**
 * Widgets Cozte shows in the chat and pins to the board next to it. They are computed live by the same engine as
 * the presentations (every chart and figure), so a widget can never show a number the model made up, and a pinned
 * widget keeps updating as the business records sales, purchases or new costs.
 */
export type WidgetKind = ChartKind | "month" | "kpis";
export type WidgetGroup = "month" | "sales" | "costs" | "purchases";

export const WIDGET_GROUPS: { id: WidgetGroup; label: string; hint: string }[] = [
  { id: "month", label: "Tu mes", hint: "Cómo viene el mes: resultado, equilibrio y cifras clave" },
  { id: "sales", label: "Ventas y entregas", hint: "Qué, dónde y cuándo se vende, qué deja cada canal y cómo van las entregas" },
  { id: "costs", label: "Costos", hint: "Cuánto cuesta producir, en qué se va y cómo cambia" },
  { id: "purchases", label: "Compras", hint: "Lo que se compró en el mes" },
];

type WidgetMeta = { label: string; hint: string; group: WidgetGroup; needsProduct?: boolean; productOptional?: boolean; usesMonth?: boolean; usesHistory?: boolean; usesDeliveries?: boolean };

const CHART_GROUP: Record<ChartKind, WidgetGroup> = {
  "unit-cost": "costs", "cost-breakdown": "costs", margins: "costs", production: "costs", "cost-evolution": "costs", "expenses-by-area": "costs",
  "month-result": "month", "break-even": "month",
  "sales-by-channel": "sales", "sales-by-product": "sales", "sales-by-day": "sales", channels: "sales", deliveries: "sales", "delivery-status": "sales", "upcoming-deliveries": "sales",
  purchases: "purchases",
};

export const WIDGETS: Record<WidgetKind, WidgetMeta> = {
  month: { label: "Tu mes", hint: "Ganancia o pérdida del mes, lo vendido y cuánto falta para no perder", group: "month", usesMonth: true },
  kpis: { label: "Cifras clave", hint: "Hasta 4 cifras que elijas: ventas, resultado, costo por unidad, margen…", group: "month", usesMonth: true },
  ...Object.fromEntries(CHART_KIND_KEYS.map((kind) => [kind, {
    label: CHART_KINDS[kind].label, hint: CHART_KINDS[kind].hint, group: CHART_GROUP[kind],
    needsProduct: CHART_KINDS[kind].needsProduct, productOptional: kind === "channels", usesMonth: CHART_KINDS[kind].usesMonth, usesHistory: CHART_KINDS[kind].usesHistory, usesDeliveries: CHART_KINDS[kind].usesDeliveries,
  } satisfies WidgetMeta])) as Record<ChartKind, WidgetMeta>,
};

export const WIDGET_KINDS: WidgetKind[] = ["month", "kpis", "month-result", "break-even", "sales-by-channel", "sales-by-product", "sales-by-day", "channels", "upcoming-deliveries", "delivery-status", "deliveries", "unit-cost", "cost-breakdown", "margins", "production", "cost-evolution", "expenses-by-area", "purchases"];

export const DEFAULT_KPI_METRICS: MetricKey[] = ["revenue", "result", "sales-count", "break-even"];

export type BoardWidget = {
  id: string;
  kind: WidgetKind;
  productId?: string | null;
  /** A fixed month (AAAA-MM); empty means "the current month", so the widget rolls over by itself. */
  month?: string | null;
  metrics?: MetricKey[];
  /** A short title chosen by the person or Cozte ("Cómo va la feria"). */
  title?: string;
  addedBy: "user" | "cozte";
};

export type WidgetSpec = Omit<BoardWidget, "id">;

export const MAX_BOARD_WIDGETS = 12;

/** Widgets from the first version that were renamed. */
const LEGACY_KINDS: Record<string, WidgetKind> = { sales: "sales-by-channel" };

export const isWidgetKind = (value: unknown): value is WidgetKind => typeof value === "string" && (WIDGET_KINDS as string[]).includes(value);

const cleanMetrics = (value: unknown): MetricKey[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const metrics = [...new Set(value.filter((item): item is MetricKey => typeof item === "string" && (METRIC_KEYS as string[]).includes(item)))].slice(0, 4);
  return metrics.length ? metrics : undefined;
};

/** Normalizes one widget request: known kind, valid month and figures, a short title. */
export function cleanWidget(input: Record<string, unknown>): WidgetSpec | null {
  const kind = typeof input.kind === "string" ? LEGACY_KINDS[input.kind] ?? input.kind : null;
  if (!isWidgetKind(kind)) return null;
  const spec: WidgetSpec = { kind, productId: typeof input.productId === "string" && input.productId ? input.productId : null, addedBy: input.addedBy === "cozte" ? "cozte" : "user" };
  if (isMonth(input.month)) spec.month = input.month;
  const metrics = cleanMetrics(input.metrics);
  if (kind === "kpis") spec.metrics = metrics ?? DEFAULT_KPI_METRICS;
  if (typeof input.title === "string" && input.title.trim()) spec.title = input.title.trim().slice(0, 60);
  return spec;
}

/** Reads a stored board defensively, keeping known widgets only. */
export function parseBoard(value: unknown): BoardWidget[] {
  let data = value;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { return []; } }
  if (!Array.isArray(data)) return [];
  return data.flatMap((item): BoardWidget[] => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const spec = cleanWidget(entry);
    return spec && typeof entry.id === "string" ? [{ id: entry.id, ...spec }] : [];
  }).slice(0, MAX_BOARD_WIDGETS);
}

/** Two widgets are the same when they show the same thing (kind, product, month and figures). */
export const widgetKey = (widget: WidgetSpec) => [widget.kind, widget.productId ?? "", widget.month ?? "", (widget.metrics ?? []).join("+")].join("|");

/** Adds a widget at the top; the same visual is moved to the top (keeping a new title) instead of duplicated. */
export function pinWidget(board: BoardWidget[], widget: WidgetSpec): BoardWidget[] {
  const key = widgetKey(widget);
  const existing = board.find((item) => widgetKey(item) === key);
  const id = existing?.id ?? `${widget.kind}-${Math.random().toString(36).slice(2, 10)}`;
  return [{ ...existing, ...widget, title: widget.title ?? existing?.title, id }, ...board.filter((item) => widgetKey(item) !== key)].slice(0, MAX_BOARD_WIDGETS);
}

export function moveWidget(board: BoardWidget[], id: string, to: number): BoardWidget[] {
  const index = board.findIndex((item) => item.id === id);
  if (index < 0) return board;
  const next = [...board];
  const [widget] = next.splice(index, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, widget);
  return next;
}

/** The widget's name: its own title, or the kind plus the product and a fixed month when they apply. */
export function widgetTitle(widget: WidgetSpec, productName?: string | null): string {
  if (widget.title) return widget.title;
  const base = widget.kind === "cost-breakdown" && productName ? `Costo de ${productName}` : WIDGETS[widget.kind].label;
  const product = widget.kind !== "cost-breakdown" && productName ? ` · ${productName}` : "";
  return `${base}${product}${widget.month ? ` · ${monthLabel(widget.month)}` : ""}`;
}

export type WidgetContent = { chart?: ChartSnapshot; kpis?: Kpi[]; insight: string | null };

/**
 * What a widget shows, computed by the engine for its month (the current one unless it has its own). Throws a
 * DeckError while the month's data is not loaded, so the caller can show it as loading.
 */
export function computeWidget(widget: WidgetSpec, sources: DeckSources, currentMonth: string): WidgetContent {
  const month = widget.month ?? currentMonth;
  if (widget.kind === "kpis") {
    const productId = widget.productId ?? sources.state.products[0]?.id ?? null;
    return { kpis: (widget.metrics ?? DEFAULT_KPI_METRICS).map((metric) => buildKpi(metric, METRICS[metric].perProduct ? productId : null, month, sources)), insight: null };
  }
  if (widget.kind === "month") {
    const kpis = (["result", "revenue", "contribution", "fixed-costs"] as MetricKey[]).map((metric) => buildKpi(metric, null, month, sources));
    const chart = buildChart("break-even", null, month, sources);
    return { kpis, chart, insight: chart.insight };
  }
  const productId = widget.productId ?? (WIDGETS[widget.kind].needsProduct ? sources.state.products[0]?.id ?? null : null);
  const chart = buildChart(widget.kind, productId, month, sources);
  return { chart, insight: chart.insight };
}

/** The months and history a set of widgets needs. */
export function widgetNeeds(widgets: WidgetSpec[], currentMonth: string): { months: string[]; history: boolean; deliveries: boolean } {
  return {
    months: [...new Set(widgets.map((widget) => widget.month ?? currentMonth))],
    history: widgets.some((widget) => WIDGETS[widget.kind].usesHistory),
    deliveries: widgets.some((widget) => WIDGETS[widget.kind].usesDeliveries || (widget.kind === "kpis" && (widget.metrics ?? []).some((metric) => METRICS[metric].usesDeliveries))),
  };
}

/** The figures a widget shows, as text lines Cozte can quote. */
export function widgetFigures(content: WidgetContent, currency: string): string[] {
  return [
    ...(content.kpis ?? []).map((kpi) => `${kpi.label}${kpi.note ? ` (${kpi.note})` : ""}: ${formatValue(kpi.value, kpi.format, currency)}`),
    ...(content.chart ? chartRows(content.chart.data, currency).rows ?? (content.chart.data.type === "empty" ? [`Sin datos: ${content.chart.data.message}`] : []) : []),
  ].slice(0, 12);
}

/** The board as Cozte sees it: numbered, with each widget's name. */
export function boardOutline(board: BoardWidget[], productName: (id: string) => string | undefined): string[] {
  return board.map((widget, index) => `${index + 1}. ${widgetTitle(widget, widget.productId ? productName(widget.productId) : null)} [${widget.kind}${widget.month ? `, ${widget.month}` : ""}]${widget.addedBy === "cozte" ? " (lo fijaste tú)" : ""}`);
}
