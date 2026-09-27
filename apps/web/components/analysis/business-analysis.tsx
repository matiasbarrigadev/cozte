"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AREA_LABELS, PURCHASE_KIND_LABELS, buildBusinessView } from "@/lib/business";
import { analysisInsights, change, monthsBack, summarizeMonth, type BusinessAnalysis, type MonthSummary } from "@/lib/business-analytics";
import { COST_AREAS, type DomainState } from "@/lib/domain";
import type { DeliveryTally } from "@/lib/delivery-zones";
import { DEMO_MONTH, DEMO_TODAY, demoHistorySales } from "@/lib/demo";
import { demoRecords } from "@/lib/demo-store";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { CostAnalysisView } from "@/components/cost-analysis-view";
import { useDemoVersion, useMoney } from "@/components/business/business-ui";
import { usePersistentState } from "@/components/business/data-table";
import { cn } from "@/lib/utils";
import { ChartCard, DATA_COLORS, FlowChart, Legend, LineChart, MonthBars, RadarChart, Sparkline, StackedBars, Treemap, deltaText, longMonth, shortMonth, useCompactMoney, type Format } from "./charts";

/**
 * The whole business month by month: sales, what each sale cost, the structure, the result and the deliveries, with
 * charts that answer on hover and a month that can be picked in any of them. Numbers come from the same engine as
 * every section; nothing here is estimated by a model.
 */

const RANGES = ["3", "6", "12"] as const;
const TABS = ["resumen", "ventas", "costos", "gastos", "entregas"] as const;
const WEEKDAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

function useAnalysis(state: DomainState, demo: boolean, count: number): { data: BusinessAnalysis | null; error: string | null } {
  const demoChanges = useDemoVersion(demo);
  const [loaded, setLoaded] = React.useState<{ key: string; data: BusinessAnalysis | null; error: string | null }>({ key: "", data: null, error: null });
  const key = `${count}:${state.revision}:${demoChanges}`;
  const demoData = React.useMemo(() => {
    if (!demo) return null;
    const records = demoRecords();
    const withHistory = { ...records, sales: [...demoHistorySales(), ...records.sales] };
    return { currency: state.organization.currency, today: DEMO_TODAY, months: monthsBack(DEMO_MONTH, count).map((month) => summarizeMonth(buildBusinessView(state, withHistory, month), month, DEMO_TODAY)) };
  }, [demo, state, count, demoChanges]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (demo) return;
    let active = true;
    fetch(`/api/analysis/business?months=${count}`, { cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo cargar el análisis"); return body as BusinessAnalysis; })
      .then((data) => { if (active) setLoaded({ key, data, error: null }); })
      .catch((error: unknown) => { if (active) setLoaded({ key, data: null, error: error instanceof Error ? error.message : "No se pudo cargar el análisis" }); });
    return () => { active = false; };
  }, [demo, count, key]);
  if (demo) return { data: demoData, error: null };
  // While a new range loads, the previous one stays on screen.
  return { data: loaded.data, error: loaded.key === key || !loaded.data ? loaded.error : null };
}


export function BusinessAnalysisView({ state, demo }: { state: DomainState; demo: boolean }) {
  const [range, setRange] = usePersistentState<string>("analisis:rango", "6", RANGES);
  const [tab, setTab] = usePersistentState<string>("analisis:pestana", "resumen", TABS);
  const count = Number(range);
  const { data, error } = useAnalysis(state, demo, count);
  const money = useMoney(state.organization.currency);
  const compact = useCompactMoney(state.organization.currency);
  const months = data?.months ?? [];
  const [chosen, setChosen] = React.useState<string | null>(null);
  const focus = Math.max(0, chosen ? months.findIndex((item) => item.month === chosen) : months.length - 1);
  const pick = (index: number) => setChosen(months[index]?.month ?? null);
  const current = months[focus];

  return <div className="flex flex-col gap-5">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <p className="text-sm text-muted-foreground">Evolución</p>
        <h1 className="text-3xl font-semibold tracking-tight">Análisis del negocio</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ventas, costos, gastos y entregas mes a mes: cómo evolucionan, dónde se va la plata y qué cambió. Pasa el mouse por los gráficos para ver el detalle y haz clic en un mes para mirarlo.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label="Meses a mirar">
          {RANGES.map((value) => <button key={value} type="button" onClick={() => { setRange(value); setChosen(null); }} aria-pressed={range === value}
            className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", range === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{value} meses</button>)}
        </div>
        {current ? <div className="inline-flex items-center gap-1 rounded-lg border bg-card p-0.5 text-xs" aria-label="Mes que estás mirando">
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Mes anterior" disabled={focus === 0} onClick={() => pick(focus - 1)}><ChevronLeft /></Button>
          <span className="min-w-28 text-center font-medium capitalize">{longMonth(current.month)}</span>
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Mes siguiente" disabled={focus === months.length - 1} onClick={() => pick(focus + 1)}><ChevronRight /></Button>
        </div> : null}
      </div>
    </div>

    <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
      <TabsList variant="line" aria-label="Qué analizar" className="max-w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
        <TabsTrigger value="resumen">Resumen</TabsTrigger>
        <TabsTrigger value="ventas">Ventas</TabsTrigger>
        <TabsTrigger value="costos">Costos</TabsTrigger>
        <TabsTrigger value="gastos">Gastos</TabsTrigger>
        <TabsTrigger value="entregas">Entregas</TabsTrigger>
      </TabsList>
      {tab !== "costos" && !data ? error ? <p className="mt-6 text-sm text-destructive">{error}</p> : <TextShimmer className="mt-6 text-sm">Preparando el análisis…</TextShimmer> : null}
      {data && current ? <>
        <TabsContent value="resumen" className="mt-4"><SummaryTab months={months} focus={focus} onFocus={pick} money={money} compact={compact} /></TabsContent>
        <TabsContent value="ventas" className="mt-4"><SalesTab months={months} focus={focus} onFocus={pick} money={money} compact={compact} /></TabsContent>
        <TabsContent value="gastos" className="mt-4"><ExpensesTab months={months} focus={focus} onFocus={pick} money={money} compact={compact} /></TabsContent>
        <TabsContent value="entregas" className="mt-4"><DeliveriesTab months={months} focus={focus} onFocus={pick} money={money} compact={compact} /></TabsContent>
      </> : null}
      <TabsContent value="costos" className="mt-4 flex flex-col gap-6"><CostAnalysisView currency={state.organization.currency} demo={demo} embedded /></TabsContent>
    </Tabs>
  </div>;
}

type TabProps = { months: MonthSummary[]; focus: number; onFocus: (index: number) => void; money: Format; compact: Format };

/** A figure of the month with its change from the previous one and its line across the months. */
function KpiCard({ label, values, focus, money, color, goodWhenUp = true, note }: { label: string; values: number[]; focus: number; money: Format; color: string; goodWhenUp?: boolean; note?: string }) {
  const value = values[focus] ?? 0;
  const previous = focus > 0 ? values[focus - 1] : null;
  const ratio = change(value, previous);
  const good = ratio === null ? null : (ratio >= 0) === goodWhenUp;
  return <div className="flex min-w-0 flex-col gap-2 rounded-2xl border bg-card p-4 shadow-xs">
    <div className="flex items-start justify-between gap-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {ratio !== null ? Math.round(ratio * 100) === 0 ? <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">= igual</span> : <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", good ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-700 dark:text-red-400")}>{ratio >= 0 ? "↑" : "↓"} {Math.abs(Math.round(ratio * 100))} %</span> : null}
    </div>
    <p className={cn("text-2xl font-semibold tracking-tight tabular-nums", value < 0 && "text-destructive")}>{money(value)}</p>
    <p className="text-[11px] text-muted-foreground">{previous !== null ? `Frente a ${money(previous)} el mes anterior` : note ?? "Primer mes del período"}</p>
    <Sparkline values={values} focus={focus} color={color} label={`${label} mes a mes`} />
  </div>;
}

function Insights({ months, focus, money }: { months: MonthSummary[]; focus: number; money: Format }) {
  const items = analysisInsights(months, focus, money);
  return <ul className="flex flex-col gap-2">
    {items.map((item, index) => <li key={index} className="flex items-start gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.tone === "good" ? "bg-emerald-500" : item.tone === "bad" ? "bg-red-500" : "bg-muted-foreground/60")} aria-hidden="true" />
      <span>{item.text}</span>
    </li>)}
  </ul>;
}

function SummaryTab({ months, focus, onFocus, money, compact }: TabProps) {
  const labels = months.map((item) => item.month);
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const layers = [
    { key: "production", label: "Producir lo vendido", color: DATA_COLORS[0], values: months.map((item) => item.production) },
    { key: "selling", label: "Comisiones y cargos", color: DATA_COLORS[1], values: months.map((item) => item.selling) },
    { key: "delivery", label: "Entregas", color: DATA_COLORS[3], values: months.map((item) => item.delivery) },
    { key: "fixed", label: "Gastos fijos", color: DATA_COLORS[4], values: months.map((item) => item.fixed) },
    { key: "result", label: "Te quedó", color: DATA_COLORS[2], values: months.map((item) => Math.max(0, item.result)) },
  ];
  const toggle = (key: string) => setHidden((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  return <div className="flex flex-col gap-4">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Ventas" values={months.map((item) => item.revenue)} focus={focus} money={money} color={DATA_COLORS[0]} />
      <KpiCard label="Te dejaron las ventas" values={months.map((item) => item.contribution)} focus={focus} money={money} color={DATA_COLORS[3]} />
      <KpiCard label="Gastos fijos" values={months.map((item) => item.fixed)} focus={focus} money={money} color={DATA_COLORS[4]} goodWhenUp={false} />
      <KpiCard label="Resultado" values={months.map((item) => item.result)} focus={focus} money={money} color={DATA_COLORS[2]} />
    </div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <ChartCard title="A dónde va la plata de las ventas" description="Cada mes, lo que vendiste repartido en lo que costó producir, vender y entregar, los gastos fijos y lo que te quedó."
        legend={<Legend items={layers} hidden={hidden} onToggle={toggle} />}
        table={{ columns: ["Mes", "Ventas", ...layers.map((layer) => layer.label), "Resultado"], rows: months.map((item) => [longMonth(item.month), money(item.revenue), money(item.production), money(item.selling), money(item.delivery), money(item.fixed), money(Math.max(0, item.result)), money(item.result)]) }}>
        <FlowChart months={labels} layers={layers.filter((layer) => !hidden.has(layer.key))} focus={focus} onFocus={onFocus} format={money} label="Reparto de las ventas mes a mes"
          top={(index) => compact(months[index].revenue)}
          bottom={(index) => months[index].revenue || months[index].fixed ? { text: months[index].result >= 0 ? `+${compact(months[index].result)}` : compact(months[index].result), tone: months[index].result < 0 ? "negative" : undefined } : null} />
        <p className="text-[11px] text-muted-foreground">Arriba, lo vendido en el mes; abajo, lo que quedó (en rojo si fue pérdida).</p>
      </ChartCard>
      <ChartCard title={`Lo que se destaca en ${longMonth(months[focus].month).split(" ")[0]}`} description="Calculado con tus números.">
        <Insights months={months} focus={focus} money={money} />
        <BreakEven month={months[focus]} money={money} />
      </ChartCard>
    </div>
  </div>;
}

function BreakEven({ month, money }: { month: MonthSummary; money: Format }) {
  if (!month.breakEven) return null;
  const progress = Math.min(100, Math.round((month.revenue / month.breakEven) * 100));
  return <div className="mt-1 flex flex-col gap-1.5 rounded-xl border p-3">
    <div className="flex items-baseline justify-between text-xs"><span className="font-medium">Punto de equilibrio</span><span className="tabular-nums text-muted-foreground">{progress} %</span></div>
    <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Avance hacia el punto de equilibrio">
      <div className={cn("h-full rounded-full transition-all duration-500", progress >= 100 ? "bg-[var(--data-3)]" : "bg-[var(--data-5)]")} style={{ width: `${progress}%` }} />
    </div>
    <p className="text-[11px] text-muted-foreground">{progress >= 100 ? `Se superó: con ${money(month.breakEven)} ya no se perdía.` : `Faltaron ${money(month.breakEven - month.revenue)} para no perder.`}</p>
  </div>;
}

/** Stable colors for keys (channels, products) across months: the order of first appearance. */
function useKeyColors(months: MonthSummary[], pick: (month: MonthSummary) => { key: string }[]) {
  return React.useMemo(() => {
    const totals = new Map<string, number>();
    for (const month of months) for (const [index, item] of pick(month).entries()) totals.set(item.key, (totals.get(item.key) ?? 0) + (pick(month).length - index));
    const keys = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
    return (key: string) => DATA_COLORS[Math.max(0, keys.indexOf(key)) % DATA_COLORS.length];
  }, [months]); // eslint-disable-line react-hooks/exhaustive-deps
}

function SalesTab({ months, focus, onFocus, money, compact }: TabProps) {
  const labels = months.map((item) => item.month);
  const current = months[focus];
  const previous = focus > 0 ? months[focus - 1] : undefined;
  const channelColor = useKeyColors(months, (month) => month.byChannel);
  const productColor = useKeyColors(months, (month) => month.byProduct);
  const channels = [...new Map(months.flatMap((month) => month.byChannel.map((item) => [item.key, item.name] as const))).entries()];
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const channelLayers = channels.map(([key, name]) => ({ key, label: name, color: channelColor(key), values: months.map((month) => month.byChannel.find((item) => item.key === key)?.revenue ?? 0) }));
  const ticket = current.sales ? current.revenue / current.sales : 0;
  return <div className="flex flex-col gap-4">
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <ChartCard title="Ventas de cada mes" description="Haz clic en una barra para mirar ese mes en todo el análisis." table={{ columns: ["Mes", "Ventas", "Ventas registradas", "Unidades"], rows: months.map((item) => [longMonth(item.month), money(item.revenue), item.sales, Math.round(item.units)]) }}>
        <MonthBars months={labels} values={months.map((item) => item.revenue)} focus={focus} onFocus={onFocus} format={money} compact={compact} label="Ventas por mes" />
      </ChartCard>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <MiniStat label="Ventas registradas" value={String(current.sales)} delta={previous ? change(current.sales, previous.sales) : null} />
        <MiniStat label="Unidades vendidas" value={new Intl.NumberFormat("es-AR").format(Math.round(current.units))} delta={previous ? change(current.units, previous.units) : null} />
        <MiniStat label="Venta promedio" value={current.sales ? money(ticket) : "—"} delta={previous?.sales && current.sales ? change(ticket, previous.revenue / previous.sales) : null} />
        <MiniStat label="Mejor día" value={current.revenue ? WEEKDAYS[current.byWeekday.indexOf(Math.max(...current.byWeekday))] : "—"} note={current.revenue ? money(Math.max(...current.byWeekday)) : undefined} />
      </div>
    </div>
    <ChartCard title="Por dónde entran las ventas" description="Lo vendido en cada canal, mes a mes. Toca un canal en la leyenda para ocultarlo."
      legend={<Legend items={channelLayers} hidden={hidden} onToggle={(key) => setHidden((currentSet) => { const next = new Set(currentSet); if (next.has(key)) next.delete(key); else next.add(key); return next; })} />}
      table={{ columns: ["Mes", ...channelLayers.map((layer) => layer.label)], rows: months.map((item, index) => [longMonth(item.month), ...channelLayers.map((layer) => money(layer.values[index]))]) }}>
      {channelLayers.length ? <FlowChart months={labels} layers={channelLayers.filter((layer) => !hidden.has(layer.key))} focus={focus} onFocus={onFocus} format={money} label="Ventas por canal mes a mes" height={250}
        top={(index) => compact(months[index].revenue)} bottom={(index) => months[index].sales ? { text: `${months[index].sales} ventas` } : null} /> : <Empty />}
    </ChartCard>
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title={`Qué se vendió en ${shortMonth(current.month)}`} description="Cada bloque es un producto, del tamaño de lo que vendió; el número es su parte del total."
        table={{ columns: ["Producto", "Vendido", "Unidades", "Frente al mes anterior"], rows: current.byProduct.map((item) => { const before = previous?.byProduct.find((entry) => entry.key === item.key)?.revenue; return [item.name, money(item.revenue), Math.round(item.units), before ? deltaText(item.revenue, before) : "—"]; }) }}>
        <Treemap items={current.byProduct.map((item) => ({ key: item.key, label: item.name, value: item.revenue, color: productColor(item.key), detail: `${Math.round(item.units)} unidades`, delta: change(item.revenue, previous?.byProduct.find((entry) => entry.key === item.key)?.revenue) }))} format={money} label="Ventas por producto" height={280} />
      </ChartCard>
      <ChartCard title="Qué días se vende más" description={previous ? `${longMonth(current.month).split(" ")[0]} (relleno) frente a ${longMonth(previous.month).split(" ")[0]} (rayado).` : "Lo vendido cada día de la semana."}
        legend={<Legend items={[{ key: "now", label: shortMonth(current.month), color: DATA_COLORS[0] }, ...(previous ? [{ key: "before", label: shortMonth(previous.month), color: DATA_COLORS[1], dashed: true }] : [])]} />}
        table={{ columns: ["Día", shortMonth(current.month), ...(previous ? [shortMonth(previous.month)] : [])], rows: WEEKDAYS.map((day, index) => [day, money(current.byWeekday[index]), ...(previous ? [money(previous.byWeekday[index])] : [])]) }}>
        {current.revenue || previous?.revenue ? <RadarChart axes={WEEKDAYS} format={money} label="Ventas por día de la semana" height={280}
          series={[{ key: "now", label: shortMonth(current.month), color: DATA_COLORS[0], values: current.byWeekday }, ...(previous ? [{ key: "before", label: shortMonth(previous.month), color: DATA_COLORS[1], values: previous.byWeekday, dashed: true }] : [])]} /> : <Empty />}
      </ChartCard>
    </div>
  </div>;
}

function MiniStat({ label, value, delta, note, goodWhenUp = true }: { label: string; value: string; delta?: number | null; note?: string; goodWhenUp?: boolean }) {
  const same = delta !== undefined && delta !== null && Math.round(delta * 100) === 0;
  const good = delta !== undefined && delta !== null && (delta >= 0) === goodWhenUp;
  return <div className="flex flex-col gap-1 rounded-2xl border bg-card px-4 py-3 shadow-xs">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="text-xl font-semibold tabular-nums">{value}</span>
    {delta !== undefined && delta !== null ? <span className={cn("text-[11px] font-medium tabular-nums", same ? "text-muted-foreground" : good ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>{same ? "Igual que el mes anterior" : `${delta >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(delta * 100))} % frente al mes anterior`}</span> : note ? <span className="text-[11px] text-muted-foreground">{note}</span> : null}
  </div>;
}

const Empty = () => <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">Sin datos en estos meses</p>;

const AREA_COLOR: Record<string, string> = { production: DATA_COLORS[0], delivery: DATA_COLORS[3], sales: DATA_COLORS[1], admin: DATA_COLORS[4] };

function ExpensesTab({ months, focus, onFocus, money, compact }: TabProps) {
  const labels = months.map((item) => item.month);
  const current = months[focus];
  const previous = focus > 0 ? months[focus - 1] : undefined;
  const kinds = ["material", "expense", "fixed_payment", "investment"] as const;
  return <div className="flex flex-col gap-4">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {COST_AREAS.map((area) => <MiniStat key={area} label={`Fijos · ${AREA_LABELS[area]}`} value={money(current.fixedByArea[area])} delta={previous ? change(current.fixedByArea[area], previous.fixedByArea[area]) : null} goodWhenUp={false} />)}
    </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <ChartCard title={`Cómo se reparten los gastos de ${shortMonth(current.month)}`} description="Cada bloque es un gasto del mes, coloreado por área: producción, entregas, ventas o administración."
        legend={<Legend items={COST_AREAS.map((area) => ({ key: area, label: AREA_LABELS[area], color: AREA_COLOR[area] }))} />}
        table={{ columns: ["Gasto", "Área", "Por mes"], rows: current.expenses.map((item) => [item.name, AREA_LABELS[item.area], money(item.amount)]) }}>
        <Treemap items={current.expenses.map((item, index) => ({ key: `${item.area}-${item.name}-${index}`, label: item.name, value: item.amount, color: AREA_COLOR[item.area], group: AREA_LABELS[item.area] }))} format={money} label="Gastos del mes por concepto" height={300} />
      </ChartCard>
      <ChartCard title="¿Las ventas cubren la estructura?" description="Lo que dejaron las ventas contra los gastos fijos de cada mes: cuando la línea verde pasa a la ocre, hay ganancia."
        legend={<Legend items={[{ key: "contribution", label: "Te dejaron las ventas", color: DATA_COLORS[0] }, { key: "fixed", label: "Gastos fijos", color: DATA_COLORS[4], dashed: true }, { key: "revenue", label: "Ventas", color: DATA_COLORS[3] }]} />}
        table={{ columns: ["Mes", "Ventas", "Te dejaron", "Gastos fijos"], rows: months.map((item) => [longMonth(item.month), money(item.revenue), money(item.contribution), money(item.fixed)]) }}>
        <LineChart months={labels} focus={focus} onFocus={onFocus} format={money} compact={compact} label="Ventas, lo que dejaron y gastos fijos por mes" height={260}
          series={[{ key: "revenue", label: "Ventas", color: DATA_COLORS[3], values: months.map((item) => item.revenue) }, { key: "contribution", label: "Te dejaron las ventas", color: DATA_COLORS[0], values: months.map((item) => item.contribution), area: true }, { key: "fixed", label: "Gastos fijos", color: DATA_COLORS[4], values: months.map((item) => item.fixed), dashed: true }]} />
      </ChartCard>
    </div>
    <ChartCard title="Compras de cada mes" description="Lo que salió de la caja en compras, por tipo. Los insumos no son gasto del mes: se vuelven costo cuando se vende lo que producen."
      legend={<Legend items={kinds.map((kind, index) => ({ key: kind, label: PURCHASE_KIND_LABELS[kind], color: DATA_COLORS[[0, 4, 1, 3][index]] }))} />}
      table={{ columns: ["Mes", ...kinds.map((kind) => PURCHASE_KIND_LABELS[kind])], rows: months.map((item) => [longMonth(item.month), ...kinds.map((kind) => money(item.purchases[kind]))]) }}>
      <StackedBars months={labels} focus={focus} onFocus={onFocus} format={compact} label="Compras por tipo y mes" height={220}
        segments={kinds.map((kind, index) => ({ key: kind, label: PURCHASE_KIND_LABELS[kind], color: DATA_COLORS[[0, 4, 1, 3][index]], values: months.map((item) => item.purchases[kind]) }))} />
    </ChartCard>
  </div>;
}

type PerformanceRow = { key: string; name: string } & DeliveryTally;

const OUTCOMES = [
  { key: "onTime", label: "A tiempo", color: DATA_COLORS[0], value: (row: DeliveryTally) => row.onTime },
  { key: "late", label: "Tarde", color: DATA_COLORS[4], value: (row: DeliveryTally) => row.delivered - row.onTime },
  { key: "open", label: "Por entregar", color: DATA_COLORS[3], value: (row: DeliveryTally) => row.open },
  { key: "failed", label: "Con problema", color: DATA_COLORS[5], value: (row: DeliveryTally) => row.failed },
  { key: "cancelled", label: "Cancelada", color: DATA_COLORS[1], value: (row: DeliveryTally) => row.cancelled },
];

/** Each zone or carrier as a row: a bar as long as its deliveries, split by how they went, with its on-time rate and cost. */
function PerformanceRows({ rows, money, empty }: { rows: PerformanceRow[]; money: Format; empty: string }) {
  const [hover, setHover] = React.useState<string | null>(null);
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const most = Math.max(...rows.map((row) => row.total), 1);
  return <ul className="flex flex-col gap-3.5">
    {rows.map((row) => {
      const rate = row.delivered ? row.onTime / row.delivered : null;
      const parts = OUTCOMES.map((outcome) => ({ ...outcome, count: outcome.value(row) })).filter((part) => part.count > 0);
      return <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 items-baseline gap-2"><span className="truncate text-sm font-medium">{row.name}</span><span className="shrink-0 text-xs text-muted-foreground tabular-nums">{row.total} entrega{row.total === 1 ? "" : "s"}</span></div>
        <p className="text-right text-sm font-medium tabular-nums">{rate === null ? "—" : `${Math.round(rate * 100)} %`}<span className="ml-1 text-xs font-normal text-muted-foreground">a tiempo</span></p>
        <div className="flex h-3 min-w-2 gap-0.5" style={{ width: `${Math.max(6, (row.total / most) * 100)}%` }} role="img" aria-label={`${row.name}: ${parts.map((part) => `${part.count} ${part.label.toLowerCase()}`).join(", ")}`}>
          {parts.map((part) => <span key={part.key} onMouseEnter={() => setHover(`${row.key}:${part.key}`)} onMouseLeave={() => setHover(null)} title={`${part.label}: ${part.count}`}
            className={cn("h-full first:rounded-l-[4px] last:rounded-r-[4px] transition-opacity", hover && hover !== `${row.key}:${part.key}` && hover.startsWith(`${row.key}:`) && "opacity-50")} style={{ flexGrow: part.count, background: part.color }} />)}
        </div>
        <p className="text-right text-xs text-muted-foreground tabular-nums">{money(row.cost / Math.max(row.total, 1))} c/u · {money(row.cost)}</p>
      </li>;
    })}
  </ul>;
}

/** How each zone and each carrier did in the month. */
function ZonesCard({ months, focus, money }: { months: MonthSummary[]; focus: number; money: Format }) {
  const [by, setBy] = usePersistentState<"zone" | "carrier">("analisis:entregas-por", "zone", ["zone", "carrier"]);
  const current = months[focus];
  const rows = by === "zone" ? current.byZone : current.byCarrier;
  const toggle = <div className="flex rounded-md border p-0.5" role="tablist" aria-label="Agrupar entregas">
    {([["zone", "Zonas"], ["carrier", "Quién entrega"]] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={by === key} onClick={() => setBy(key)}
      className={cn("rounded px-2 py-0.5 text-[11px] font-medium", by === key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{label}</button>)}
  </div>;
  return <ChartCard title={by === "zone" ? `Cada zona en ${longMonth(current.month).split(" ")[0]}` : `Quién entregó en ${longMonth(current.month).split(" ")[0]}`}
    description={by === "zone" ? "Cuántas entregas tuvo cada zona, cómo salieron y cuánto costó cada una." : "Cada repartidor o empresa de envíos: cuántas llevó, si llegaron a tiempo y a qué costo."}
    action={toggle} legend={<Legend items={OUTCOMES} />}
    table={{ columns: [by === "zone" ? "Zona" : "Quién entrega", "Entregas", "A tiempo", "Tarde", "Por entregar", "Con problema", "Costo por entrega", "Costo total"], rows: rows.map((row) => [row.name, row.total, row.onTime, row.delivered - row.onTime, row.open, row.failed, money(row.cost / Math.max(row.total, 1)), money(row.cost)]) }}>
    <PerformanceRows rows={rows} money={money} empty={by === "zone" ? "Sin entregas este mes. Las zonas se arman en Entregas." : "Sin entregas este mes."} />
  </ChartCard>;
}

/** What delivering cost in each zone, month by month. */
function ZoneCostCard({ months, focus, onFocus, money, compact }: { months: MonthSummary[]; focus: number; onFocus: (index: number) => void; money: Format; compact: Format }) {
  const colorOf = useKeyColors(months, (month) => month.byZone);
  const names = new Map<string, string>();
  for (const month of months) for (const zone of month.byZone) names.set(zone.key, zone.name);
  const segments = [...names].map(([key, name]) => ({ key: key || "none", label: name, color: key ? colorOf(key) : "var(--data-grid)", values: months.map((month) => month.byZone.find((zone) => zone.key === key)?.cost ?? 0) }))
    .sort((a, b) => b.values.reduce((sum, value) => sum + value, 0) - a.values.reduce((sum, value) => sum + value, 0));
  if (!segments.length) return null;
  return <ChartCard title="Lo que cuesta entregar en cada zona" description="El costo de las entregas de cada mes, zona por zona. Haz clic en un mes para mirarlo."
    legend={<Legend items={segments} />}
    table={{ columns: ["Mes", ...segments.map((segment) => segment.label)], rows: months.map((month, index) => [longMonth(month.month), ...segments.map((segment) => money(segment.values[index]))]) }}>
    <StackedBars months={months.map((month) => month.month)} segments={segments} focus={focus} onFocus={onFocus} format={compact} label="Costo de entregar por zona y mes" height={220} />
  </ChartCard>;
}

function DeliveriesTab({ months, focus, onFocus, money, compact }: TabProps) {
  const labels = months.map((item) => item.month);
  const current = months[focus];
  const previous = focus > 0 ? months[focus - 1] : undefined;
  const rate = (month: MonthSummary) => month.deliveries.delivered ? month.deliveries.onTime / month.deliveries.delivered : null;
  const perDelivery = (month: MonthSummary) => month.deliveries.total ? month.deliveries.cost / month.deliveries.total : null;
  const segments = [
    { key: "onTime", label: "A tiempo", color: DATA_COLORS[0], values: months.map((item) => item.deliveries.onTime) },
    { key: "lateDelivered", label: "Entregadas tarde", color: DATA_COLORS[4], values: months.map((item) => Math.max(0, item.deliveries.delivered - item.deliveries.onTime)) },
    { key: "open", label: "Por entregar", color: DATA_COLORS[3], values: months.map((item) => item.deliveries.open) },
    { key: "failed", label: "Con problema", color: DATA_COLORS[5], values: months.map((item) => item.deliveries.failed) },
    { key: "cancelled", label: "Canceladas", color: DATA_COLORS[1], values: months.map((item) => item.deliveries.cancelled) },
  ];
  const count = (value: number) => new Intl.NumberFormat("es-AR").format(Math.round(value));
  const currentRate = rate(current);
  return <div className="flex flex-col gap-4">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <MiniStat label="Entregas del mes" value={count(current.deliveries.total)} delta={previous ? change(current.deliveries.total, previous.deliveries.total) : null} />
      <MiniStat label="Llegaron a tiempo" value={currentRate === null ? "—" : `${Math.round(currentRate * 100)} %`} note={current.deliveries.delivered ? `${current.deliveries.onTime} de ${current.deliveries.delivered} entregadas` : "Sin entregas terminadas"} />
      <MiniStat label="Costo por entrega" value={perDelivery(current) === null ? "—" : money(perDelivery(current)!)} delta={previous && perDelivery(previous) && perDelivery(current) ? change(perDelivery(current)!, perDelivery(previous)) : null} goodWhenUp={false} />
      <MiniStat label="Con problema o tarde" value={count(current.deliveries.failed + current.deliveries.late)} note={`${current.deliveries.failed} con problema · ${current.deliveries.late} tarde`} />
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Cómo salieron las entregas" description="Cada mes, las entregas de lo vendido según cómo terminaron."
        legend={<Legend items={segments} />}
        table={{ columns: ["Mes", ...segments.map((segment) => segment.label)], rows: months.map((item, index) => [longMonth(item.month), ...segments.map((segment) => segment.values[index])]) }}>
        <StackedBars months={labels} segments={segments} focus={focus} onFocus={onFocus} format={count} label="Entregas por estado y mes" height={240} />
      </ChartCard>
      <ZonesCard months={months} focus={focus} money={money} />
      <ZoneCostCard months={months} focus={focus} onFocus={onFocus} money={money} compact={compact} />
      <ChartCard title="A tiempo y lo que cuesta entregar" description="Qué parte de las entregas llegó el día acordado, y el costo promedio de cada una."
        table={{ columns: ["Mes", "A tiempo", "Costo por entrega", "Costo total"], rows: months.map((item) => [longMonth(item.month), rate(item) === null ? "—" : `${Math.round(rate(item)! * 100)} %`, perDelivery(item) === null ? "—" : money(perDelivery(item)!), money(item.deliveries.cost)]) }}>
        <p className="text-xs font-medium text-muted-foreground">Llegaron a tiempo</p>
        <LineChart months={labels} focus={focus} onFocus={onFocus} format={(value) => `${Math.round(value)} %`} compact={(value) => `${Math.round(value)} %`} label="Porcentaje de entregas a tiempo por mes" height={130} max={100}
          series={[{ key: "rate", label: "A tiempo", color: DATA_COLORS[0], values: months.map((item) => rate(item) === null ? null : Math.round(rate(item)! * 100)), area: true }]} />
        <p className="text-xs font-medium text-muted-foreground">Costo por entrega</p>
        <LineChart months={labels} focus={focus} onFocus={onFocus} format={money} compact={compact} label="Costo promedio por entrega por mes" height={130}
          series={[{ key: "cost", label: "Costo por entrega", color: DATA_COLORS[3], values: months.map(perDelivery), area: true }]} />
      </ChartCard>
    </div>
  </div>;
}
