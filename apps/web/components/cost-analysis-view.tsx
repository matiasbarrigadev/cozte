"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { analyzeCosts, costsAt, groupComponents, type ComponentType, type CostAnalysis, type CostsAt, type Granularity, type Insight } from "@/lib/cost-analysis";
import { demoHistory } from "@/lib/demo";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { useMoney } from "@/components/business/business-ui";
import { ChartCard, DATA_COLORS, DivergingBars, FlowChart, Legend, LineChart, MonthBars, ProportionBar, Sparkline, Treemap, longMonth, shortMonth, useCompactMoney, type Format } from "@/components/analysis/charts";
import { cn } from "@/lib/utils";

/**
 * How the cost of making each product changed, what it is made of and what explains each change, from the snapshots
 * every confirmed change saves. Same charts and palette as the business analysis: hover explains, a click picks the
 * period, legends hide series and every chart has a table view.
 */

type GroupBy = "type" | "category" | "concept";

const TYPE_COLOR: Record<ComponentType, string> = { insumo: DATA_COLORS[0], "mano de obra": DATA_COLORS[1], "gasto compartido": DATA_COLORS[4] };
const TYPE_LABEL_COLOR: Record<string, string> = { Insumos: TYPE_COLOR.insumo, "Mano de obra directa": TYPE_COLOR["mano de obra"], "Gastos compartidos": TYPE_COLOR["gasto compartido"] };
const OTHERS = "var(--data-muted)";

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (value: T) => void; label: string }) {
  return <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border bg-card p-0.5 text-xs">
    {options.map(([key, text]) => <button key={key} type="button" role="radio" aria-checked={value === key} onClick={() => onChange(key)}
      className={cn("rounded-md px-2.5 py-1 font-medium transition-colors", value === key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{text}</button>)}
  </div>;
}

/** Keeps the six largest groups with their color; the rest fold into "Otros". */
function foldGroups(rows: Record<string, number>[], groupBy: GroupBy): { key: string; label: string; color: string; values: number[] }[] {
  const totals = new Map<string, number>();
  for (const row of rows) for (const [label, value] of Object.entries(row)) totals.set(label, (totals.get(label) ?? 0) + value);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
  const kept = ranked.length > 6 ? ranked.slice(0, 5) : ranked;
  const layers = kept.map((label, index) => ({ key: label, label, color: groupBy === "type" ? TYPE_LABEL_COLOR[label] ?? DATA_COLORS[index] : DATA_COLORS[index], values: rows.map((row) => row[label] ?? 0) }));
  if (ranked.length > 6) layers.push({ key: "otros", label: "Otros", color: OTHERS, values: rows.map((row) => Object.entries(row).filter(([label]) => !kept.includes(label)).reduce((sum, [, value]) => sum + value, 0)) });
  return layers;
}

/** `embedded` hides the title when it is a tab of the business analysis. */
export function CostAnalysisView({ currency, demo, embedded = false }: { currency: string; demo: boolean; embedded?: boolean }) {
  const [granularity, setGranularity] = React.useState<Granularity>("month");
  const [groupBy, setGroupBy] = React.useState<GroupBy>("type");
  const [productId, setProductId] = React.useState<string>("");
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [hiddenProducts, setHiddenProducts] = React.useState<Set<string>>(new Set());
  const [loaded, setLoaded] = React.useState<{ granularity: Granularity; analysis: CostAnalysis } | null>(null);
  // The demo analyzes an example history in the browser; real workspaces fetch their own snapshots.
  const demoAnalysis = React.useMemo(() => demo ? analyzeCosts(demoHistory(), { granularity, currency }) : null, [demo, granularity, currency]);
  const analysis = demo ? demoAnalysis : loaded?.analysis ?? null;
  // Refetch keeps the previous render (dimmed) until the new slice arrives.
  const loading = !demo && loaded?.granularity !== granularity;
  const [insights, setInsights] = React.useState<SavedInsight[]>([]);
  const [aiLoading, setAiLoading] = React.useState(false);
  const money = useMoney(currency);
  const compact = useCompactMoney(currency);

  React.useEffect(() => {
    if (demo) return;
    let active = true;
    fetch("/api/analysis/insights", { cache: "no-store" })
      .then(async (response) => response.ok ? ((await response.json()).insights as SavedInsight[]) : [])
      .then((items) => { if (active) setInsights(items); })
      .catch(() => {});
    return () => { active = false; };
  }, [demo]);

  React.useEffect(() => {
    if (demo) return;
    let active = true;
    fetch(`/api/analysis?granularity=${granularity}`, { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error((await response.json()).error ?? "No se pudo cargar el análisis"); return response.json() as Promise<CostAnalysis>; })
      .then((data) => { if (active) setLoaded({ granularity, analysis: data }); })
      .catch((error) => { if (active) toast.error(error instanceof Error ? error.message : "No se pudo cargar el análisis"); });
    return () => { active = false; };
  }, [demo, granularity]);

  const labelOf = React.useCallback((period: string) => granularity === "month" ? shortMonth(period) : new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${period}T12:00:00Z`)), [granularity]);
  const titleOf = React.useCallback((period: string) => granularity === "month" ? longMonth(period) : `Semana del ${new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}T12:00:00Z`))}`, [granularity]);

  async function generate() {
    setAiLoading(true);
    try {
      const response = await fetch("/api/analysis/insights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ granularity }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudieron generar las conclusiones");
      setInsights((current) => [data.insight as SavedInsight, ...current]);
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudieron generar las conclusiones"); }
    finally { setAiLoading(false); }
  }

  const products = analysis?.products ?? [];
  const periods = analysis?.periods ?? [];
  const selected = products.find((product) => product.id === productId) ?? products[0];
  const focus = Math.max(0, chosen ? periods.indexOf(chosen) : periods.length - 1);
  const pick = (index: number) => setChosen(periods[index] ?? null);
  const period = periods[focus];
  const productColor = (id: string) => DATA_COLORS[Math.max(0, products.findIndex((product) => product.id === id)) % DATA_COLORS.length];
  const unitAt = (product: (typeof products)[number], index: number) => product.points.find((point) => point.period === periods[index] && !point.incomplete)?.unitCost ?? null;
  const pointAt = (product: (typeof products)[number], index: number) => product.points.find((point) => point.period === periods[index] && !point.incomplete);

  const compositionRows = selected ? periods.map((_, index) => { const point = pointAt(selected, index); return point ? groupComponents(point, analysis!.components, groupBy) : {}; }) : [];
  const layers = foldGroups(compositionRows, groupBy);
  const focusPoint = selected ? pointAt(selected, focus) : undefined;
  const treemapItems = focusPoint ? Object.entries(focusPoint.components).map(([key, value]) => {
    const meta = analysis!.components.find((entry) => entry.key === key);
    return { key, label: meta?.label ?? key, value, color: meta ? TYPE_COLOR[meta.type] : OTHERS, group: meta ? `${meta.type === "insumo" ? "Insumo" : meta.type === "mano de obra" ? "Mano de obra" : "Gasto compartido"} · ${meta.category}` : undefined };
  }) : [];
  const drivers = selected?.change?.drivers.slice(0, 8) ?? [];
  const totals = (analysis?.totals ?? []).map((total) => total.monthlyProductionCost ?? 0);
  // Lines start near the lowest cost, so a change of a few percent is visible (lines are read by position, not length).
  const knownUnits = products.flatMap((product) => periods.map((_, index) => unitAt(product, index))).filter((value): value is number => value !== null);
  const lineFloor = knownUnits.length ? (() => { const low = Math.min(...knownUnits) * 0.8; const step = 10 ** Math.floor(Math.log10(Math.max(low, 1))); return Math.floor(low / step) * step; })() : 0;
  const typeParts = (point: typeof focusPoint) => point ? Object.entries(groupComponents(point, analysis!.components, "type")).map(([label, value]) => ({ key: label, label, value, color: TYPE_LABEL_COLOR[label] ?? OTHERS })) : [];

  return <>
    {!embedded ? <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-sm text-muted-foreground">Evolución</p><h1 className="text-3xl font-semibold tracking-tight">Análisis de costos</h1><p className="max-w-2xl text-sm text-muted-foreground">Cómo cambió el costo de fabricar cada producto, qué lo explica y qué conviene vigilar. Se arma con las fotos que guarda cada cambio confirmado{demo ? " (en la demostración, con un historial de ejemplo)" : ""}.</p></div>
    </div> : <p className="text-sm text-muted-foreground">Cómo cambió el costo de fabricar cada producto, de qué está hecho y qué explica cada cambio. Sale de las fotos que guarda cada cambio confirmado{demo ? " (en la demostración, un historial de ejemplo)" : ""}.</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Segmented label="Agrupar el tiempo" value={granularity} onChange={(value) => { setGranularity(value); setChosen(null); }} options={[["month", "Meses"], ["week", "Semanas"]]} />
      <Segmented label="Agrupar los costos" value={groupBy} onChange={setGroupBy} options={[["type", "Tipo"], ["category", "Categoría"], ["concept", "Concepto"]]} />
      {period ? <div className="inline-flex items-center gap-1 rounded-lg border bg-card p-0.5 text-xs" aria-label="Período que estás mirando">
        <Button type="button" size="icon-xs" variant="ghost" aria-label="Período anterior" disabled={focus === 0} onClick={() => pick(focus - 1)}><ChevronLeft /></Button>
        <span className="min-w-28 text-center font-medium capitalize">{titleOf(period)}</span>
        <Button type="button" size="icon-xs" variant="ghost" aria-label="Período siguiente" disabled={focus === periods.length - 1} onClick={() => pick(focus + 1)}><ChevronRight /></Button>
      </div> : null}
    </div>
    {loading && !analysis ? <TextShimmer className="text-sm">Preparando el análisis…</TextShimmer> : null}
    {analysis && !products.length ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Todavía no hay fotos de costos. Se guarda una cada vez que se confirma un cambio en tus productos, insumos o gastos.</p> : null}
    {analysis && products.length ? <div className={cn("flex flex-col gap-4 transition-opacity", loading && "opacity-60")}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {products.map((product) => {
          const value = unitAt(product, focus);
          const before = focus > 0 ? unitAt(product, focus - 1) : null;
          const delta = value !== null && before ? (value - before) / before : null;
          const active = product.id === selected?.id;
          return <button key={product.id} type="button" onClick={() => setProductId(product.id)} aria-pressed={active}
            className={cn("flex min-w-0 flex-col gap-2 rounded-2xl border bg-card p-4 text-left shadow-xs transition-all hover:border-foreground/25", active && "border-foreground/40 ring-2 ring-foreground/10")}>
            <div className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground"><span className="size-2 shrink-0 rounded-full" style={{ background: productColor(product.id) }} aria-hidden="true" /><span className="truncate">{product.name}</span></span>
              {delta !== null ? Math.round(delta * 1000) === 0 ? <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">= igual</span>
                : <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", delta > 0 ? "bg-red-500/10 text-red-700 dark:text-red-400" : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400")}>{delta > 0 ? "↑" : "↓"} {new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(Math.abs(delta * 100))} %</span> : null}
            </div>
            <p className="text-2xl font-semibold tracking-tight tabular-nums">{value !== null ? money(value) : "Incompleto"}<span className="ml-1 text-xs font-normal text-muted-foreground">por unidad</span></p>
            <Sparkline values={periods.map((_, index) => unitAt(product, index))} focus={focus} color={productColor(product.id)} height={40} label={`Costo por unidad de ${product.name}`} />
            <ProportionBar parts={typeParts(pointAt(product, focus))} format={money} height={8} label={`De qué está hecho el costo de ${product.name}`} />
            <p className="text-[11px] text-muted-foreground">{product.change ? `${product.change.delta > 0 ? "Subió" : product.change.delta < 0 ? "Bajó" : "Igual"} ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(Math.abs(product.change.deltaPercent))} % desde el primer período (${money(product.change.from)})` : "Sin cambios registrados todavía"}</p>
          </button>;
        })}
      </div>
      <Legend items={[{ key: "insumo", label: "Insumos", color: TYPE_COLOR.insumo }, { key: "labor", label: "Mano de obra directa", color: TYPE_COLOR["mano de obra"] }, { key: "shared", label: "Gastos compartidos", color: TYPE_COLOR["gasto compartido"] }]} />

      <ChartCard title="Costo por unidad de cada producto" description={`Última foto de cada ${granularity === "month" ? "mes" : "semana"}; si no hubo cambios se mantiene el costo anterior. Toca un producto en la leyenda para ocultarlo.`}
        legend={<Legend items={products.map((product) => ({ key: product.id, label: product.name, color: productColor(product.id) }))} hidden={hiddenProducts} onToggle={(key) => setHiddenProducts((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })} />}
        table={{ columns: ["Período", ...products.map((product) => product.name)], rows: periods.map((item, index) => [titleOf(item), ...products.map((product) => { const value = unitAt(product, index); return value === null ? "—" : money(value); })]) }}>
        <LineChart months={periods} labelOf={labelOf} titleOf={titleOf} focus={focus} onFocus={pick} format={money} compact={compact} label="Costo por unidad de cada producto en el tiempo" height={260} min={lineFloor}
          series={products.filter((product) => !hiddenProducts.has(product.id)).map((product) => ({ key: product.id, label: product.name, color: productColor(product.id), values: periods.map((_, index) => unitAt(product, index)), area: products.length === 1 }))} />
      </ChartCard>

      {selected ? <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <ChartCard title={`Cómo se arma el costo de ${selected.name}`} description={`Cada ${granularity === "month" ? "mes" : "semana"}, el costo de una unidad repartido por ${groupBy === "type" ? "tipo de costo" : groupBy === "category" ? "categoría" : "concepto"}. Arriba, el costo por unidad; abajo, cuánto cambió.`}
          legend={<Legend items={layers} />}
          table={{ columns: ["Período", ...layers.map((layer) => layer.label), "Total"], rows: periods.map((item, index) => [titleOf(item), ...layers.map((layer) => money(layer.values[index])), (() => { const value = unitAt(selected, index); return value === null ? "—" : money(value); })()]) }}>
          <FlowChart months={periods} labelOf={labelOf} titleOf={titleOf} layers={layers} focus={focus} onFocus={pick} format={money} height={260} label={`Composición del costo de ${selected.name} en el tiempo`}
            top={(index) => { const value = unitAt(selected, index); return value === null ? "—" : compact(value); }}
            bottom={(index) => {
              const value = unitAt(selected, index);
              const before = index > 0 ? unitAt(selected, index - 1) : null;
              if (value === null || before === null || Math.round(value - before) === 0) return null;
              return { text: `${value > before ? "+" : "−"}${compact(Math.abs(value - before))}`, tone: value > before ? "negative" : undefined };
            }} />
        </ChartCard>
        <ChartCard title={`Dónde se va cada peso · ${period ? labelOf(period) : ""}`} description={`Cada bloque es un concepto del costo de una unidad de ${selected.name}, del tamaño de lo que pesa.`}
          table={{ columns: ["Concepto", "Tipo y categoría", "Por unidad"], rows: [...treemapItems].sort((a, b) => b.value - a.value).map((item) => [item.label, item.group ?? "—", money(item.value)]) }}>
          <Treemap items={treemapItems} format={money} height={290} label={`Conceptos del costo de ${selected.name}`} />
        </ChartCard>
      </div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={`Qué explica el cambio${selected ? ` de ${selected.name}` : ""}`} description="Diferencia por unidad entre el primer y el último período: a la derecha lo que subió, a la izquierda lo que bajó."
          table={drivers.length ? { columns: ["Concepto", "Cambio por unidad"], rows: drivers.map((driver) => [driver.label, `${driver.delta > 0 ? "+" : "−"}${money(Math.abs(driver.delta))}`]) } : undefined}>
          {selected?.change ? <>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
              <span className="tabular-nums text-muted-foreground">{money(selected.change.from)}</span><span aria-hidden="true">→</span><span className="font-semibold tabular-nums">{money(selected.change.to)}</span>
              <span className={cn("ml-auto rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", selected.change.delta > 0 ? "bg-red-500/10 text-red-700 dark:text-red-400" : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400")}>{selected.change.delta > 0 ? "↑" : "↓"} {new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(Math.abs(selected.change.deltaPercent))} %</span>
            </div>
            {drivers.length ? <DivergingBars items={drivers.map((driver) => ({ key: driver.key, label: driver.label, value: driver.delta }))} format={money} label="Variación por concepto" /> : <p className="text-sm text-muted-foreground">El costo no cambió entre esos períodos.</p>}
          </> : <p className="text-sm text-muted-foreground">Todavía no hay dos períodos con costo completo para comparar.</p>}
        </ChartCard>
        <ChartCard title="Costo total de producción" description="Todos los productos juntos: costo del lote × lotes al mes. Aparece cuando todos tienen su volumen mensual."
          table={{ columns: ["Período", "Costo total"], rows: periods.map((item, index) => [titleOf(item), totals[index] ? money(totals[index]) : "—"]) }}>
          {totals.some((value) => value > 0) ? <MonthBars months={periods} labelOf={labelOf} titleOf={titleOf} values={totals} focus={focus} onFocus={pick} format={money} compact={compact} label="Costo total de producción por período" />
            : <p className="text-sm text-muted-foreground">Falta el volumen mensual de algún producto para sumar el total.</p>}
        </ChartCard>
      </div>

      <ChartCard title="Conclusiones" description="Lo que muestran los datos, calculado por el motor. Cozte puede redactarte un análisis con mejoras y riesgos.">
        {analysis.insights.length ? <ul className="flex flex-col gap-2">{analysis.insights.slice(0, 8).map((insight, index) => <InsightRow key={index} insight={insight} />)}</ul> : <p className="text-sm text-muted-foreground">No hay alertas por ahora.</p>}
        <div className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">Análisis de Cozte</span><Button size="sm" variant={insights.length ? "outline" : "default"} disabled={demo || aiLoading || analysis.snapshotCount === 0} onClick={() => void generate()}>{aiLoading ? "Analizando…" : insights.length ? "Generar uno nuevo" : "Generar conclusiones"}</Button></div>
          {aiLoading ? <TextShimmer className="text-sm">Cozte está leyendo la evolución de tus costos…</TextShimmer> : null}
          {insights[0] ? <SavedInsightView insight={insights[0]} open /> : demo ? <p className="text-xs text-muted-foreground">En la demostración no se generan conclusiones; en tu espacio quedan guardadas para revisarlas cuando quieras.</p> : null}
          {insights.length > 1 ? <details className="group/history rounded-md border bg-background/60">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="text-xs transition-transform group-open/history:rotate-90">▸</span>Conclusiones anteriores ({insights.length - 1})</summary>
            <div className="flex flex-col gap-2 border-t p-3">{insights.slice(1).map((insight) => <SavedInsightView key={insight.id} insight={insight} />)}</div>
          </details> : null}
        </div>
      </ChartCard>

      <CostsAtCard currency={currency} demo={demo} money={money} />
    </div> : null}
  </>;
}

function InsightRow({ insight }: { insight: Insight }) {
  const tone = insight.severity === "risk" ? { label: "Riesgo", dot: "bg-red-500" } : insight.severity === "warning" ? { label: "Atención", dot: "bg-amber-500" } : { label: "Dato", dot: "bg-muted-foreground/60" };
  return <li className="flex items-start gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", tone.dot)} aria-hidden="true" />
    <div className="flex min-w-0 flex-col gap-0.5"><p><span className="sr-only">{tone.label}: </span><span className="font-medium">{insight.title}</span></p><p className="text-muted-foreground">{insight.detail}</p></div>
  </li>;
}

type SavedInsight = { id: string; createdAt: string; granularity: Granularity; text: string; verified: boolean; firstPeriod: string | null; lastPeriod: string | null };

/** D1 timestamps come as "YYYY-MM-DD HH:MM:SS" in UTC. */
const parseTimestamp = (value: string) => new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
const dateTime = (value: string) => new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(parseTimestamp(value));
const shortPeriod = (period: string, granularity: Granularity) => {
  const date = new Date(`${period.length === 7 ? `${period}-01` : period}T12:00:00Z`);
  return granularity === "month"
    ? new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(date)
    : `sem. ${new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }).format(date)}`;
};

function SavedInsightView({ insight, open = false }: { insight: SavedInsight; open?: boolean }) {
  const { firstPeriod, lastPeriod, granularity } = insight;
  const range = firstPeriod && lastPeriod ? firstPeriod === lastPeriod ? shortPeriod(firstPeriod, granularity) : `${shortPeriod(firstPeriod, granularity)} – ${shortPeriod(lastPeriod, granularity)}` : null;
  return <details open={open} className="group/insight rounded-md border bg-background/70">
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
      <span aria-hidden="true" className="transition-transform group-open/insight:rotate-90">▸</span>
      <span className="font-medium text-foreground">{dateTime(insight.createdAt)}</span>
      <span>por {granularity === "month" ? "meses" : "semanas"}{range ? ` · ${range}` : ""}</span>
    </summary>
    <div className="border-t px-3 py-2 text-sm"><AssistantMarkdown text={insight.text} />{!insight.verified ? <p className="mt-2 text-xs text-muted-foreground">Algunas cifras no se pudieron verificar contra el análisis; tómalas como referencia.</p> : null}</div>
  </details>;
}

const LINE_TYPE_LABEL: Record<string, string> = { insumo: "Insumo", "mano de obra": "Mano de obra", "gasto compartido": "Gasto compartido" };
const decimal = (value: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(value);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Pick a day and see every product's cost as it stood then: what it is made of at a glance, and line by line. */
function CostsAtCard({ currency, demo, money }: { currency: string; demo: boolean; money: Format }) {
  const today = React.useMemo(() => new Date().toLocaleDateString("en-CA"), []);
  const [date, setDate] = React.useState(today);
  const [fetched, setFetched] = React.useState<CostsAt | null>(null);
  const valid = ISO_DAY.test(date);
  const demoData = React.useMemo(() => demo && valid ? costsAt(demoHistory(), date, { currency }) : null, [demo, valid, date, currency]);
  const data = demo ? demoData : fetched;
  const stale = !demo && fetched?.date !== date;

  React.useEffect(() => {
    if (demo || !valid) return;
    let active = true;
    fetch(`/api/analysis/at?date=${date}`, { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error((await response.json()).error ?? "No se pudo cargar esa fecha"); return response.json() as Promise<CostsAt>; })
      .then((result) => { if (active) setFetched(result); })
      .catch((error) => { if (active) toast.error(error instanceof Error ? error.message : "No se pudo cargar esa fecha"); });
    return () => { active = false; };
  }, [demo, valid, date]);

  return <ChartCard title="Costos en una fecha" description="Cómo estaba el costo de cada producto al cierre del día elegido: de qué está hecho, cada insumo con su consumo y precio, la mano de obra y la parte de cada gasto compartido."
    action={<DatePicker value={date} max={today} today={today} onChange={setDate} aria-label="Fecha" className="w-40" />}>
    <div className={cn("flex flex-col gap-3 transition-opacity", stale && "opacity-60")}>
      {!data ? <TextShimmer className="text-sm">Buscando cómo estaban tus costos ese día…</TextShimmer>
        : !data.products.length ? <p className="text-sm text-muted-foreground">No hay registros de costos hasta esa fecha. Se guarda uno cada vez que se confirma un cambio.</p>
        : <>
          {data.monthlyProductionCost !== null ? <p className="text-sm text-muted-foreground">Costo total de producción del mes a esa fecha: <span className="font-semibold tabular-nums text-foreground">{money(data.monthlyProductionCost)}</span></p> : null}
          <div className="flex flex-col gap-2">
            {data.products.map((product) => {
              const byType = (["insumo", "mano de obra", "gasto compartido"] as const).map((type) => ({ key: type, label: LINE_TYPE_LABEL[type], value: product.lines.filter((line) => line.type === type).reduce((sum, line) => sum + line.perUnit, 0), color: TYPE_COLOR[type] }));
              return <details key={product.productId} className="group/product rounded-xl border bg-background/60">
                <summary className="flex cursor-pointer list-none flex-col gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2"><span aria-hidden="true" className="text-xs text-muted-foreground transition-transform group-open/product:rotate-90">▸</span><span className="font-medium">{product.name}</span>{product.incomplete ? <Badge variant="outline">Incompleto</Badge> : null}</span>
                    <span className="text-sm tabular-nums">{product.unitCost !== null ? <><span className="font-semibold">{money(product.unitCost)}</span><span className="text-muted-foreground"> por unidad</span></> : <span className="text-muted-foreground">Sin costo completo</span>}</span>
                  </span>
                  <ProportionBar parts={byType} format={money} height={8} label={`De qué estaba hecho el costo de ${product.name}`} />
                </summary>
                <div className="flex flex-col gap-2 border-t px-3 py-3">
                  <p className="text-xs text-muted-foreground">
                    Lote de {decimal(product.lotUnits)} unidades{product.lotsPerMonth !== null ? ` · ${decimal(product.lotsPerMonth)} lotes al mes` : ""}{product.lotCost !== null ? ` · costo del lote ${money(product.lotCost)}` : ""}{product.monthlyCost !== null ? ` · ${money(product.monthlyCost)} al mes` : ""} · registrado el {dateTime(product.snapshotAt)}
                  </p>
                  {product.warnings.length ? <ul className="flex flex-col gap-0.5 text-xs text-amber-700 dark:text-amber-400">{product.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow><TableHead>Concepto</TableHead><TableHead>Tipo</TableHead><TableHead>Consumo por lote</TableHead><TableHead className="text-right">Por lote</TableHead><TableHead className="text-right">Por unidad</TableHead></TableRow></TableHeader>
                    <TableBody>{product.lines.map((line, index) => <TableRow key={`${line.label}-${index}`}>
                      <TableCell className="font-medium"><span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: TYPE_COLOR[line.type] }} aria-hidden="true" />{line.label}<div className="text-xs font-normal text-muted-foreground">{line.category}</div></TableCell>
                      <TableCell className="text-muted-foreground">{LINE_TYPE_LABEL[line.type] ?? line.type}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{line.quantityPerLot !== undefined ? `${decimal(line.quantityPerLot)} ${line.unit ?? ""}${line.unitPrice != null ? ` × ${money(line.unitPrice)}` : ""}` : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(line.perLot)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(line.perUnit)}</TableCell>
                    </TableRow>)}</TableBody>
                  </Table></div>
                </div>
              </details>;
            })}
          </div>
          {data.expenses.length ? <p className="text-xs text-muted-foreground">Gastos mensuales vigentes: {data.expenses.map((expense) => `${expense.name} ${money(expense.monthlyAmount)} (reparto por ${expense.splitBy})`).join(" · ")}</p> : null}
        </>}
    </div>
  </ChartCard>;
}
