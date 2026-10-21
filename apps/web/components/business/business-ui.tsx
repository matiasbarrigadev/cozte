"use client";

import * as React from "react";
import { formatMoney } from "@/lib/money";
import { toast } from "sonner";
import { buildBusinessView, type BusinessView, type CustomerDirectory } from "@/lib/business";
import type { DomainState } from "@/lib/domain";
import { DEMO_TODAY } from "@/lib/demo";
import { demoBusinessAction, demoCustomerDirectory, demoRecords, demoVersion, subscribeDemo } from "@/lib/demo-store";
import { Button } from "@/components/ui/button";
import { MonthSelect } from "@/components/ui/date-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Today on the person's own clock (not UTC), as AAAA-MM-DD. */
export const todayIso = () => new Date().toLocaleDateString("en-CA");

/** Today for a section: the person's clock, or the demo's own clock so its dates never age. */
export const todayFor = (demo: boolean) => demo ? DEMO_TODAY : todayIso();

/** Re-renders when the demo's in-memory records change. */
export function useDemoVersion(demo: boolean) {
  return React.useSyncExternalStore(subscribeDemo, () => demo ? demoVersion() : 0, () => 0);
}

/**
 * One quiet notice per change, replaced by the next instead of stacking, with "Deshacer" when the change can be
 * reverted. Errors keep their own notice.
 */
export function notifySaved(message: string, undo?: () => void) {
  toast.success(message, { id: "cozte-edit", duration: undo ? 6000 : 2500, ...(undo ? { action: { label: "Deshacer", onClick: undo } } : {}) });
}

/** Amounts for reading (tables, totals and lessons) at the currency's precision: whole units, or cents where it has them. */
export function useMoney(currency: string) {
  return React.useCallback((value: number) => {
    const text = formatMoney(Math.abs(value), currency);
    return value < -0.004 ? `−${text}` : text;
  }, [currency]);
}

/** The month's business view: fetched for a workspace, computed in the browser for the demo. */
/** `month` null loads nothing (a view that is not needed right now). */
export function useBusinessView(month: string | null, demo: boolean, state: DomainState, refreshKey = 0) {
  const [version, setVersion] = React.useState(0);
  const [loaded, setLoaded] = React.useState<{ month: string; version: number; view: BusinessView } | null>(null);
  const demoChanges = useDemoVersion(demo);
  const demoView = React.useMemo(() => demo && month ? buildBusinessView(state, demoRecords(), month) : null, [demo, state, month, demoChanges]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (demo || !month) return;
    let active = true;
    fetch(`/api/business?month=${month}`, { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error((await response.json()).error ?? "No se pudo cargar"); return response.json() as Promise<BusinessView>; })
      .then((view) => { if (active) setLoaded({ month, version, view }); })
      .catch((error) => { if (active) toast.error(error instanceof Error ? error.message : "No se pudo cargar"); });
    return () => { active = false; };
    // The state revision refreshes the view after changes made elsewhere (the sheet or Cozte).
  }, [demo, month, version, state.revision, refreshKey]);
  const view = !month ? null : demo ? demoView : loaded?.view ?? null;
  const loading = !demo && Boolean(month) && (loaded?.month !== month || loaded.version !== version);
  return { view, loading, reload: React.useCallback(() => setVersion((current) => current + 1), []) };
}

/** Calls the business API; in the demo the same action runs on the in-memory records. */
const EMPTY_DIRECTORY: CustomerDirectory = { customers: [], recipients: [], addresses: [], carriers: [] };

/** Customers, recipients, addresses and carriers used before; refetched when `refreshKey` changes. */
export function useCustomerDirectory(demo: boolean, refreshKey: unknown = 0): CustomerDirectory {
  const demoChanges = useDemoVersion(demo);
  const [loaded, setLoaded] = React.useState<CustomerDirectory>(EMPTY_DIRECTORY);
  React.useEffect(() => {
    if (demo) return;
    let active = true;
    fetch("/api/customers", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<CustomerDirectory> : null).then((data) => { if (active && data) setLoaded(data); }).catch(() => {});
    return () => { active = false; };
  }, [demo, refreshKey]);
  const demoData = React.useMemo(() => demo ? demoCustomerDirectory() : null, [demo, demoChanges]); // eslint-disable-line react-hooks/exhaustive-deps
  return demoData ?? loaded;
}

export async function businessAction<T = unknown>(body: Record<string, unknown> & { action: string }, demo = false): Promise<T> {
  if (demo) return demoBusinessAction<T>(body);
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

/** The month a section shows, with arrows to step one month back or forward. */
export function MonthPicker({ month, onChange, today }: { month: string; onChange: (month: string) => void; today?: string }) {
  const step = (delta: number) => { const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1)); onChange(date.toISOString().slice(0, 7)); };
  return <div className="flex items-center gap-1" role="group" aria-label="Mes">
    <Button type="button" variant="outline" size="icon-sm" aria-label="Mes anterior" onClick={() => step(-1)}><ChevronLeft /></Button>
    <MonthSelect value={month} today={today} onChange={(value) => { if (/^\d{4}-\d{2}$/.test(value)) onChange(value); }} aria-label="Mes" className="w-44" />
    <Button type="button" variant="outline" size="icon-sm" aria-label="Mes siguiente" onClick={() => step(1)}><ChevronRight /></Button>
  </div>;
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
  return <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-3 py-3 sm:px-4">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className={cn("text-xl font-semibold tabular-nums break-words sm:text-2xl", tone === "negative" && "text-destructive", tone === "positive" && "text-emerald-700 dark:text-emerald-400")}>{value}</span>
    {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
  </div>;
}

export const formatDate = (value: string) => new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
