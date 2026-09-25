"use client";

import * as React from "react";
import { toast } from "sonner";
import { buildBusinessView, type BusinessView } from "@/lib/business";
import type { DomainState } from "@/lib/domain";
import { demoBusinessRecords } from "@/lib/demo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Whole amounts for reading: tables, totals and lessons. */
export function useMoney(currency: string) {
  return React.useCallback((value: number) => {
    const text = new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: Math.abs(value) < 100 && currency !== "CLP" ? 2 : 0 }).format(Math.abs(value));
    return value < -0.004 ? `−${text}` : text;
  }, [currency]);
}

/** The month's business view: fetched for a workspace, computed in the browser for the demo. */
export function useBusinessView(month: string, demo: boolean, state: DomainState, refreshKey = 0) {
  const [version, setVersion] = React.useState(0);
  const [loaded, setLoaded] = React.useState<{ month: string; version: number; view: BusinessView } | null>(null);
  const demoView = React.useMemo(() => demo ? buildBusinessView(state, demoBusinessRecords(), month) : null, [demo, state, month]);
  React.useEffect(() => {
    if (demo) return;
    let active = true;
    fetch(`/api/business?month=${month}`, { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error((await response.json()).error ?? "No se pudo cargar"); return response.json() as Promise<BusinessView>; })
      .then((view) => { if (active) setLoaded({ month, version, view }); })
      .catch((error) => { if (active) toast.error(error instanceof Error ? error.message : "No se pudo cargar"); });
    return () => { active = false; };
    // The state revision refreshes the view after changes made elsewhere (the sheet or Cozte).
  }, [demo, month, version, state.revision, refreshKey]);
  const view = demo ? demoView : loaded?.view ?? null;
  const loading = !demo && (loaded?.month !== month || loaded.version !== version);
  return { view, loading, reload: React.useCallback(() => setVersion((current) => current + 1), []) };
}

export async function businessAction<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/business", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "No se pudo guardar");
  return data as T;
}

/** Uploads a receipt or delivery note and returns its document id. */
export async function uploadDocument(file: File): Promise<string> {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch("/api/documents", { method: "POST", body });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "No se pudo subir el comprobante");
  return data.id as string;
}

export function ReceiptLink({ documentId, demo, label = "Ver" }: { documentId?: string | null; demo: boolean; label?: string }) {
  if (!documentId) return <span className="text-xs text-muted-foreground">—</span>;
  return <Button type="button" size="sm" variant="link" className="h-auto px-0" disabled={demo} onClick={async () => {
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo abrir");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo abrir"); }
  }}>{label}</Button>;
}

export function MonthPicker({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  return <label className="flex items-center gap-2 text-sm text-muted-foreground">Mes<Input type="month" value={month} onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.target.value)) onChange(event.target.value); }} className="w-auto" /></label>;
}

export function SectionHeader({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-3">
    <div className="max-w-2xl"><p className="text-sm text-muted-foreground">{eyebrow}</p><h1 className="text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>
    {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
  </div>;
}

/** A short lesson next to the numbers it explains. */
export function Tip({ title = "Para entender", children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return <aside className={cn("flex flex-col gap-1 rounded-lg border-l-4 border-l-primary bg-muted/40 px-4 py-3 text-sm", className)}>
    <p className="font-semibold">{title}</p>
    <div className="leading-relaxed text-muted-foreground">{children}</div>
  </aside>;
}

export function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "positive" | "negative" }) {
  return <div className="flex flex-col gap-1 rounded-xl border bg-card px-4 py-3">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className={cn("text-2xl font-semibold tabular-nums", tone === "negative" && "text-destructive", tone === "positive" && "text-emerald-700 dark:text-emerald-400")}>{value}</span>
    {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
  </div>;
}

export const formatDate = (value: string) => new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
