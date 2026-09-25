"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type TimeSeries = { key: string; label: string; color: string; values: (number | null)[]; emphasis?: boolean };

const HEIGHT = 240;
const MARGIN = { top: 14, bottom: 26, left: 60 };

/** Rounded axis ticks (1, 2, 2.5, 5 × 10ⁿ) from zero, so every gridline reads as a plain number. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? raw;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(Math.round(value * 1e6) / 1e6);
  if (ticks.at(-1)! < max) ticks.push(ticks.at(-1)! + step);
  return ticks;
}

/**
 * Line chart for costs over time: one y-axis, 2px lines, a crosshair that snaps to the nearest period,
 * one tooltip listing every series, direct labels for up to four series and a legend when there are two or more.
 */
export function TimeLineChart({ periods, periodLabel, series, formatValue, ariaLabel }: {
  periods: string[];
  periodLabel: (period: string) => string;
  series: TimeSeries[];
  formatValue: (value: number) => string;
  ariaLabel: string;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(640);
  const [active, setActive] = React.useState<number | null>(null);
  React.useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const directLabels = series.length <= 4 && width >= 480;
  const right = directLabels ? 118 : 16;
  const plotWidth = width - MARGIN.left - right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const values = series.flatMap((item) => item.values.filter((value): value is number => value !== null));
  const ticks = niceTicks(values.length ? Math.max(...values) : 1);
  const top = ticks.at(-1)!;
  const x = (index: number) => MARGIN.left + (periods.length === 1 ? plotWidth / 2 : index * plotWidth / (periods.length - 1));
  const y = (value: number) => MARGIN.top + plotHeight - value / top * plotHeight;
  const labelEvery = Math.max(1, Math.ceil(periods.length / Math.max(2, Math.floor(plotWidth / 72))));

  const path = (points: (number | null)[]) => {
    let d = "";
    let pen = false;
    points.forEach((value, index) => {
      if (value === null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  // Direct labels at each series' last value, nudged apart so they never overlap.
  const ends = series.map((item) => {
    const index = item.values.findLastIndex((value) => value !== null);
    return index < 0 ? null : { item, index, value: item.values[index] as number, y: y(item.values[index] as number) };
  }).filter((entry): entry is NonNullable<typeof entry> => entry !== null).sort((a, b) => a.y - b.y);
  for (let index = 1; index < ends.length; index++) if (ends[index].y - ends[index - 1].y < 15) ends[index].y = ends[index - 1].y + 15;

  const pick = (clientX: number) => {
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds || !periods.length) return;
    const relative = clientX - bounds.left - MARGIN.left;
    const index = periods.length === 1 ? 0 : Math.round(relative / (plotWidth / (periods.length - 1)));
    setActive(Math.min(periods.length - 1, Math.max(0, index)));
  };
  const rows = active === null ? [] : series.map((item) => ({ item, value: item.values[active] })).filter((row) => row.value !== null).sort((a, b) => (b.value as number) - (a.value as number));

  return <div className="flex flex-col gap-2">
    {series.length >= 2 ? <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Series">
      {series.map((item) => <li key={item.key} className="flex items-center gap-1.5"><span aria-hidden="true" className={cn("inline-block w-3.5 rounded-full", item.emphasis ? "h-[3px]" : "h-0.5")} style={{ background: item.color }} />{item.label}</li>)}
    </ul> : null}
    <div ref={container} className="relative w-full select-none">
      <svg width={width} height={HEIGHT} role="img" aria-label={ariaLabel} className="block max-w-full overflow-visible">
        {ticks.map((tick) => <g key={tick}>
          <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={tick === 0 ? 1 : 0.6} strokeDasharray={tick === 0 ? undefined : "3 4"} />
          <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">{formatValue(tick)}</text>
        </g>)}
        {periods.map((period, index) => index % labelEvery === 0 || index === periods.length - 1 ? <text key={period} x={x(index)} y={HEIGHT - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">{periodLabel(period)}</text> : null)}
        {active !== null ? <line x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} className="stroke-muted-foreground" strokeWidth={1} /> : null}
        {series.map((item) => <g key={item.key}>
          <path d={path(item.values)} fill="none" stroke={item.color} strokeWidth={item.emphasis ? 3 : 2} strokeLinejoin="round" strokeLinecap="round" />
          {periods.length <= 16 ? item.values.map((value, index) => value === null ? null : <circle key={index} cx={x(index)} cy={y(value)} r={active === index ? 4.5 : 3} fill={item.color} className="stroke-card" strokeWidth={2} />) : null}
        </g>)}
        {directLabels ? ends.map((end) => <text key={end.item.key} x={x(end.index) + 8} y={end.y} dy="0.32em" className="fill-foreground text-[11px]">
          <tspan className="font-medium tabular-nums">{formatValue(end.value)}</tspan><tspan className="fill-muted-foreground"> {end.item.label.length > 14 ? `${end.item.label.slice(0, 13)}…` : end.item.label}</tspan>
        </text>) : null}
        <rect x={MARGIN.left - 12} y={0} width={plotWidth + 24} height={HEIGHT} fill="transparent" tabIndex={0} aria-label="Explorar valores por período con las flechas"
          onPointerMove={(event) => pick(event.clientX)} onPointerLeave={() => setActive(null)} onBlur={() => setActive(null)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") setActive((current) => Math.min(periods.length - 1, (current ?? -1) + 1));
            if (event.key === "ArrowLeft") setActive((current) => Math.max(0, (current ?? periods.length) - 1));
          }} />
      </svg>
      {active !== null && rows.length ? <div role="status" className="pointer-events-none absolute top-1 z-10 min-w-40 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
        style={{ left: Math.min(Math.max(x(active) + 12, 0), width - 190) }}>
        <p className="mb-1 text-muted-foreground">{periodLabel(periods[active])}</p>
        {rows.map((row) => <p key={row.item.key} className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded-full" style={{ background: row.item.color }} />
          <span className="font-semibold tabular-nums text-foreground">{formatValue(row.value as number)}</span>
          <span className="truncate text-muted-foreground">{row.item.label}</span>
        </p>)}
      </div> : null}
    </div>
  </div>;
}
