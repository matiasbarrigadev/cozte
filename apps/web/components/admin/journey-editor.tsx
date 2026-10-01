"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CONDITIONS, MODULES } from "@/lib/journey";

type Journey = { key: string; name: string; stored: boolean; error: string | null; json: string; stages: { id: string; title: string }[] };
type Metric = { key: string; stageId: string; started: number; completed: number; medianDays: number | null };

/**
 * The discovery paths, editable as JSON and measured: how many companies started and completed each stage, and how
 * long it took them. A save takes effect without a release; the built-in path comes back with "Restaurar".
 */
export function JourneyEditor({ journeys, metrics }: { journeys: Journey[]; metrics: Metric[] }) {
  const router = useRouter();
  const [selected, setSelected] = React.useState(journeys[0]?.key ?? "operating");
  const [newKey, setNewKey] = React.useState("");
  const current = journeys.find((item) => item.key === selected);
  const [draft, setDraft] = React.useState(current?.json ?? "");
  const [busy, setBusy] = React.useState(false);

  function choose(key: string) {
    setSelected(key);
    setDraft(journeys.find((item) => item.key === key)?.json ?? journeys.find((item) => item.key === "project")?.json ?? "");
  }

  async function save(key: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/journeys", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, json: draft }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo guardar");
      toast.success(`Recorrido «${key}» guardado`);
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar"); }
    finally { setBusy(false); }
  }

  async function reset() {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/journeys?key=${encodeURIComponent(selected)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("No se pudo restaurar");
      toast.success("Volvió el recorrido de fábrica");
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo restaurar"); }
    finally { setBusy(false); }
  }

  const rows = (current?.stages ?? []).map((stage) => ({ stage, metric: metrics.find((item) => item.key === selected && item.stageId === stage.id) }));
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center gap-2">
      {journeys.map((item) => <Button key={item.key} type="button" size="sm" variant={item.key === selected ? "secondary" : "outline"} onClick={() => choose(item.key)}>{item.name} <span className="text-muted-foreground">· {item.key}</span>{item.stored ? <Badge variant="outline" className="ml-1">editado</Badge> : null}</Button>)}
      <div className="flex items-center gap-1"><Input value={newKey} onChange={(event) => setNewKey(event.target.value.toLowerCase())} placeholder="nueva-clave (ej. curso)" className="h-8 w-44" aria-label="Clave de un recorrido nuevo" /><Button type="button" size="sm" variant="outline" disabled={busy || !/^[a-z0-9-]{2,40}$/.test(newKey)} onClick={() => void save(newKey)}>Crear con este JSON</Button></div>
    </div>
    {current?.error ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">El guardado no es válido ({current.error}); se usa el de fábrica.</p> : null}
    <div className="overflow-x-auto"><Table>
      <TableHeader><TableRow><TableHead>Etapa</TableHead><TableHead className="text-right">Empezaron</TableHead><TableHead className="text-right">Completaron</TableHead><TableHead className="text-right">Días hasta completar (mediana)</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map(({ stage, metric }) => <TableRow key={stage.id}><TableCell>{stage.title} <span className="text-xs text-muted-foreground">· {stage.id}</span></TableCell><TableCell className="text-right tabular-nums">{metric?.started ?? 0}</TableCell><TableCell className="text-right tabular-nums">{metric?.completed ?? 0}</TableCell><TableCell className="text-right tabular-nums">{metric?.medianDays ?? "—"}</TableCell></TableRow>)}</TableBody>
    </Table></div>
    <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-96 font-mono text-xs" spellCheck={false} aria-label={`Definición del recorrido ${selected}`} />
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Reglas y secciones disponibles</summary>
      <p className="mt-2"><strong>completeWhen</strong> (todas deben cumplirse): {Object.entries(CONDITIONS).map(([key, value]) => `${key} (${value.label})`).join(" · ")}</p>
      <p className="mt-1"><strong>unlocks, alwaysOpen, sellingOnly, afterFirstSale</strong>: {Object.entries(MODULES).map(([key, value]) => `${key} (${value.label})`).join(" · ")}</p>
    </details>
    <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={() => void save(selected)}>{busy ? "Guardando…" : "Guardar"}</Button><Button type="button" variant="outline" disabled={busy || !current?.stored} onClick={() => void reset()}>Restaurar el de fábrica</Button></div>
  </div>;
}
