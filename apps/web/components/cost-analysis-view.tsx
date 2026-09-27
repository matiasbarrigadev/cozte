"use client";

import * as React from "react";
import { toast } from "sonner";
import { analyzeCosts, costsAt, groupComponents, type CostAnalysis, type CostsAt, type Granularity, type Insight } from "@/lib/cost-analysis";
import { demoHistory } from "@/lib/demo";
import { TimeLineChart, type TimeSeries } from "@/components/charts/time-line-chart";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";

const SERIES_COLORS = Array.from({ length: 8 }, (_, index) => `var(--chart-series-${index + 1})`);
type GroupBy = "type" | "category" | "concept";

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (value: T) => void; label: string }) {
  return <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
    {options.map(([key, text]) => <button key={key} type="button" role="radio" aria-checked={value === key} onClick={() => onChange(key)}
      className={cn("rounded-md px-2.5 py-1 font-medium transition-colors", value === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{text}</button>)}
  </div>;
}

/** Up to eight named series keep their fixed color; the rest fold into "Otros" instead of generating new hues. */
function foldSeries(periods: string[], rows: Record<string, number>[], extra?: TimeSeries): TimeSeries[] {
  const totals = new Map<string, number>();
  for (const row of rows) for (const [label, value] of Object.entries(row)) totals.set(label, (totals.get(label) ?? 0) + value);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
  const kept = ranked.length > 8 ? ranked.slice(0, 7) : ranked;
  const series: TimeSeries[] = kept.map((label, index) => ({ key: label, label, color: SERIES_COLORS[index], values: periods.map((_, position) => rows[position]?.[label] ?? null) }));
  if (ranked.length > 8) series.push({ key: "otros", label: "Otros", color: SERIES_COLORS[7], values: periods.map((_, position) => {
    const row = rows[position];
    return row ? Object.entries(row).filter(([label]) => !kept.includes(label)).reduce((sum, [, value]) => sum + value, 0) : null;
  }) });
  return extra ? [...series, extra] : series;
}

function InsightRow({ insight }: { insight: Insight }) {
  const tone = insight.severity === "risk" ? { label: "Riesgo", className: "border-destructive/40 text-destructive" } : insight.severity === "warning" ? { label: "Atención", className: "border-amber-500/50 text-amber-700 dark:text-amber-400" } : { label: "Dato", className: "text-muted-foreground" };
  return <li className="flex flex-col gap-1 rounded-lg border bg-background/60 p-3">
    <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={tone.className}>{tone.label}</Badge><span className="text-sm font-medium">{insight.title}</span></div>
    <p className="text-sm text-muted-foreground">{insight.detail}</p>
  </li>;
}

export function CostAnalysisView({ currency, demo }: { currency: string; demo: boolean }) {
  const [granularity, setGranularity] = React.useState<Granularity>("month");
  const [groupBy, setGroupBy] = React.useState<GroupBy>("category");
  const [display, setDisplay] = React.useState<"chart" | "table">("chart");
  const [productId, setProductId] = React.useState<string>("");
  const [loaded, setLoaded] = React.useState<{ granularity: Granularity; analysis: CostAnalysis } | null>(null);
  // The demo analyzes an example history in the browser; real workspaces fetch their own snapshots.
  const demoAnalysis = React.useMemo(() => demo ? analyzeCosts(demoHistory(), { granularity, currency }) : null, [demo, granularity, currency]);
  const analysis = demo ? demoAnalysis : loaded?.analysis ?? null;
  // Refetch keeps the previous render (dimmed) until the new slice arrives.
  const loading = !demo && loaded?.granularity !== granularity;
  const [insights, setInsights] = React.useState<SavedInsight[]>([]);
  const [aiLoading, setAiLoading] = React.useState(false);

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

  const money = React.useCallback((value: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: value < 100 ? 1 : 0 }).format(value), []);
  const periodLabel = React.useCallback((period: string) => {
    const date = new Date(`${period.length === 7 ? `${period}-01` : period}T12:00:00Z`);
    return granularity === "month"
      ? new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(date)
      : `Sem. ${new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }).format(date)}`;
  }, [granularity]);

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
  const selected = products.find((product) => product.id === productId) ?? products[0];
  const periods = analysis?.periods ?? [];
  const unitSeries: TimeSeries[] = products.slice(0, 8).map((product, index) => ({ key: product.id, label: product.name, color: SERIES_COLORS[index], values: periods.map((period) => product.points.find((point) => point.period === period && !point.incomplete)?.unitCost ?? null) }));
  const compositionRows = selected ? periods.map((period) => {
    const point = selected.points.find((entry) => entry.period === period && !entry.incomplete);
    return point ? groupComponents(point, analysis!.components, groupBy) : {};
  }) : [];
  const compositionSeries = selected ? foldSeries(periods, compositionRows, { key: "total", label: "Costo total por unidad", color: "var(--foreground)", emphasis: true, values: periods.map((period) => selected.points.find((point) => point.period === period && !point.incomplete)?.unitCost ?? null) }) : [];
  const totalSeries: TimeSeries[] = [{ key: "total", label: "Costo total de producción del mes", color: SERIES_COLORS[0], values: (analysis?.totals ?? []).map((total) => total.monthlyProductionCost) }];
  const drivers = selected?.change?.drivers.slice(0, 6) ?? [];
  const maxDriver = Math.max(1, ...drivers.map((driver) => Math.abs(driver.delta)));

  return <>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-sm text-muted-foreground">Evolución</p><h1 className="text-3xl font-semibold tracking-tight">Análisis de costos</h1><p className="max-w-2xl text-sm text-muted-foreground">Cómo cambió el costo de fabricar cada producto, qué lo explica y qué conviene vigilar. Se arma con las fotos que guarda cada cambio confirmado{demo ? " (en la demostración, con un historial de ejemplo)" : ""}.</p></div>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Segmented label="Agrupar el tiempo" value={granularity} onChange={setGranularity} options={[["month", "Meses"], ["week", "Semanas"]]} />
      <Segmented label="Agrupar los costos" value={groupBy} onChange={setGroupBy} options={[["type", "Tipo"], ["category", "Categoría"], ["concept", "Concepto"]]} />
      <Segmented label="Mostrar como" value={display} onChange={setDisplay} options={[["chart", "Gráficos"], ["table", "Tabla"]]} />
    </div>
    {loading && !analysis ? <TextShimmer className="text-sm">Preparando el análisis…</TextShimmer> : null}
    {analysis ? <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {products.map((product) => {
          const latest = [...product.points].reverse().find((point) => point.unitCost !== null && !point.incomplete);
          return <Card key={product.id}><CardHeader><CardDescription>{product.name} · costo por unidad</CardDescription><CardTitle className="text-3xl tabular-nums">{latest?.unitCost != null ? `${currency} ${money(latest.unitCost)}` : "Incompleto"}</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">{product.change ? <span><span className={cn("font-medium", product.change.delta > 0 ? "text-foreground" : "text-foreground")}>{product.change.delta > 0 ? "▲" : product.change.delta < 0 ? "▼" : "="} {product.change.deltaPercent > 0 ? "+" : ""}{new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(product.change.deltaPercent)} %</span> desde el primer período ({currency} {money(product.change.from)})</span> : "Sin cambios registrados todavía"}</CardContent></Card>;
        })}
      </div>

      <Card><CardHeader><CardTitle>Conclusiones</CardTitle><CardDescription>Lo que muestran los datos, calculado por el motor. Cozte puede redactarte un análisis con mejoras y riesgos.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {analysis.insights.length ? <ul className="flex flex-col gap-2">{analysis.insights.slice(0, 8).map((insight, index) => <InsightRow key={index} insight={insight} />)}</ul> : <p className="text-sm text-muted-foreground">No hay alertas por ahora.</p>}
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">Análisis de Cozte</span><Button size="sm" variant={insights.length ? "outline" : "default"} disabled={demo || aiLoading || analysis.snapshotCount === 0} onClick={() => void generate()}>{aiLoading ? "Analizando…" : insights.length ? "Generar uno nuevo" : "Generar conclusiones"}</Button></div>
            {aiLoading ? <TextShimmer className="text-sm">Cozte está leyendo la evolución de tus costos…</TextShimmer> : null}
            {insights[0] ? <SavedInsightView insight={insights[0]} open /> : demo ? <p className="text-xs text-muted-foreground">En la demostración no se generan conclusiones; en tu espacio quedan guardadas para revisarlas cuando quieras.</p> : null}
            {insights.length > 1 ? <details className="group/history rounded-md border bg-background/60">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="text-xs transition-transform group-open/history:rotate-90">▸</span>Conclusiones anteriores ({insights.length - 1})</summary>
              <div className="flex flex-col gap-2 border-t p-3">{insights.slice(1).map((insight) => <SavedInsightView key={insight.id} insight={insight} />)}</div>
            </details> : null}
          </div>
        </CardContent>
      </Card>

      <CostsAtCard currency={currency} demo={demo} money={money} />

      <Card><CardHeader><CardTitle>Costo por unidad de cada producto</CardTitle><CardDescription>Última foto de cada {granularity === "month" ? "mes" : "semana"}; si no hubo cambios se mantiene el costo anterior.</CardDescription></CardHeader>
        <CardContent>{display === "chart" ? <TimeLineChart periods={periods} periodLabel={periodLabel} series={unitSeries} formatValue={money} ariaLabel="Costo por unidad de cada producto en el tiempo" /> : <DataTable periods={periods} periodLabel={periodLabel} series={unitSeries} format={money} />}</CardContent></Card>

      {selected ? <Card><CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3"><div className="flex flex-col gap-1.5"><CardTitle>Composición del costo por unidad</CardTitle><CardDescription>Cómo evolucionó cada {groupBy === "type" ? "tipo de costo" : groupBy === "category" ? "categoría" : "concepto"} y cuánto suma al total.</CardDescription></div>
          <Dropdown aria-label="Producto" value={selected.id} onChange={(event) => setProductId(event.target.value)}>{products.map((product) => <DropdownOption key={product.id} value={product.id}>{product.name}</DropdownOption>)}</Dropdown></CardHeader>
        <CardContent>{display === "chart" ? <TimeLineChart periods={periods} periodLabel={periodLabel} series={compositionSeries} formatValue={money} ariaLabel={`Composición del costo de ${selected.name} en el tiempo`} /> : <DataTable periods={periods} periodLabel={periodLabel} series={compositionSeries} format={money} />}</CardContent></Card> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Costo total de producción del mes</CardTitle><CardDescription>Suma de todos los productos: costo del lote × lotes al mes. Aparece cuando todos tienen volumen mensual.</CardDescription></CardHeader>
          <CardContent>{totalSeries[0].values.some((value) => value !== null) ? display === "chart" ? <TimeLineChart periods={periods} periodLabel={periodLabel} series={totalSeries} formatValue={money} ariaLabel="Costo total de producción por mes" /> : <DataTable periods={periods} periodLabel={periodLabel} series={totalSeries} format={money} /> : <p className="text-sm text-muted-foreground">Falta el volumen mensual de algún producto para sumar el total.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Qué explica el cambio{selected ? ` de ${selected.name}` : ""}</CardTitle><CardDescription>Diferencia por unidad entre el primer y el último período.</CardDescription></CardHeader>
          <CardContent>{drivers.length ? <ul className="flex flex-col gap-2.5" aria-label="Variación por concepto">{drivers.map((driver) => <li key={driver.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-muted-foreground" title={driver.label}>{driver.label}</span>
            <span className="relative h-3 rounded-full bg-muted"><span className="absolute top-0 h-3 rounded-full" style={{ width: `${Math.max(4, Math.abs(driver.delta) / maxDriver * 100)}%`, background: driver.delta > 0 ? "var(--chart-increase)" : "var(--chart-decrease)" }} /></span>
            <span className="font-medium tabular-nums">{driver.delta > 0 ? "+" : "−"}{currency} {money(Math.abs(driver.delta))}</span>
          </li>)}</ul> : <p className="text-sm text-muted-foreground">Todavía no hay dos períodos con costo completo para comparar.</p>}</CardContent></Card>
      </div>
    </div> : null}
  </>;
}

function DataTable({ periods, periodLabel, series, format }: { periods: string[]; periodLabel: (period: string) => string; series: TimeSeries[]; format: (value: number) => string }) {
  return <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Serie</TableHead>{periods.map((period) => <TableHead key={period} className="text-right">{periodLabel(period)}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{series.map((item) => <TableRow key={item.key}><TableCell className="font-medium">{item.label}</TableCell>{item.values.map((value, index) => <TableCell key={index} className="text-right tabular-nums">{value === null ? "—" : format(value)}</TableCell>)}</TableRow>)}</TableBody></Table></div>;
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

/** Pick a day and see every product's cost as it stood then, line by line. */
function CostsAtCard({ currency, demo, money }: { currency: string; demo: boolean; money: (value: number) => string }) {
  const today = React.useMemo(() => new Date().toISOString().slice(0, 10), []);
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

  return <Card>
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
      <div className="flex max-w-2xl flex-col gap-1.5"><CardTitle>Costos en una fecha</CardTitle><CardDescription>Cómo estaba el costo de cada producto al cierre del día elegido: cada insumo con su consumo y precio, la mano de obra y la parte de cada gasto compartido.</CardDescription></div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">Fecha<Input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} className="w-auto" /></label>
    </CardHeader>
    <CardContent className={cn("flex flex-col gap-3 transition-opacity", stale && "opacity-60")}>
      {!data ? <TextShimmer className="text-sm">Buscando cómo estaban tus costos ese día…</TextShimmer>
        : !data.products.length ? <p className="text-sm text-muted-foreground">No hay registros de costos hasta esa fecha. Se guarda uno cada vez que se confirma un cambio.</p>
        : <>
          {data.monthlyProductionCost !== null ? <p className="text-sm text-muted-foreground">Costo total de producción del mes a esa fecha: <span className="font-semibold tabular-nums text-foreground">{currency} {money(data.monthlyProductionCost)}</span></p> : null}
          <div className="flex flex-col gap-2">
            {data.products.map((product) => <details key={product.productId} className="group/product rounded-lg border bg-background/60">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2"><span aria-hidden="true" className="text-xs text-muted-foreground transition-transform group-open/product:rotate-90">▸</span><span className="font-medium">{product.name}</span>{product.incomplete ? <Badge variant="outline">Incompleto</Badge> : null}</span>
                <span className="text-sm tabular-nums">{product.unitCost !== null ? <><span className="font-semibold">{currency} {money(product.unitCost)}</span><span className="text-muted-foreground"> por unidad</span></> : <span className="text-muted-foreground">Sin costo completo</span>}</span>
              </summary>
              <div className="flex flex-col gap-2 border-t px-3 py-3">
                <p className="text-xs text-muted-foreground">
                  Lote de {decimal(product.lotUnits)} unidades{product.lotsPerMonth !== null ? ` · ${decimal(product.lotsPerMonth)} lotes al mes` : ""}{product.lotCost !== null ? ` · costo del lote ${currency} ${money(product.lotCost)}` : ""}{product.monthlyCost !== null ? ` · ${currency} ${money(product.monthlyCost)} al mes` : ""} · registrado el {dateTime(product.snapshotAt)}
                </p>
                {product.warnings.length ? <ul className="flex flex-col gap-0.5 text-xs text-amber-700 dark:text-amber-400">{product.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
                <div className="overflow-x-auto"><Table>
                  <TableHeader><TableRow><TableHead>Concepto</TableHead><TableHead>Tipo</TableHead><TableHead>Consumo por lote</TableHead><TableHead className="text-right">Por lote</TableHead><TableHead className="text-right">Por unidad</TableHead></TableRow></TableHeader>
                  <TableBody>{product.lines.map((line, index) => <TableRow key={`${line.label}-${index}`}>
                    <TableCell className="font-medium">{line.label}<div className="text-xs font-normal text-muted-foreground">{line.category}</div></TableCell>
                    <TableCell className="text-muted-foreground">{LINE_TYPE_LABEL[line.type] ?? line.type}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{line.quantityPerLot !== undefined ? `${decimal(line.quantityPerLot)} ${line.unit ?? ""}${line.unitPrice != null ? ` × ${currency} ${money(line.unitPrice)}` : ""}` : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(line.perLot)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(line.perUnit)}</TableCell>
                  </TableRow>)}</TableBody>
                </Table></div>
              </div>
            </details>)}
          </div>
          {data.expenses.length ? <p className="text-xs text-muted-foreground">Gastos mensuales vigentes: {data.expenses.map((expense) => `${expense.name} ${currency} ${money(expense.monthlyAmount)} (reparto por ${expense.splitBy})`).join(" · ")}</p> : null}
        </>}
    </CardContent>
  </Card>;
}
