"use client";

import * as React from "react";
import { formatValue, type ChartData, type Kpi, type MetricFormat } from "@/lib/decks";
import { TimeLineChart } from "@/components/charts/time-line-chart";
import { cn } from "@/lib/utils";

/**
 * Charts sized for a narrow panel card: the same data the presentations use, drawn with the app's validated
 * palette (one hue for magnitude, fixed slots for composition), labels in text colors and a tooltip on every mark.
 */

const SERIES = Array.from({ length: 8 }, (_, index) => `var(--chart-series-${index + 1})`);

type Format = (value: number, unit?: MetricFormat) => string;

export function WidgetChart({ data, currency, large }: { data: ChartData; currency: string; large?: boolean }) {
  const format: Format = React.useCallback((value, unit = "money") => formatValue(value, unit, currency), [currency]);
  switch (data.type) {
    case "bars": return <Bars data={data} format={format} />;
    case "stacked": return <Stacked data={data} format={format} />;
    case "columns": return <Columns data={data} format={format} large={large} />;
    case "waterfall": return <Waterfall data={data} format={format} />;
    case "progress": return <Progress data={data} format={format} />;
    case "line": return <TimeLineChart periods={data.periods} periodLabel={(period) => period} series={data.series.slice(0, 8).map((series, index) => ({ key: series.label, label: series.label, color: SERIES[index], values: series.values }))} formatValue={(value) => format(value)} ariaLabel="Evolución en el tiempo" />;
    case "table": return <Table data={data} />;
    case "empty": return <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">{data.message}</p>;
  }
}

function Bars({ data, format }: { data: Extract<ChartData, { type: "bars" }>; format: Format }) {
  const max = Math.max(1, ...data.rows.map((row) => Math.abs(row.value)));
  return <ul className="flex flex-col gap-1.5">
    {data.rows.map((row, index) => <React.Fragment key={`${row.group ?? ""}-${row.label}`}>
      {row.group && row.group !== data.rows[index - 1]?.group ? <li className="mt-1 border-b pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">{row.group}</li> : null}
      <li className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-2 text-xs" title={`${row.label}: ${format(row.value, data.unit)}${row.note ? ` · ${row.note}` : ""}`}>
        <span className="truncate text-muted-foreground">{row.label}</span>
        <span className="h-2.5 rounded-full bg-muted"><span className="block h-2.5 rounded-full" style={{ width: `${Math.max(3, Math.abs(row.value) / max * 100)}%`, background: row.tone === "negative" ? "var(--destructive)" : "var(--chart-series-1)" }} /></span>
        <span className="text-right font-medium tabular-nums">{format(row.value, data.unit)}{data.total ? <span className="ml-1 font-normal text-muted-foreground">{Math.round(Math.abs(row.value) / data.total * 100)} %</span> : null}</span>
      </li>
    </React.Fragment>)}
  </ul>;
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">{items.map((item) => <li key={item.label} className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block size-2.5 rounded-sm" style={{ background: item.color }} />{item.label}</li>)}</ul>;
}

function Stacked({ data, format }: { data: Extract<ChartData, { type: "stacked" }>; format: Format }) {
  const max = Math.max(1, ...data.rows.map((row) => row.total));
  return <div className="flex flex-col gap-2.5">
    <Legend items={data.keys.map((key, index) => ({ label: key.label, color: SERIES[index] }))} />
    {data.rows.map((row) => <div key={row.label} className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs"><span className="truncate">{row.label}</span><span className="font-semibold tabular-nums">{format(row.total)}</span></div>
      <div className="flex h-2.5 gap-[2px]" style={{ width: `${Math.max(8, row.total / max * 100)}%` }} role="img" aria-label={data.keys.map((key) => `${key.label} ${Math.round((row.parts[key.key] ?? 0) / row.total * 100)} %`).join(", ")}>
        {data.keys.map((key, index) => (row.parts[key.key] ?? 0) > 0 ? <span key={key.key} title={`${key.label}: ${format(row.parts[key.key])} (${Math.round(row.parts[key.key] / row.total * 100)} %)`} className="h-full first:rounded-l-full last:rounded-r-full" style={{ flexGrow: row.parts[key.key], background: SERIES[index] }} /> : null)}
      </div>
    </div>)}
  </div>;
}

function Columns({ data, format, large }: { data: Extract<ChartData, { type: "columns" }>; format: Format; large?: boolean }) {
  const max = Math.max(1, ...data.rows.map((row) => row.value));
  const best = data.rows.reduce((top, row, index) => row.value > data.rows[top].value ? index : top, 0);
  const marks = new Set([0, Math.floor((data.rows.length - 1) / 2), data.rows.length - 1]);
  return <div className="flex flex-col gap-1">
    <div className={cn("flex items-end gap-[2px]", large ? "h-48" : "h-24")} role="img" aria-label={`Mejor día: ${data.rows[best].label}, ${format(data.rows[best].value, data.unit)}`}>
      {data.rows.map((row, index) => <span key={row.label} title={`Día ${row.label}: ${format(row.value, data.unit)}`} className="flex-1 rounded-t-[3px]" style={{ height: row.value > 0 ? `${Math.max(3, row.value / max * 100)}%` : 0, background: index === best ? "var(--chart-series-1)" : "color-mix(in oklab, var(--chart-series-1) 40%, transparent)" }} />)}
    </div>
    <div className="flex justify-between text-[10px] text-muted-foreground">{[...marks].map((index) => <span key={index}>{data.rows[index]?.label}</span>)}</div>
  </div>;
}

/** Horizontal cascade for a narrow card: each cost starts where the previous level ended. */
function cascade(steps: Extract<ChartData, { type: "waterfall" }>["steps"]) {
  const bars: { label: string; value: number; kind: string; from: number; to: number }[] = [];
  let level = 0;
  for (const step of steps) {
    if (step.kind === "start") { bars.push({ ...step, from: 0, to: step.value }); level = step.value; }
    else if (step.kind === "minus") { bars.push({ ...step, from: level, to: level - step.value }); level -= step.value; }
    else bars.push({ ...step, from: 0, to: step.value });
  }
  return bars;
}

function Waterfall({ data, format }: { data: Extract<ChartData, { type: "waterfall" }>; format: Format }) {
  const bars = cascade(data.steps);
  const min = Math.min(0, ...bars.flatMap((bar) => [bar.from, bar.to]));
  const max = Math.max(1, ...bars.flatMap((bar) => [bar.from, bar.to]));
  const x = (value: number) => (value - min) / (max - min) * 100;
  const color = (bar: (typeof bars)[number]) => bar.kind === "start" ? "var(--chart-series-1)" : bar.kind === "minus" ? "var(--chart-increase)" : bar.value >= 0 ? "var(--chart-series-3)" : "var(--destructive)";
  return <ul className="flex flex-col gap-1">
    {bars.map((bar) => <li key={bar.label} className={cn("grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-xs", bar.kind === "result" && "mt-1 border-t pt-1.5 font-semibold")}>
      <span className="truncate text-muted-foreground">{bar.label}</span>
      <span className="relative h-2.5 rounded-full bg-muted">
        <span className="absolute inset-y-0 rounded-full" style={{ left: `${x(Math.min(bar.from, bar.to))}%`, width: `${Math.max(1.5, Math.abs(x(bar.to) - x(bar.from)))}%`, background: color(bar) }} />
      </span>
      <span className="text-right tabular-nums">{bar.kind === "minus" || bar.value < 0 ? "−" : ""}{format(Math.abs(bar.value))}</span>
    </li>)}
  </ul>;
}

function Progress({ data, format }: { data: Extract<ChartData, { type: "progress" }>; format: Format }) {
  const scale = Math.max(data.value, data.target) * 1.1 || 1;
  const percent = Math.round(data.value / data.target * 100);
  const reached = data.value >= data.target;
  return <div className="flex flex-col gap-1.5">
    <div className="relative h-2.5 w-full rounded-full bg-muted" role="img" aria-label={`${percent} % de lo necesario para no perder`}>
      <div className="h-full rounded-full" style={{ width: `${data.value / scale * 100}%`, background: reached ? "var(--chart-series-3)" : "var(--chart-series-1)" }} />
      <span className="absolute -top-1 -bottom-1 w-0.5 rounded bg-foreground" style={{ left: `${data.target / scale * 100}%` }} />
    </div>
    <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
      <span>{data.valueLabel}: <span className="font-medium text-foreground tabular-nums">{format(data.value)}</span> ({percent} %)</span>
      <span>{data.targetLabel}: <span className="font-medium text-foreground tabular-nums">{format(data.target)}</span></span>
    </div>
  </div>;
}

function Table({ data }: { data: Extract<ChartData, { type: "table" }> }) {
  return <ul className="flex flex-col gap-1.5 text-xs">
    {data.rows.map((row, index) => <li key={index} className="flex items-center justify-between gap-2">
      <span className="min-w-0"><span className="block truncate font-medium">{row[1]}</span><span className="text-muted-foreground">{[row[0], row[2], row[3]].filter(Boolean).join(" · ")}</span></span>
      <span className="shrink-0 tabular-nums">{row.at(-1)}</span>
    </li>)}
  </ul>;
}

/**
 * Big figures in a grid; a loss shows its size in red, because its label already says it is a loss. The month is
 * in the card's header, so a figure only repeats its note when it is something else (the product).
 */
export function WidgetKpis({ kpis, currency, large }: { kpis: Kpi[]; currency: string; large?: boolean }) {
  return <div className={cn("grid gap-2", kpis.length === 1 ? "grid-cols-1" : "grid-cols-2", large && kpis.length > 2 && "sm:grid-cols-4")}>
    {kpis.map((kpi, index) => {
      const negative = kpi.value !== null && kpi.value < 0;
      const value = formatValue(kpi.metric === "result" && kpi.value !== null ? Math.abs(kpi.value) : kpi.value, kpi.format, currency);
      return <div key={`${kpi.metric}-${index}`} className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-muted/60 px-2.5 py-2">
        <span className="truncate text-[11px] text-muted-foreground">{kpi.label}</span>
        <span className={cn("truncate font-semibold tabular-nums", large ? "text-2xl" : "text-base", negative && "text-destructive")}>{value}</span>
        {kpi.note && !kpi.month ? <span className="truncate text-[10px] text-muted-foreground">{kpi.note}</span> : null}
      </div>;
    })}
  </div>;
}
