"use client";

import * as React from "react";
import type { DomainState } from "@/lib/domain";
import { AnimatedIcon } from "@/components/animated-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type CostSnapshotRow = { id: string; product_id: string; total_lot_minor: number | null; unit_minor: number | null; margin_percent: number | null; lines_json: string; warnings_json: string; context_json: string; cost_view: string; created_at: string };
export type ProfileSnapshotRow = { id: string; revision: number; profile_json: string; costs_json: string; fx_context_json?: string; actor_id: string; created_at: string };
export type HistoryEntry = { id: string; action: string; entity_id: string | null; created_at: string; actor_id: string };

type CostContext = { product?: { name?: string; lotUnits?: number }; materials?: { id: string; name: string; priceMinor: number | null; source: string | null }[]; activePeriod?: string };
type CostLine = { kind: string; label: string; amountMinor: number; materialId?: string };

function parseJson<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }
function labelChange(current: CostSnapshotRow, previous?: CostSnapshotRow): string {
  if (!previous) return "Primera foto";
  const now = parseJson<CostLine[]>(current.lines_json, []);
  const before = parseJson<CostLine[]>(previous.lines_json, []);
  const largest = now.map((line) => ({ line, difference: line.amountMinor - (before.find((other) => other.kind === line.kind && other.materialId === line.materialId && other.label === line.label)?.amountMinor ?? 0) })).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))[0];
  const currentContext = parseJson<CostContext>(current.context_json, {});
  const beforeContext = parseJson<CostContext>(previous.context_json, {});
  if (currentContext.product?.lotUnits && beforeContext.product?.lotUnits && currentContext.product.lotUnits !== beforeContext.product.lotUnits) return "Cambió el tamaño del lote";
  if (largest && largest.difference !== 0) return `Varió ${largest.line.label}`;
  return "Sin variación de componentes";
}

export function CostHistory({ state, events, snapshots, profileSnapshots }: { state: DomainState; events: HistoryEntry[]; snapshots: CostSnapshotRow[]; profileSnapshots: ProfileSnapshotRow[] }) {
  const [selected, setSelected] = React.useState<CostSnapshotRow | null>(null);
  const money = (value: number | null) => value === null ? "Incompleto" : new Intl.NumberFormat("es-CL", { style: "currency", currency: state.organization.currency, maximumFractionDigits: 0 }).format(value);
  return <>
    <div><p className="text-sm text-muted-foreground">Evolución</p><h1 className="text-3xl font-semibold tracking-tight">Historial de costos</h1><p className="text-sm text-muted-foreground">Cada cambio confirmado conserva su foto, incluso si después cambian las reglas.</p></div>
    <Card><CardHeader><CardTitle>Fotos de costos por producto</CardTitle><CardDescription>Variación frente a la foto anterior del mismo producto.</CardDescription></CardHeader><CardContent>{snapshots.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Producto</TableHead><TableHead>Costo por unidad apta</TableHead><TableHead>Variación</TableHead><TableHead>Principal cambio</TableHead><TableHead>Detalle</TableHead></TableRow></TableHeader><TableBody>{snapshots.slice(0, 50).map((item, index) => {
      const previous = snapshots.slice(index + 1).find((entry) => entry.product_id === item.product_id);
      const context = parseJson<CostContext>(item.context_json, {});
      const name = context.product?.name ?? state.products.find((product) => product.id === item.product_id)?.name ?? "Producto eliminado";
      const difference = item.unit_minor !== null && previous?.unit_minor != null ? item.unit_minor - previous.unit_minor : null;
      return <TableRow key={item.id}><TableCell className="whitespace-nowrap">{new Date(item.created_at).toLocaleString("es-CL")}</TableCell><TableCell className="font-medium">{name}</TableCell><TableCell className="tabular-nums">{money(item.unit_minor)}</TableCell><TableCell className="tabular-nums">{difference === null ? "—" : `${difference > 0 ? "+" : ""}${money(difference)}`}</TableCell><TableCell>{labelChange(item, previous)}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setSelected(item)}><AnimatedIcon name="history" data-icon="inline-start" />Ver foto</Button></TableCell></TableRow>;
    })}</TableBody></Table></div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><AnimatedIcon name="history" size={24} /></EmptyMedia><EmptyTitle>Sin fotos todavía</EmptyTitle><EmptyDescription>La primera aparecerá cuando confirmes un cambio de costos.</EmptyDescription></EmptyHeader></Empty>}</CardContent></Card>
    <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>Versiones del proceso</CardTitle><CardDescription>Mapas y cálculos conservados al confirmar</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">{profileSnapshots.length ? profileSnapshots.map((item) => { const profile = parseJson<{ site?: { name: string }; products?: { name: string }[] }>(item.profile_json, {}); const costs = parseJson<{ product: string; unitMinor: number | null }[]>(item.costs_json, []); return <div key={item.id} className="flex flex-col gap-1 border-b pb-2 text-sm"><div className="flex items-center justify-between gap-2"><span>Versión {item.revision} · {profile.site?.name ?? "sin planta"} · {profile.products?.length ?? 0} productos</span><span className="text-muted-foreground">{new Date(item.created_at).toLocaleDateString("es-CL")}</span></div><span className="text-xs text-muted-foreground">{costs.map((cost) => `${cost.product}: ${money(cost.unitMinor)}`).join(" · ") || "Costos todavía incompletos"}</span></div>; }) : <p className="text-sm text-muted-foreground">Aún no hay mapas confirmados.</p>}</CardContent></Card><Card><CardHeader><CardTitle>Actividad</CardTitle><CardDescription>Acciones confirmadas por tu equipo</CardDescription></CardHeader><CardContent className="flex max-h-64 flex-col gap-2 overflow-y-auto text-sm">{events.length ? events.slice(0, 15).map((item) => <div key={item.id} className="flex justify-between gap-2 border-b pb-2"><span>{item.action}</span><span className="text-muted-foreground">{new Date(item.created_at).toLocaleString("es-CL")}</span></div>) : <p className="text-muted-foreground">Todavía no hay actividad.</p>}</CardContent></Card></div>
    <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Foto inmutable del costo</DialogTitle><DialogDescription>{selected ? new Date(selected.created_at).toLocaleString("es-CL") : ""} · {selected ? parseJson<CostContext>(selected.context_json, {}).product?.name ?? "Producto" : ""}</DialogDescription></DialogHeader>{selected ? <div className="flex flex-col gap-4 text-sm"><div className="flex flex-wrap gap-2"><Badge variant="secondary">{money(selected.unit_minor)} por unidad apta</Badge><Badge variant="outline">{money(selected.total_lot_minor)} por lote</Badge><Badge variant="outline">{selected.cost_view === "estimated_current" ? "Estimado vigente" : selected.cost_view}</Badge></div><Table><TableHeader><TableRow><TableHead>Concepto</TableHead><TableHead className="text-right">Lote</TableHead></TableRow></TableHeader><TableBody>{parseJson<CostLine[]>(selected.lines_json, []).map((line, index) => <TableRow key={`${line.kind}-${line.materialId ?? index}`}><TableCell>{line.label}</TableCell><TableCell className="text-right tabular-nums">{money(line.amountMinor)}</TableCell></TableRow>)}</TableBody></Table>{parseJson<string[]>(selected.warnings_json, []).length ? <p className="text-muted-foreground">Datos faltantes: {parseJson<string[]>(selected.warnings_json, []).join(" · ")}</p> : null}<p className="text-xs text-muted-foreground">Período: {parseJson<CostContext>(selected.context_json, {}).activePeriod ?? "no registrado"}. La foto conserva los datos usados al confirmarse y no cambia con ediciones posteriores.</p></div> : null}</DialogContent></Dialog>
  </>;
}
