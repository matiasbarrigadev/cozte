import * as React from "react";
import { formatMoney, formatValue, type ChartData, type MetricFormat } from "@/lib/decks";

/**
 * Charts drawn for the 1280×720 slide canvas: fixed pixel sizes, thin marks with rounded data ends, one hue for
 * magnitude, the validated categorical slots for composition, a legend whenever there are two or more series,
 * and every mark labeled or titled so the figure can be read without hovering.
 */

type Size = { width: number; height: number; currency: string };

const compact = (value: number, unit: MetricFormat, currency: string, digits?: number) => unit === "money"
  ? new Intl.NumberFormat("es-CL", { style: "currency", currency, notation: "compact", ...(digits ? { maximumSignificantDigits: digits } : { maximumFractionDigits: 1 }) }).format(value)
  : new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 }).format(value);

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = Math.max(max - min, 1);
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? raw;
  const ticks: number[] = [];
  for (let value = Math.floor(min / step) * step; value <= max + step * 0.001; value += step) ticks.push(Math.round(value * 1e6) / 1e6);
  if (ticks.at(-1)! < max) ticks.push(ticks.at(-1)! + step);
  return ticks;
}

const SERIES = ["var(--deck-s1)", "var(--deck-s2)", "var(--deck-s3)", "var(--deck-s4)", "var(--deck-s5)", "var(--deck-s6)"];

export function DeckChart({ data, width, height, currency }: { data: ChartData } & Size) {
  switch (data.type) {
    case "bars": return <Bars data={data} width={width} height={height} currency={currency} />;
    case "stacked": return <Stacked data={data} width={width} height={height} currency={currency} />;
    case "columns": return <Columns data={data} width={width} height={height} currency={currency} />;
    case "waterfall": return <Waterfall data={data} width={width} height={height} currency={currency} />;
    case "progress": return <Progress data={data} width={width} height={height} currency={currency} />;
    case "line": return <Line data={data} width={width} height={height} currency={currency} />;
    case "table": return <Table data={data} width={width} height={height} />;
    case "empty": return <div className="deck-empty" style={{ width, height }}><span>{data.message}</span></div>;
  }
}

function Bars({ data, width, height, currency }: { data: Extract<ChartData, { type: "bars" }> } & Size) {
  const rows = data.rows;
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  const groups = new Set(rows.map((row) => row.group).filter(Boolean)).size;
  const rowHeight = Math.min(84, (height - groups * 34) / Math.max(rows.length, 1));
  const barHeight = Math.max(12, Math.min(30, rowHeight * 0.42));
  const labelWidth = Math.min(300, width * 0.34);
  const valueWidth = 190;
  const track = width - labelWidth - valueWidth - 24;
  const withNotes = rowHeight >= 62;
  return <ul className="deck-bars" style={{ width, height }} aria-label="Gráfico de barras">
    {rows.map((row, index) => <React.Fragment key={`${row.group ?? ""}-${row.label}`}>
      {row.group && row.group !== rows[index - 1]?.group ? <li className="deck-bar-group" style={{ height: 34 }}>{row.group}</li> : null}
      <li style={{ height: rowHeight }} title={`${row.label}: ${formatValue(row.value, data.unit, currency)}${row.note ? ` · ${row.note}` : ""}`}>
      <span className="deck-bar-label" style={{ width: labelWidth }}>
        <span className="deck-bar-name">{row.label}</span>
        {withNotes && row.note ? <span className="deck-bar-note">{row.note}</span> : null}
      </span>
      <span className="deck-bar-track" style={{ width: track }}>
        <span className="deck-bar-fill" style={{ width: Math.max(6, Math.abs(row.value) / max * track), height: barHeight, background: row.tone === "negative" ? "var(--deck-negative)" : "var(--deck-bar)" }} />
      </span>
      <span className="deck-bar-value" style={{ width: valueWidth }}>
        {formatValue(row.value, data.unit, currency)}
        {data.total ? <span className="deck-bar-share">{Math.round(Math.abs(row.value) / data.total * 100)} %</span> : null}
      </span>
    </li></React.Fragment>)}
  </ul>;
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return <ul className="deck-legend">{items.map((item) => <li key={item.label}><span style={{ background: item.color }} aria-hidden="true" />{item.label}</li>)}</ul>;
}

function Stacked({ data, width, height, currency }: { data: Extract<ChartData, { type: "stacked" }> } & Size) {
  const max = Math.max(1, ...data.rows.map((row) => row.total));
  const available = height - 64;
  const rowHeight = Math.min(84, available / Math.max(data.rows.length, 1));
  const barHeight = Math.max(14, Math.min(32, rowHeight * 0.45));
  const labelWidth = Math.min(300, width * 0.34);
  const valueWidth = 170;
  const track = width - labelWidth - valueWidth - 24;
  return <div style={{ width, height }} className="deck-stacked">
    <Legend items={data.keys.map((key, index) => ({ label: key.label, color: SERIES[index] }))} />
    <ul className="deck-stacked-rows">
      {data.rows.map((row) => {
        const present = data.keys.map((key, index) => ({ ...key, color: SERIES[index], value: row.parts[key.key] ?? 0 })).filter((part) => part.value > 0);
        return <li key={row.label} style={{ height: rowHeight }}>
          <span className="deck-bar-label" style={{ width: labelWidth }}><span className="deck-bar-name">{row.label}</span></span>
          <span className="deck-bar-track" style={{ width: track }}>
            <span className="deck-stack" style={{ width: Math.max(8, row.total / max * track), height: barHeight }}>
              {present.map((part) => <span key={part.key} title={`${part.label}: ${formatMoney(part.value, currency)} (${Math.round(part.value / row.total * 100)} %)`} style={{ flexGrow: part.value, background: part.color }} />)}
            </span>
          </span>
          <span className="deck-bar-value" style={{ width: valueWidth }}>{formatMoney(row.total, currency)}</span>
        </li>;
      })}
    </ul>
  </div>;
}

function Columns({ data, width, height, currency }: { data: Extract<ChartData, { type: "columns" }> } & Size) {
  const margin = { top: 36, right: 12, bottom: 40, left: 96 };
  const ticks = niceTicks(0, Math.max(1, ...data.rows.map((row) => row.value)));
  const top = ticks.at(-1)!;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const slot = plotWidth / data.rows.length;
  const barWidth = Math.max(4, Math.min(44, slot * 0.62));
  const y = (value: number) => margin.top + plotHeight - value / top * plotHeight;
  const best = data.rows.reduce((index, row, current) => row.value > data.rows[index].value ? current : index, 0);
  const every = data.rows.length > 20 ? 5 : data.rows.length > 10 ? 2 : 1;
  return <svg width={width} height={height} role="img" aria-label="Gráfico de columnas" className="deck-svg">
    {ticks.map((tick) => <g key={tick}><line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} className="deck-grid" /><text x={margin.left - 14} y={y(tick) + 6} textAnchor="end" className="deck-axis">{compact(tick, data.unit, currency)}</text></g>)}
    {data.rows.map((row, index) => {
      const x = margin.left + slot * index + (slot - barWidth) / 2;
      const barHeight = Math.max(row.value > 0 ? 3 : 0, margin.top + plotHeight - y(row.value));
      return <g key={row.label}>
        <title>{`Día ${row.label}: ${formatValue(row.value, data.unit, currency)}`}</title>
        {barHeight ? <path d={roundedTop(x, margin.top + plotHeight - barHeight, barWidth, barHeight, Math.min(5, barWidth / 2))} fill={index === best ? "var(--deck-bar)" : "var(--deck-bar-soft)"} /> : null}
        {(index + 1) % every === 0 || index === 0 ? <text x={x + barWidth / 2} y={height - 12} textAnchor="middle" className="deck-axis">{row.label}</text> : null}
        {index === best && row.value > 0 ? <text x={x + barWidth / 2} y={margin.top + plotHeight - barHeight - 12} textAnchor="middle" className="deck-mark-label">{formatValue(row.value, data.unit, currency)}</text> : null}
      </g>;
    })}
    <line x1={margin.left} x2={width - margin.right} y1={margin.top + plotHeight} y2={margin.top + plotHeight} className="deck-baseline" />
  </svg>;
}

function roundedTop(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

function wrap(label: string, max = 11): string[] {
  const words = label.split(" ");
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last !== undefined && (last + " " + word).length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.slice(0, 3);
}

/** Running level after each step: sales start it, costs lower it, the result lands where the level ends. */
function waterfallBars(steps: Extract<ChartData, { type: "waterfall" }>["steps"]) {
  const bars: (typeof steps[number] & { from: number; to: number })[] = [];
  let level = 0;
  for (const step of steps) {
    if (step.kind === "start") { level = step.value; bars.push({ ...step, from: 0, to: step.value }); }
    else if (step.kind === "minus") { bars.push({ ...step, from: level, to: level - step.value }); level -= step.value; }
    else bars.push({ ...step, from: 0, to: step.value });
  }
  return bars;
}

function Waterfall({ data, width, height, currency }: { data: Extract<ChartData, { type: "waterfall" }> } & Size) {
  const margin = { top: 44, right: 8, bottom: 78, left: 8 };
  const bars = waterfallBars(data.steps);
  const values = bars.flatMap((bar) => [bar.from, bar.to]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const plotHeight = height - margin.top - margin.bottom;
  const y = (value: number) => margin.top + (max - value) / (max - min) * plotHeight;
  const slot = (width - margin.left - margin.right) / bars.length;
  const barWidth = Math.min(96, slot * 0.6);
  const fill = (bar: (typeof bars)[number]) => bar.kind === "start" ? "var(--deck-bar)" : bar.kind === "minus" ? "var(--deck-cost)" : bar.value >= 0 ? "var(--deck-positive)" : "var(--deck-negative)";
  return <svg width={width} height={height} role="img" aria-label="Cascada del resultado del mes" className="deck-svg">
    <line x1={margin.left} x2={width - margin.right} y1={y(0)} y2={y(0)} className="deck-baseline" />
    {bars.map((bar, index) => {
      const x = margin.left + slot * index + (slot - barWidth) / 2;
      const top = y(Math.max(bar.from, bar.to));
      const barHeight = Math.max(3, Math.abs(y(bar.from) - y(bar.to)));
      const next = bars[index + 1];
      const labelY = bar.kind === "result" && bar.value < 0 ? y(0) - 14 : top - 14;
      const amount = slot >= 130 ? formatMoney(Math.abs(bar.value), currency) : compact(Math.abs(bar.value), "money", currency, 3);
      return <g key={bar.label}>
        <title>{`${bar.label}: ${bar.kind === "minus" ? "−" : ""}${formatMoney(bar.value, currency)}`}</title>
        <rect x={x} y={top} width={barWidth} height={barHeight} rx={6} fill={fill(bar)} />
        {next && next.kind !== "result" ? <line x1={x + barWidth} x2={x + slot + (slot - barWidth) / 2} y1={y(bar.to)} y2={y(bar.to)} className="deck-connector" /> : null}
        <text x={x + barWidth / 2} y={labelY} textAnchor="middle" className={bar.kind === "result" ? "deck-mark-label deck-mark-strong" : "deck-mark-label"}>{bar.kind === "minus" || bar.value < 0 ? "−" : ""}{amount}</text>
        {wrap(bar.label).map((line, lineIndex) => <text key={line} x={x + barWidth / 2} y={height - margin.bottom + 28 + lineIndex * 20} textAnchor="middle" className={bar.kind === "result" ? "deck-axis deck-axis-strong" : "deck-axis"}>{line}</text>)}
      </g>;
    })}
  </svg>;
}

function Progress({ data, width, height, currency }: { data: Extract<ChartData, { type: "progress" }> } & Size) {
  const scale = Math.max(data.value, data.target) * 1.12 || 1;
  const percent = Math.round(data.value / data.target * 100);
  const reached = data.value >= data.target;
  return <div className="deck-progress" style={{ width, height }}>
    <div className="deck-progress-figure"><span className="deck-heading">{percent} %</span><span>{reached ? "de lo necesario: ¡superado!" : "de lo necesario para no perder"}</span></div>
    <div className="deck-progress-track" role="img" aria-label={`${data.valueLabel} ${formatMoney(data.value, currency)} de ${formatMoney(data.target, currency)}`}>
      <span className="deck-progress-fill" style={{ width: `${data.value / scale * 100}%`, background: reached ? "var(--deck-positive)" : "var(--deck-bar)" }} />
      <span className="deck-progress-target" style={{ left: `${data.target / scale * 100}%` }} />
    </div>
    <div className="deck-progress-labels">
      <span><strong>{formatMoney(data.value, currency)}</strong>{data.valueLabel}</span>
      <span style={{ textAlign: "right" }}><strong>{formatMoney(data.target, currency)}</strong>{data.targetLabel}</span>
    </div>
  </div>;
}

function Line({ data, width, height, currency }: { data: Extract<ChartData, { type: "line" }> } & Size) {
  const legend = data.series.length >= 2;
  const direct = data.series.length <= 4;
  const margin = { top: legend ? 64 : 24, right: direct ? 190 : 24, bottom: 40, left: 110 };
  const values = data.series.flatMap((series) => series.values.filter((value): value is number => value !== null));
  const ticks = niceTicks(0, Math.max(1, ...values));
  const top = ticks.at(-1)!;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const x = (index: number) => margin.left + (data.periods.length === 1 ? plotWidth / 2 : index / (data.periods.length - 1) * plotWidth);
  const y = (value: number) => margin.top + plotHeight - value / top * plotHeight;
  const every = Math.ceil(data.periods.length / 8);
  // Direct labels sit at each line's last point, nudged apart so they never overlap.
  const ends = data.series.map((series, index) => {
    const last = series.values.reduce<number | null>((found, value, position) => value !== null ? position : found, null);
    return last === null ? null : { index, y: y(series.values[last]!), value: series.values[last]!, label: series.label };
  }).filter((item): item is NonNullable<typeof item> => item !== null).sort((a, b) => a.y - b.y);
  for (let index = 1; index < ends.length; index++) if (ends[index].y - ends[index - 1].y < 40) ends[index].y = ends[index - 1].y + 40;
  return <div style={{ width, height, position: "relative" }}>
    {legend ? <Legend items={data.series.map((series, index) => ({ label: series.label, color: SERIES[index] }))} /> : null}
    <svg width={width} height={height} role="img" aria-label="Evolución en el tiempo" className="deck-svg" style={{ position: "absolute", inset: 0 }}>
      {ticks.map((tick) => <g key={tick}><line x1={margin.left} x2={margin.left + plotWidth} y1={y(tick)} y2={y(tick)} className="deck-grid" /><text x={margin.left - 14} y={y(tick) + 6} textAnchor="end" className="deck-axis">{compact(tick, "money", currency)}</text></g>)}
      {data.periods.map((period, index) => index % every === 0 || index === data.periods.length - 1 ? <text key={period + index} x={x(index)} y={height - 10} textAnchor="middle" className="deck-axis">{period}</text> : null)}
      {data.series.map((series, index) => {
        const segments: string[] = [];
        let open = false;
        series.values.forEach((value, position) => {
          if (value === null) { open = false; return; }
          segments.push(`${open ? "L" : "M"}${x(position)},${y(value)}`);
          open = true;
        });
        return <g key={series.label}>
          <path d={segments.join("")} fill="none" stroke={SERIES[index]} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
          {series.values.map((value, position) => value === null ? null : <circle key={position} cx={x(position)} cy={y(value)} r={5} fill={SERIES[index]} stroke="var(--deck-bg)" strokeWidth={2}><title>{`${series.label} · ${data.periods[position]}: ${formatMoney(value, currency)}`}</title></circle>)}
        </g>;
      })}
      {direct ? ends.map((end) => <text key={end.label} x={margin.left + plotWidth + 16} y={end.y + 6} className="deck-direct-label"><tspan fill={SERIES[end.index]}>●</tspan> {formatMoney(end.value, currency)}</text>) : null}
    </svg>
  </div>;
}

function Table({ data, width, height }: { data: Extract<ChartData, { type: "table" }>; width: number; height: number }) {
  return <div style={{ width, maxHeight: height, overflow: "hidden" }}>
    <table className="deck-table">
      <thead><tr>{data.columns.map((column, index) => <th key={column} style={{ textAlign: data.align[index] }}>{column}</th>)}</tr></thead>
      <tbody>{data.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => <td key={index} style={{ textAlign: data.align[index] }}>{cell}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}
