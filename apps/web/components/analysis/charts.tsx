"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Charts for the business analysis, drawn in SVG with Cozte's palette: a flow of money month by month, monthly bars,
 * sparklines, a treemap, a weekday radar, lines and stacked bars. Every chart answers on hover, lets the person pick a
 * month and has a table view, so no number depends on color alone.
 */

export const DATA_COLORS = ["var(--data-1)", "var(--data-2)", "var(--data-3)", "var(--data-4)", "var(--data-5)", "var(--data-6)"];
/** Slots whose fill needs dark text (lime and ochre). */
const LIGHT_SLOTS = new Set(["var(--data-3)", "var(--data-5)"]);
export const textOn = (color: string) => LIGHT_SLOTS.has(color) ? "var(--brand-ink)" : "#fff";

export type Format = (value: number) => string;

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const shortMonth = (month: string) => MONTHS_SHORT[Number(month.slice(5, 7)) - 1] ?? month;
export const longMonth = (month: string) => `${MONTHS_LONG[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;

/** The width of an element, following its resizes. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => setWidth(Math.round(entries[0]?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Round ticks for an axis from zero to at least `max`. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= raw) ?? 10) * power;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, index) => index * step);
}

/** A smooth line through points that never overshoots between them (monotone cubic). */
export function smoothPath(points: [number, number][]): string {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  const slopes = points.slice(1).map((point, index) => (point[1] - points[index][1]) / (point[0] - points[index][0] || 1));
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === points.length - 1) return slopes[slopes.length - 1];
    return slopes[index - 1] * slopes[index] <= 0 ? 0 : (slopes[index - 1] + slopes[index]) / 2;
  });
  for (let index = 0; index < slopes.length; index += 1) {
    if (slopes[index] === 0) { tangents[index] = 0; tangents[index + 1] = 0; continue; }
    const a = tangents[index] / slopes[index];
    const b = tangents[index + 1] / slopes[index];
    const h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); tangents[index] = t * a * slopes[index]; tangents[index + 1] = t * b * slopes[index]; }
  }
  let path = `M${points[0][0]},${points[0][1]}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[index + 1];
    const dx = (x1 - x0) / 3;
    path += ` C${x0 + dx},${y0 + tangents[index] * dx} ${x1 - dx},${y1 - tangents[index + 1] * dx} ${x1},${y1}`;
  }
  return path;
}

/* ---------- Shared pieces ---------- */

export type LegendItem = { key: string; label: string; color: string; dashed?: boolean };

/** Series names with their color; clicking one hides or shows it. */
export function Legend({ items, hidden, onToggle }: { items: LegendItem[]; hidden?: Set<string>; onToggle?: (key: string) => void }) {
  return <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs" aria-label="Series">
    {items.map((item) => {
      const off = hidden?.has(item.key);
      return <li key={item.key}>
        <button type="button" disabled={!onToggle} aria-pressed={onToggle ? !off : undefined} onClick={() => onToggle?.(item.key)}
          className={cn("inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 transition-opacity enabled:hover:bg-muted", off && "opacity-40")}>
          <span className="inline-block size-2.5 rounded-[3px]" style={item.dashed ? { background: "transparent", border: `2px dashed ${item.color}` } : { background: item.color }} aria-hidden="true" />
          <span className={cn(off && "line-through")}>{item.label}</span>
        </button>
      </li>;
    })}
  </ul>;
}

/** A card around a chart: title, a short description, its legend and a table view of the same numbers. */
export function ChartCard({ title, description, legend, table, className, children, action }: {
  title: string; description?: string; legend?: React.ReactNode; className?: string; action?: React.ReactNode
  table?: { columns: string[]; rows: (string | number)[][] }; children: React.ReactNode
}) {
  const [asTable, setAsTable] = React.useState(false);
  return <section className={cn("flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 shadow-xs sm:p-5", className)} aria-label={title}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{title}</h3>{description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}</div>
      <div className="flex shrink-0 items-center gap-1">{action}{table ? <button type="button" onClick={() => setAsTable((value) => !value)} className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground" aria-pressed={asTable}>{asTable ? "Ver gráfico" : "Ver tabla"}</button> : null}</div>
    </div>
    {legend && !asTable ? legend : null}
    {asTable && table ? <div className="max-h-80 overflow-auto rounded-lg border">
      <table className="w-full text-xs tabular-nums"><thead className="sticky top-0 bg-muted"><tr>{table.columns.map((column, index) => <th key={column} className={cn("px-3 py-2 text-left font-medium text-muted-foreground", index > 0 && "text-right")}>{column}</th>)}</tr></thead>
        <tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-t">{row.map((cell, index) => <td key={index} className={cn("px-3 py-1.5", index > 0 && "text-right")}>{cell}</td>)}</tr>)}</tbody></table>
    </div> : children}
  </section>;
}

/** The floating card that explains what is under the pointer. */
function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(x, 120), Math.max(120, width - 120));
  return <div className="pointer-events-none absolute z-20 w-max max-w-72 min-w-44 -translate-x-1/2 -translate-y-full rounded-xl border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg" style={{ left, top: y - 10 }} role="status">{children}</div>;
}

function TooltipRow({ color, label, value, strong, dashed }: { color?: string; label: string; value: string; strong?: boolean; dashed?: boolean }) {
  return <div className={cn("flex items-center justify-between gap-4 py-0.5", strong && "font-semibold")}>
    <span className="flex items-center gap-1.5 whitespace-nowrap">{color ? <span className="inline-block size-2 rounded-[2px]" style={dashed ? { border: `1.5px dashed ${color}` } : { background: color }} /> : null}{label}</span>
    <span className="whitespace-nowrap tabular-nums">{value}</span>
  </div>;
}

/* ---------- Flow ---------- */

type Seg = { x: number; y: number; c1?: [number, number]; c2?: [number, number] };

/** A boundary that stays flat around each month and flows between them. */
function flowSegments(xs: number[], ys: number[], left: number, right: number, plateau: number): Seg[] {
  const segs: Seg[] = [{ x: left, y: ys[0] }, { x: xs.length === 1 ? right : Math.min(xs[0] + plateau, right), y: ys[0] }];
  for (let index = 1; index < xs.length; index += 1) {
    const start = segs[segs.length - 1].x;
    const end = xs[index] - plateau;
    const mid = (start + end) / 2;
    segs.push({ x: end, y: ys[index], c1: [mid, ys[index - 1]], c2: [mid, ys[index]] });
    segs.push({ x: index === xs.length - 1 ? right : xs[index] + plateau, y: ys[index] });
  }
  return segs;
}
const segPath = (segs: Seg[]) => segs.map((seg, index) => index === 0 ? `M${seg.x},${seg.y}` : seg.c1 && seg.c2 ? `C${seg.c1[0]},${seg.c1[1]} ${seg.c2[0]},${seg.c2[1]} ${seg.x},${seg.y}` : `L${seg.x},${seg.y}`).join(" ");
function reverseSegments(segs: Seg[]): Seg[] {
  const out: Seg[] = [{ x: segs[segs.length - 1].x, y: segs[segs.length - 1].y }];
  for (let index = segs.length - 1; index > 0; index -= 1) {
    const seg = segs[index];
    const previous = segs[index - 1];
    out.push(seg.c1 && seg.c2 ? { x: previous.x, y: previous.y, c1: seg.c2, c2: seg.c1 } : { x: previous.x, y: previous.y });
  }
  return out;
}

export type FlowLayer = { key: string; label: string; color: string; values: number[] };

/**
 * Money flowing month by month: each layer is a part of the total, centered like a river, with the month's total in
 * a pill above and a second figure below. Hovering a month explains it; clicking it focuses the analysis there.
 */
export function FlowChart({ months, layers, top, bottom, focus, onFocus, format, height = 280, label }: {
  months: string[]; layers: FlowLayer[]; top: (index: number) => string; bottom?: (index: number) => { text: string; tone?: "negative" } | null
  focus: number; onFocus: (index: number) => void; format: Format; height?: number; label: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const id = React.useId().replace(/:/g, "");
  const padTop = 38, padBottom = 64;
  const band = height - padTop - padBottom;
  const n = months.length;
  const slot = width / Math.max(n, 1);
  const xs = months.map((_, index) => slot * index + slot / 2);
  const totals = months.map((_, index) => layers.reduce((sum, layer) => sum + Math.max(0, layer.values[index] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const scale = band / max;
  const center = padTop + band / 2;
  const plateau = Math.min(slot * 0.16, 26);
  // Boundaries from the top of the river down, one per layer edge.
  const edges = Array.from({ length: layers.length + 1 }, (_, edge) => months.map((_, index) => {
    const above = layers.slice(0, edge).reduce((sum, layer) => sum + Math.max(0, layer.values[index] ?? 0), 0);
    return center - (totals[index] * scale) / 2 + above * scale;
  }));
  const paths = width ? layers.map((_, index) => {
    const upper = flowSegments(xs, edges[index], 0, width, plateau);
    const lower = reverseSegments(flowSegments(xs, edges[index + 1], 0, width, plateau));
    return `${segPath(upper)} L${lower[0].x},${lower[0].y} ${segPath(lower).slice(segPath(lower).indexOf(" ") + 1)} Z`;
  }) : [];
  const envelope = width ? (() => {
    const upper = flowSegments(xs, edges[0], 0, width, plateau);
    const lower = reverseSegments(flowSegments(xs, edges[layers.length], 0, width, plateau));
    return `${segPath(upper)} L${lower[0].x},${lower[0].y} ${segPath(lower).slice(segPath(lower).indexOf(" ") + 1)} Z`;
  })() : "";
  const active = hover ?? focus;
  // Narrow screens: the figures of the month being looked at only, so the pills never overlap.
  const roomy = slot >= 72;
  return <div ref={ref} className="relative w-full select-none" style={{ height }}>
    {width ? <svg width={width} height={height} role="img" aria-label={label} className="overflow-visible">
      <defs>
        <filter id={`glow-${id}`} x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="16" /></filter>
      </defs>
      <path d={envelope} fill={layers[0]?.color ?? "var(--data-1)"} opacity={0.22} filter={`url(#glow-${id})`} />
      {paths.map((path, index) => <path key={layers[index].key} d={path} fill={layers[index].color} stroke="var(--card)" strokeWidth={1.5} className="transition-[d] duration-500" />)}
      {xs.map((x, index) => {
        const on = index === active;
        const pill = (y: number, text: string, strong: boolean, tone?: "negative") => {
          const w = Math.max(44, text.length * 6.6 + 18);
          // Kept inside the chart at the edges.
          const cx = Math.min(Math.max(x, w / 2 + 2), width - w / 2 - 2);
          return <g transform={`translate(${cx - w / 2},${y - 11})`}>
            <rect width={w} height={22} rx={11} fill={strong ? "var(--foreground)" : "var(--card)"} stroke={strong ? "none" : "var(--border)"} />
            <text x={w / 2} y={15} textAnchor="middle" fontSize={11} fontWeight={600} className="tabular-nums" fill={strong ? "var(--background)" : tone === "negative" ? "var(--data-6)" : "var(--foreground)"}>{text}</text>
          </g>;
        };
        const below = bottom?.(index);
        return <g key={months[index]}>
          <line x1={x} x2={x} y1={14} y2={height - 44} stroke={on ? "var(--foreground)" : "var(--card)"} strokeOpacity={on ? 0.55 : 0.9} strokeWidth={on ? 1.5 : 1.5} />
          {roomy || on ? pill(14, top(index), on) : null}
          {below && (roomy || on) ? pill(height - 44, below.text, false, below.tone) : null}
          <text x={x} y={height - 12} textAnchor="middle" fontSize={11} fill={on ? "var(--foreground)" : "var(--muted-foreground)"} fontWeight={on ? 600 : 400}>{shortMonth(months[index])}</text>
          <rect x={x - slot / 2} y={0} width={slot} height={height} fill="transparent" style={{ cursor: "pointer" }}
            onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)} onClick={() => onFocus(index)}>
            <title>{longMonth(months[index])}</title>
          </rect>
        </g>;
      })}
    </svg> : null}
    {hover !== null && width ? <Tooltip x={xs[hover]} y={padTop + 8} width={width}>
      <p className="mb-1 font-semibold capitalize">{longMonth(months[hover])}</p>
      {layers.map((layer) => <TooltipRow key={layer.key} color={layer.color} label={layer.label} value={`${format(layer.values[hover] ?? 0)}${totals[hover] ? ` · ${Math.round((layer.values[hover] ?? 0) / totals[hover] * 100)} %` : ""}`} />)}
      <p className="mt-1 text-[10px] text-muted-foreground">Clic para mirar este mes</p>
    </Tooltip> : null}
  </div>;
}

/* ---------- Monthly bars ---------- */

/** One bar per month; the month being looked at is highlighted. Months without data show as a hatched outline. */
export function MonthBars({ months, values, focus, onFocus, format, compact, color = "var(--data-1)", height = 220, label }: {
  months: string[]; values: number[]; focus: number; onFocus: (index: number) => void; format: Format; compact: Format; color?: string; height?: number; label: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const id = React.useId().replace(/:/g, "");
  const padLeft = 44, padBottom = 26, padTop = 24;
  const plot = height - padBottom - padTop;
  const ticks = niceTicks(Math.max(...values, 0) * 1.08);
  const top = ticks[ticks.length - 1] || 1;
  const slot = (width - padLeft) / Math.max(months.length, 1);
  const barWidth = Math.min(40, slot * 0.58);
  const y = (value: number) => padTop + plot - (value / top) * plot;
  return <div ref={ref} className="relative w-full select-none" style={{ height }}>
    {width ? <svg width={width} height={height} role="img" aria-label={label}>
      <defs><pattern id={`hatch-${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--data-muted)" strokeWidth="2" /></pattern></defs>
      {ticks.map((tick) => <g key={tick}><line x1={padLeft} x2={width} y1={y(tick)} y2={y(tick)} stroke="var(--data-grid)" strokeDasharray={tick ? "3 4" : undefined} /><text x={padLeft - 8} y={y(tick) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted-foreground)" className="tabular-nums">{compact(tick)}</text></g>)}
      {months.map((month, index) => {
        const value = values[index] ?? 0;
        const x = padLeft + slot * index + (slot - barWidth) / 2;
        const on = index === focus;
        const barTop = value > 0 ? y(value) : padTop + plot - 18;
        return <g key={month}>
          <path d={`M${x},${padTop + plot} V${barTop + 4} Q${x},${barTop} ${x + 4},${barTop} H${x + barWidth - 4} Q${x + barWidth},${barTop} ${x + barWidth},${barTop + 4} V${padTop + plot} Z`}
            fill={value > 0 ? (on ? color : "var(--data-muted)") : `url(#hatch-${id})`} opacity={hover !== null && hover !== index && !on ? 0.75 : 1} className="transition-all duration-300" />
          {on && value > 0 ? <text x={x + barWidth / 2} y={barTop - 7} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--foreground)" className="tabular-nums">{compact(value)}</text> : null}
          <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" fontSize={11} fill={on ? "var(--foreground)" : "var(--muted-foreground)"} fontWeight={on ? 600 : 400}>{shortMonth(month)}</text>
          <rect x={padLeft + slot * index} y={0} width={slot} height={height} fill="transparent" style={{ cursor: "pointer" }} onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)} onClick={() => onFocus(index)} />
        </g>;
      })}
    </svg> : null}
    {hover !== null && width ? <Tooltip x={padLeft + slot * hover + slot / 2} y={Math.max(40, y(values[hover] ?? 0))} width={width}>
      <p className="font-semibold capitalize">{longMonth(months[hover])}</p>
      <p className="tabular-nums">{values[hover] ? format(values[hover]) : "Sin registros"}</p>
      {hover > 0 && values[hover - 1] ? <p className="text-muted-foreground">{deltaText(values[hover], values[hover - 1])} frente a {shortMonth(months[hover - 1])}</p> : null}
    </Tooltip> : null}
  </div>;
}

export const deltaText = (current: number, previous: number) => {
  const ratio = (current - previous) / Math.abs(previous);
  return `${ratio >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(ratio * 100))} %`;
};

/* ---------- Sparkline ---------- */

/** A small line of the months, with the one being looked at marked. */
export function Sparkline({ values, focus, color = "var(--data-1)", height = 44, label }: { values: (number | null)[]; focus: number; color?: string; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const id = React.useId().replace(/:/g, "");
  const known = values.map((value, index) => [index, value] as const).filter((item): item is readonly [number, number] => item[1] !== null);
  const min = Math.min(0, ...known.map((item) => item[1]));
  const max = Math.max(1, ...known.map((item) => item[1]));
  const x = (index: number) => values.length < 2 ? width / 2 : 4 + (index / (values.length - 1)) * (width - 8);
  const y = (value: number) => 6 + (1 - (value - min) / (max - min || 1)) * (height - 12);
  const points = known.map(([index, value]) => [x(index), y(value)] as [number, number]);
  const line = smoothPath(points);
  const focused = known.find((item) => item[0] === focus);
  return <div ref={ref} className="w-full" style={{ height }}>
    {width && points.length ? <svg width={width} height={height} role="img" aria-label={label}>
      <defs><linearGradient id={`spark-${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.28} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
      <path d={`${line} L${points[points.length - 1][0]},${height} L${points[0][0]},${height} Z`} fill={`url(#spark-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
      {focused ? <circle cx={x(focused[0])} cy={y(focused[1])} r={4} fill={color} stroke="var(--card)" strokeWidth={2} /> : null}
    </svg> : null}
  </div>;
}

/* ---------- Treemap ---------- */

export type TreemapItem = { key: string; label: string; value: number; color: string; detail?: string; delta?: number | null; group?: string };
type Rect = { x: number; y: number; w: number; h: number };

/** Squarified treemap: tiles as close to squares as possible, largest first. */
function squarify(items: TreemapItem[], rect: Rect): (TreemapItem & Rect)[] {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total || !items.length) return [];
  const area = rect.w * rect.h;
  const scaled = items.map((item) => ({ item, size: (item.value / total) * area }));
  const out: (TreemapItem & Rect)[] = [];
  let { x, y, w, h } = rect;
  let row: typeof scaled = [];
  const worst = (list: typeof scaled, side: number) => {
    const sum = list.reduce((acc, entry) => acc + entry.size, 0);
    const maxSize = Math.max(...list.map((entry) => entry.size));
    const minSize = Math.min(...list.map((entry) => entry.size));
    return Math.max((side * side * maxSize) / (sum * sum), (sum * sum) / (side * side * minSize));
  };
  const layout = (list: typeof scaled) => {
    const sum = list.reduce((acc, entry) => acc + entry.size, 0);
    if (w >= h) {
      const rowWidth = sum / h;
      let offset = y;
      for (const entry of list) { const tileH = entry.size / rowWidth; out.push({ ...entry.item, x, y: offset, w: rowWidth, h: tileH }); offset += tileH; }
      x += rowWidth; w -= rowWidth;
    } else {
      const rowHeight = sum / w;
      let offset = x;
      for (const entry of list) { const tileW = entry.size / rowHeight; out.push({ ...entry.item, x: offset, y, w: tileW, h: rowHeight }); offset += tileW; }
      y += rowHeight; h -= rowHeight;
    }
  };
  for (const entry of scaled) {
    const side = Math.min(w, h);
    if (!row.length || worst([...row, entry], side) <= worst(row, side)) row.push(entry);
    else { layout(row); row = [entry]; }
  }
  if (row.length) layout(row);
  return out;
}

/** Where the money is, as blocks proportional to each part, with its share and its change from the previous month. */
export function Treemap({ items, format, height = 300, label }: { items: TreemapItem[]; format: Format; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<string | null>(null);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const tiles = width ? squarify(items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value), { x: 0, y: 0, w: width, h: height }) : [];
  const hovered = tiles.find((tile) => tile.key === hover);
  return <div ref={ref} className="relative w-full" style={{ height }} role="img" aria-label={label}>
    {tiles.map((tile) => {
      const share = total ? Math.round((tile.value / total) * 100) : 0;
      const roomy = tile.w > 110 && tile.h > 70;
      const some = tile.w > 60 && tile.h > 36;
      return <div key={tile.key} onPointerEnter={() => setHover(tile.key)} onPointerLeave={() => setHover(null)}
        className="absolute overflow-hidden rounded-xl p-2.5 transition-[filter,transform] duration-200 hover:brightness-105"
        style={{ left: tile.x + 2, top: tile.y + 2, width: Math.max(0, tile.w - 4), height: Math.max(0, tile.h - 4), background: tile.color, color: textOn(tile.color), opacity: hover && hover !== tile.key ? 0.82 : 1 }}>
        {some ? <div className="flex h-full flex-col justify-between">
          <p className={cn("line-clamp-2 font-medium leading-tight", roomy ? "text-sm" : "text-[11px]")}>{tile.label}</p>
          <div className="flex items-end justify-between gap-2">
            <span className={cn("font-semibold tabular-nums", roomy ? "text-2xl" : "text-sm")}>{share} %</span>
            {roomy && tile.delta !== undefined && tile.delta !== null ? <span className="rounded-full bg-black/15 px-1.5 py-0.5 text-[10px] font-medium tabular-nums">{tile.delta >= 0 ? "+" : "−"}{Math.abs(Math.round(tile.delta * 100))} %</span> : null}
          </div>
        </div> : null}
      </div>;
    })}
    {hovered ? <Tooltip x={hovered.x + hovered.w / 2} y={Math.max(60, hovered.y + 20)} width={width}>
      <p className="font-semibold">{hovered.label}</p>
      {hovered.group ? <p className="text-muted-foreground">{hovered.group}</p> : null}
      <TooltipRow label="Monto" value={format(hovered.value)} />
      <TooltipRow label="Del total" value={`${total ? Math.round((hovered.value / total) * 100) : 0} %`} />
      {hovered.delta !== undefined && hovered.delta !== null ? <TooltipRow label="Frente al mes anterior" value={`${hovered.delta >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(hovered.delta * 100))} %`} /> : null}
      {hovered.detail ? <p className="mt-1 text-muted-foreground">{hovered.detail}</p> : null}
    </Tooltip> : null}
    {!tiles.length && width ? <p className="flex h-full items-center justify-center text-sm text-muted-foreground">Sin datos en este mes</p> : null}
  </div>;
}

/* ---------- Radar ---------- */

export type RadarSeries = { key: string; label: string; color: string; values: number[]; dashed?: boolean };

/** A value per axis (for example, each weekday) as a shape; the previous period, hatched, for comparison. */
export function RadarChart({ axes, series, format, height = 300, label }: { axes: string[]; series: RadarSeries[]; format: Format; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const id = React.useId().replace(/:/g, "");
  const size = Math.min(width, height);
  const radius = Math.max(10, size / 2 - 34);
  const cx = width / 2, cy = height / 2;
  const max = Math.max(1, ...series.flatMap((item) => item.values));
  const angle = (index: number) => -Math.PI / 2 + (index / axes.length) * Math.PI * 2;
  const point = (index: number, value: number) => [cx + Math.cos(angle(index)) * radius * (value / max), cy + Math.sin(angle(index)) * radius * (value / max)] as const;
  return <div ref={ref} className="relative w-full select-none" style={{ height }}>
    {width ? <svg width={width} height={height} role="img" aria-label={label}
      onPointerMove={(event) => {
        const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
        const a = Math.atan2(event.clientY - box.top - cy, event.clientX - box.left - cx);
        const step = (Math.PI * 2) / axes.length;
        setHover(((Math.round((a + Math.PI / 2) / step) % axes.length) + axes.length) % axes.length);
      }} onPointerLeave={() => setHover(null)}>
      <defs><pattern id={`radar-${id}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke={series[1]?.color ?? "var(--data-2)"} strokeWidth="1.4" /></pattern></defs>
      {[0.25, 0.5, 0.75, 1].map((ring) => <polygon key={ring} points={axes.map((_, index) => point(index, max * ring).join(",")).join(" ")} fill="none" stroke="var(--data-grid)" />)}
      {axes.map((axis, index) => {
        const [x, y] = point(index, max * 1.16);
        return <g key={axis}>
          <line x1={cx} y1={cy} x2={point(index, max)[0]} y2={point(index, max)[1]} stroke="var(--data-grid)" />
          <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fill={hover === index ? "var(--foreground)" : "var(--muted-foreground)"} fontWeight={hover === index ? 600 : 400}>{axis}</text>
        </g>;
      })}
      {[...series].reverse().map((item, reversedIndex) => {
        const index = series.length - 1 - reversedIndex;
        const polygon = item.values.map((value, axis) => point(axis, value).join(",")).join(" ");
        return <polygon key={item.key} points={polygon} fill={index === 0 ? item.color : `url(#radar-${id})`} fillOpacity={index === 0 ? 0.28 : 0.9} stroke={item.color} strokeWidth={2} strokeDasharray={item.dashed ? "5 4" : undefined} strokeLinejoin="round" className="transition-all duration-500" />;
      })}
      {hover !== null ? series.map((item) => { const [x, y] = point(hover, item.values[hover] ?? 0); return <circle key={item.key} cx={x} cy={y} r={4.5} fill={item.color} stroke="var(--card)" strokeWidth={2} />; }) : null}
    </svg> : null}
    {hover !== null && width ? <Tooltip x={point(hover, max)[0]} y={Math.max(56, point(hover, max)[1])} width={width}>
      <p className="mb-1 font-semibold">{axes[hover]}</p>
      {series.map((item) => <TooltipRow key={item.key} color={item.color} dashed={item.dashed} label={item.label} value={format(item.values[hover] ?? 0)} />)}
    </Tooltip> : null}
  </div>;
}

/* ---------- Lines ---------- */

export type LineSeries = { key: string; label: string; color: string; values: (number | null)[]; dashed?: boolean; area?: boolean };

/** Several series of the same unit over the months, with a guide under the pointer. */
export function LineChart({ months, series, focus, onFocus, format, compact, height = 240, label, min = 0, max }: {
  months: string[]; series: LineSeries[]; focus: number; onFocus: (index: number) => void; format: Format; compact: Format; height?: number; label: string; min?: number; max?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const id = React.useId().replace(/:/g, "");
  const padLeft = 48, padRight = 14, padTop = 16, padBottom = 26;
  const plot = height - padTop - padBottom;
  const values = series.flatMap((item) => item.values.filter((value): value is number => value !== null));
  const ticks = max ? niceTicks(max, 4).filter((tick) => tick <= max) : niceTicks(Math.max(...values, 0) * 1.1);
  const top = max ?? (ticks[ticks.length - 1] || 1);
  const x = (index: number) => months.length < 2 ? (padLeft + width - padRight) / 2 : padLeft + (index / (months.length - 1)) * (width - padLeft - padRight);
  const y = (value: number) => padTop + plot - ((value - min) / (top - min || 1)) * plot;
  const active = hover ?? focus;
  return <div ref={ref} className="relative w-full select-none" style={{ height }}>
    {width ? <svg width={width} height={height} role="img" aria-label={label}
      onPointerMove={(event) => { const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect(); const relative = event.clientX - box.left; setHover(Math.max(0, Math.min(months.length - 1, Math.round(((relative - padLeft) / Math.max(1, width - padLeft - padRight)) * (months.length - 1))))); }}
      onPointerLeave={() => setHover(null)} onClick={() => { if (hover !== null) onFocus(hover); }} style={{ cursor: "pointer" }}>
      <defs>{series.filter((item) => item.area).map((item) => <linearGradient key={item.key} id={`line-${id}-${item.key}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={item.color} stopOpacity={0.22} /><stop offset="100%" stopColor={item.color} stopOpacity={0} /></linearGradient>)}</defs>
      {ticks.map((tick) => <g key={tick}><line x1={padLeft} x2={width - padRight} y1={y(tick)} y2={y(tick)} stroke="var(--data-grid)" strokeDasharray={tick ? "3 4" : undefined} /><text x={padLeft - 8} y={y(tick) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted-foreground)" className="tabular-nums">{compact(tick)}</text></g>)}
      {months.map((month, index) => <text key={month} x={x(index)} y={height - 8} textAnchor="middle" fontSize={11} fill={index === focus ? "var(--foreground)" : "var(--muted-foreground)"} fontWeight={index === focus ? 600 : 400}>{shortMonth(month)}</text>)}
      <line x1={x(active)} x2={x(active)} y1={padTop} y2={padTop + plot} stroke="var(--foreground)" strokeOpacity={0.25} />
      {series.map((item) => {
        const points = item.values.map((value, index) => value === null ? null : [x(index), y(value)] as [number, number]).filter((value): value is [number, number] => value !== null);
        const line = smoothPath(points);
        return <g key={item.key}>
          {item.area && points.length > 1 ? <path d={`${line} L${points[points.length - 1][0]},${padTop + plot} L${points[0][0]},${padTop + plot} Z`} fill={`url(#line-${id}-${item.key})`} /> : null}
          <path d={line} fill="none" stroke={item.color} strokeWidth={2} strokeDasharray={item.dashed ? "5 5" : undefined} strokeLinecap="round" className="transition-[d] duration-500" />
          {item.values[active] !== null && item.values[active] !== undefined ? <circle cx={x(active)} cy={y(item.values[active]!)} r={4.5} fill={item.color} stroke="var(--card)" strokeWidth={2} /> : null}
        </g>;
      })}
    </svg> : null}
    {hover !== null && width ? <Tooltip x={x(hover)} y={padTop + 20} width={width}>
      <p className="mb-1 font-semibold capitalize">{longMonth(months[hover])}</p>
      {series.map((item) => <TooltipRow key={item.key} color={item.color} dashed={item.dashed} label={item.label} value={item.values[hover] === null ? "—" : format(item.values[hover]!)} />)}
    </Tooltip> : null}
  </div>;
}

/* ---------- Stacked bars ---------- */

export type StackSegment = { key: string; label: string; color: string; values: number[] };

/** Each month split in parts that add up (for example, deliveries by how they went). */
export function StackedBars({ months, segments, focus, onFocus, format, height = 220, label }: {
  months: string[]; segments: StackSegment[]; focus: number; onFocus: (index: number) => void; format: Format; height?: number; label: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const padLeft = 34, padTop = 12, padBottom = 26;
  const plot = height - padTop - padBottom;
  const totals = months.map((_, index) => segments.reduce((sum, segment) => sum + (segment.values[index] ?? 0), 0));
  const ticks = niceTicks(Math.max(...totals, 0) * 1.08, 3);
  const top = ticks[ticks.length - 1] || 1;
  const slot = (width - padLeft) / Math.max(months.length, 1);
  const barWidth = Math.min(38, slot * 0.56);
  const y = (value: number) => padTop + plot - (value / top) * plot;
  return <div ref={ref} className="relative w-full select-none" style={{ height }}>
    {width ? <svg width={width} height={height} role="img" aria-label={label}>
      {ticks.map((tick) => <g key={tick}><line x1={padLeft} x2={width} y1={y(tick)} y2={y(tick)} stroke="var(--data-grid)" strokeDasharray={tick ? "3 4" : undefined} /><text x={padLeft - 8} y={y(tick) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted-foreground)" className="tabular-nums">{format(tick)}</text></g>)}
      {months.map((month, index) => {
        const x = padLeft + slot * index + (slot - barWidth) / 2;
        let base = padTop + plot;
        const on = index === focus;
        return <g key={month} opacity={hover !== null && hover !== index && !on ? 0.7 : 1}>
          {segments.map((segment) => {
            const value = segment.values[index] ?? 0;
            if (!value) return null;
            const h = (value / top) * plot;
            base -= h;
            return <rect key={segment.key} x={x} y={base + 1} width={barWidth} height={Math.max(0, h - 2)} rx={3} fill={segment.color} className="transition-all duration-300" />;
          })}
          {!totals[index] ? <rect x={x} y={padTop + plot - 3} width={barWidth} height={3} rx={1.5} fill="var(--data-muted)" /> : null}
          <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" fontSize={11} fill={on ? "var(--foreground)" : "var(--muted-foreground)"} fontWeight={on ? 600 : 400}>{shortMonth(month)}</text>
          <rect x={padLeft + slot * index} y={0} width={slot} height={height} fill="transparent" style={{ cursor: "pointer" }} onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)} onClick={() => onFocus(index)} />
        </g>;
      })}
    </svg> : null}
    {hover !== null && width ? <Tooltip x={padLeft + slot * hover + slot / 2} y={Math.max(56, y(totals[hover]))} width={width}>
      <p className="mb-1 font-semibold capitalize">{longMonth(months[hover])}</p>
      {segments.map((segment) => <TooltipRow key={segment.key} color={segment.color} label={segment.label} value={format(segment.values[hover] ?? 0)} />)}
      <TooltipRow label="Total" value={format(totals[hover])} strong />
    </Tooltip> : null}
  </div>;
}
