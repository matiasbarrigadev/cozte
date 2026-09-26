"use client";

import * as React from "react";
import { analyzeCosts, type CostAnalysis } from "@/lib/cost-analysis";
import { buildBusinessView, type BusinessView } from "@/lib/business";
import { DeckError, monthLabel, type DeckSources } from "@/lib/decks";
import type { DomainState, ProductCost } from "@/lib/domain";
import { DEMO_MONTH, demoBusinessRecords, demoHistory } from "@/lib/demo";
import { WIDGETS, WIDGET_KINDS, computeWidget, widgetNeeds, widgetTitle, type WidgetContent, type WidgetGroup, type WidgetKind, type WidgetSpec } from "@/lib/cozte-widgets";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AnimatedIcon } from "@/components/animated-icon";
import { cn } from "@/lib/utils";
import { WidgetChart, WidgetKpis } from "./widget-charts";

type Dashboard = DomainState & { costs: ProductCost[] };
type VisualData = {
  state: Dashboard;
  demo: boolean;
  currentMonth: string;
  sources: DeckSources;
  /** Asks for the data some widgets need (a month's records, the cost history); cached until data changes. */
  request: (needs: { months: string[]; history: boolean }) => void;
};

const VisualContext = React.createContext<VisualData | null>(null);

/**
 * Live data for every widget in the chat and on the board: each month's business view and, only when a widget
 * needs it, the cost history. Everything is computed by the engine, never taken from the model's text.
 */
export function CozteVisualProvider({ state, demo, refreshKey, children }: { state: Dashboard; demo: boolean; refreshKey: number; children: React.ReactNode }) {
  const currentMonth = demo ? DEMO_MONTH : new Date().toISOString().slice(0, 7);
  const [views, setViews] = React.useState<Record<string, BusinessView>>({});
  const [analysis, setAnalysis] = React.useState<CostAnalysis | null>(null);
  // What was already asked for, per data generation, so each month is fetched once until something changes.
  const requested = React.useRef({ months: new Set<string>(), history: "" });
  // Data changed elsewhere (the sheet, a purchase, Cozte): forget what was loaded so widgets refetch.
  const generation = `${state.revision}:${refreshKey}`;
  const [loadedGeneration, setLoadedGeneration] = React.useState(generation);
  if (loadedGeneration !== generation) {
    setLoadedGeneration(generation);
    setViews({});
    setAnalysis(null);
  }

  const request = React.useCallback((needs: { months: string[]; history: boolean }) => {
    for (const month of needs.months) {
      const key = `${generation}|${month}`;
      if (requested.current.months.has(key)) continue;
      requested.current.months.add(key);
      if (demo) { setViews((current) => ({ ...current, [month]: buildBusinessView(state, demoBusinessRecords(), month) })); continue; }
      fetch(`/api/business?month=${month}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() as Promise<BusinessView> : Promise.reject(new Error()))
        .then((view) => setViews((current) => ({ ...current, [month]: view })))
        .catch(() => { requested.current.months.delete(key); });
    }
    if (needs.history && requested.current.history !== generation) {
      requested.current.history = generation;
      if (demo) setAnalysis(analyzeCosts(demoHistory(), { granularity: "month", currency: state.organization.currency, productNames: Object.fromEntries(state.products.map((product) => [product.id, product.name])) }));
      else fetch("/api/analysis?granularity=month", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<CostAnalysis> : Promise.reject(new Error())).then(setAnalysis).catch(() => { requested.current.history = ""; });
    }
  }, [demo, state, generation]);

  const sources = React.useMemo<DeckSources>(() => ({ state, costs: state.costs, views, analysis, now: new Date().toISOString() }), [state, views, analysis]);
  const value = React.useMemo(() => ({ state, demo, currentMonth, sources, request }), [state, demo, currentMonth, sources, request]);
  return <VisualContext.Provider value={value}>{children}</VisualContext.Provider>;
}

export function useVisualData() {
  const data = React.useContext(VisualContext);
  if (!data) throw new Error("CozteVisual must be inside CozteVisualProvider");
  return data;
}

/** A widget's content: null while its month or history is loading. */
export function useWidgetContent(widget: WidgetSpec): { content: WidgetContent | null; error: string | null } {
  const { sources, request, currentMonth } = useVisualData();
  const needs = widgetNeeds([widget], currentMonth);
  const needsKey = `${needs.months.join(",")}:${needs.history}`;
  React.useEffect(() => { request(needs); }, [request, needsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return React.useMemo(() => {
    if (needs.history && !sources.analysis) return { content: null, error: null };
    try { return { content: computeWidget(widget, sources, currentMonth), error: null }; }
    catch (error) { return error instanceof DeckError && /No hay datos cargados/.test(error.message) ? { content: null, error: null } : { content: null, error: error instanceof Error ? error.message : "No se pudo calcular" }; }
  }, [widget, sources, currentMonth, needs.history]);
}

export type WidgetChoice = { kind: WidgetKind; label: string; hint: string; group: WidgetGroup; available: boolean; reason?: string };

/** Every widget, marked with whether there is data to show it right now and, if not, what is missing. */
export function useAvailableVisuals(): WidgetChoice[] {
  const { state, sources, currentMonth, request } = useVisualData();
  React.useEffect(() => { request({ months: [currentMonth], history: false }); }, [request, currentMonth]);
  const view = sources.views[currentMonth];
  const hasProducts = state.products.length > 0;
  const hasCost = state.costs.some((cost) => cost.unitMinor !== null);
  const hasSales = Boolean(view?.sales.some((sale) => sale.soldOn.startsWith(currentMonth)));
  const hasPurchases = Boolean(view?.purchases.some((purchase) => purchase.purchasedOn.startsWith(currentMonth)));
  const missing = (kind: WidgetKind): string | undefined => {
    if (!hasProducts && kind !== "purchases" && kind !== "expenses-by-area") return "Primero carga tus productos";
    if (["sales-by-channel", "sales-by-product", "sales-by-day", "deliveries"].includes(kind) && view && !hasSales) return "Sin ventas este mes";
    if (kind === "purchases" && view && !hasPurchases) return "Sin compras este mes";
    if (["unit-cost", "margins", "channels"].includes(kind) && !hasCost) return "Falta completar algún costo";
    return undefined;
  };
  return WIDGET_KINDS.map((kind) => {
    const reason = missing(kind);
    return { kind, label: WIDGETS[kind].label, hint: WIDGETS[kind].hint, group: WIDGETS[kind].group, available: !reason, reason };
  });
}

type CardActions = { onPin?: () => void; onRemove?: () => void; onMoveUp?: () => void; onMoveDown?: () => void; onAsk?: (text: string) => void };

/** A widget as a card: title, live data, its conclusion and the actions that apply where it sits. */
export function CozteVisual({ widget, compact, pinned, ...actions }: { widget: WidgetSpec; compact?: boolean; pinned?: boolean } & CardActions) {
  const { state, currentMonth } = useVisualData();
  const { content, error } = useWidgetContent(widget);
  const [expanded, setExpanded] = React.useState(false);
  const product = widget.productId ? state.products.find((item) => item.id === widget.productId) : undefined;
  const title = widgetTitle(widget, product?.name);
  const period = WIDGETS[widget.kind].usesMonth ? widget.month ? monthLabel(widget.month) : `${monthLabel(currentMonth)} · en vivo` : "Datos actuales";
  const icon = (label: string, name: Parameters<typeof AnimatedIcon>[0]["name"], onClick?: () => void) => onClick ? <Button type="button" size="icon-sm" variant="ghost" className="size-7" aria-label={`${label}: ${title}`} title={label} onClick={onClick}><AnimatedIcon name={name} size={14} /></Button> : null;
  return <section aria-label={title} className={cn("group/widget flex w-full min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 text-card-foreground", !compact && "max-w-xl")}>
    <header className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold">{title}</h3>
        <p className="truncate text-[11px] text-muted-foreground">{period}</p>
      </div>
      <div className="flex shrink-0 items-center">
        {actions.onPin ? <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={actions.onPin}><AnimatedIcon name="plus" data-icon="inline-start" size={14} />Fijar en tablero</Button> : pinned ? <span className="px-2 text-[11px] text-muted-foreground">En tu tablero</span> : null}
        <div className={cn("flex items-center", compact && "opacity-60 transition-opacity group-hover/widget:opacity-100 group-focus-within/widget:opacity-100")}>
          {icon("Subir", "arrowUp", actions.onMoveUp)}
          {icon("Bajar", "arrowDown", actions.onMoveDown)}
          {icon("Ampliar", "expand", content ? () => setExpanded(true) : undefined)}
          {icon("Preguntar a Cozte", "message", actions.onAsk ? () => actions.onAsk!(`Sobre «${title}» de mi tablero: ¿qué me está diciendo y qué debería hacer?`) : undefined)}
          {icon("Quitar del tablero", "close", actions.onRemove)}
        </div>
      </div>
    </header>
    <WidgetBody content={content} error={error} />
    <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{WIDGETS[widget.kind].hint} · {period}</DialogDescription></DialogHeader>
      <WidgetBody content={content} error={error} large />
      {actions.onAsk ? <Button type="button" variant="outline" className="self-start" onClick={() => { setExpanded(false); actions.onAsk!(`Sobre «${title}» de mi tablero: ¿qué me está diciendo y qué debería hacer?`); }}><AnimatedIcon name="message" data-icon="inline-start" />Preguntarle a Cozte</Button> : null}
    </DialogContent></Dialog>
  </section>;
}

function WidgetBody({ content, error, large }: { content: WidgetContent | null; error: string | null; large?: boolean }) {
  const { state } = useVisualData();
  const currency = state.organization.currency;
  if (error) return <p className="text-xs text-muted-foreground">{error}</p>;
  if (!content) return <div className={cn("animate-pulse rounded-lg bg-muted", large ? "h-56" : "h-20")} aria-label="Cargando" />;
  return <div className="flex flex-col gap-2.5">
    {content.kpis?.length ? <WidgetKpis kpis={content.kpis} currency={currency} large={large} /> : null}
    {content.chart ? <WidgetChart data={content.chart.data} currency={currency} large={large} /> : null}
    {content.insight ? <p className={cn("rounded-md bg-muted/50 px-2.5 py-1.5 text-muted-foreground", large ? "text-sm" : "text-[11px] leading-snug")}>{content.insight}</p> : null}
    {large && content.chart?.caption ? <p className="text-xs text-muted-foreground">{content.chart.caption}</p> : null}
  </div>;
}
