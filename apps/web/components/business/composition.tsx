"use client";

import type { CostComposition } from "@/lib/dashboard-summary";

export const COMPOSITION_PARTS = [
  { key: "materials", label: "Insumos", color: "var(--chart-series-1)" },
  { key: "labor", label: "Mano de obra directa", color: "var(--chart-series-2)" },
  { key: "shared", label: "Gastos compartidos", color: "var(--chart-series-3)" },
] as const;

export function CompositionLegend() {
  return <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Partes del costo">
    {COMPOSITION_PARTS.map((part) => <li key={part.key} className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block size-2.5 rounded-sm" style={{ background: part.color }} />{part.label}</li>)}
  </ul>;
}

/** Stacked bar of one unit's cost: materials, direct labor and shared expenses, with the largest part named. */
export function CompositionBar({ parts, format }: { parts: CostComposition; format: (value: number) => string }) {
  const total = parts.materials + parts.labor + parts.shared;
  if (total <= 0) return null;
  const share = (value: number) => Math.round(value / total * 100);
  const present = COMPOSITION_PARTS.filter((part) => parts[part.key] > 0);
  const largest = [...present].sort((a, b) => parts[b.key] - parts[a.key])[0];
  return <div className="flex flex-col gap-1">
    <div role="img" aria-label={present.map((part) => `${part.label} ${share(parts[part.key])} %`).join(", ")} className="flex h-2.5 w-full gap-[2px]">
      {present.map((part) => <span key={part.key} title={`${part.label}: ${format(parts[part.key])} por unidad (${share(parts[part.key])} %)`} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${parts[part.key] / total * 100}%`, background: part.color }} />)}
    </div>
    <span className="text-xs text-muted-foreground">{share(parts[largest.key])} % {largest.label.toLocaleLowerCase("es")}</span>
  </div>;
}
