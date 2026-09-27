"use client";

import * as React from "react";
import { Bike, Store, Truck } from "lucide-react";
import { toast } from "sonner";
import { WEEKDAY_NAMES, ZONE_MODES, ZONE_MODE_HINTS, ZONE_MODE_LABELS, leadText, parseAreas, placesByZone, weekdaysText, zoneTallies, type DeliveryZone, type ZoneMode } from "@/lib/delivery-zones";
import { customerKey } from "@/lib/customers";
import type { Delivery } from "@/lib/business";
import { AnimatedIcon } from "@/components/animated-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SuggestInput } from "@/components/ui/suggest-input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { businessAction, notifySaved } from "./business-ui";

export type ZonePlace = { zone: string; address: string };

const MODE_ICON: Record<ZoneMode, React.ComponentType<{ className?: string }>> = { own: Bike, carrier: Truck, pickup: Store };
const MODE_TONE: Record<ZoneMode, string> = {
  own: "bg-[color-mix(in_oklab,var(--data-1)_14%,transparent)] text-[var(--data-1)]",
  carrier: "bg-[color-mix(in_oklab,var(--data-2)_14%,transparent)] text-[var(--data-2)]",
  pickup: "bg-[color-mix(in_oklab,var(--data-5)_16%,transparent)] text-[var(--data-5)]",
};

export function ZoneModeChip({ mode, className }: { mode: ZoneMode; className?: string }) {
  const Icon = MODE_ICON[mode];
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", MODE_TONE[mode], className)}><Icon className="size-3.5" aria-hidden="true" />{ZONE_MODE_LABELS[mode]}</span>;
}

/**
 * The delivery zones: how each area is delivered, which days, what it costs and how its deliveries went this month,
 * with the places where customers receive that no zone covers yet, ready to become one.
 */
export function ZonesPanel({ zones, places, deliveries, month, today, carriers, money, demo, onChanged }: {
  zones: DeliveryZone[]; places: ZonePlace[]; deliveries: Delivery[]; month: string; today: string; carriers: string[];
  money: (value: number) => string; demo: boolean; onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState<{ zone?: DeliveryZone; draft?: Partial<DeliveryZone> } | null>(null);
  const grouped = React.useMemo(() => placesByZone(places, zones), [places, zones]);
  const monthly = React.useMemo(() => zoneTallies(deliveries.filter((item) => item.scheduledOn.startsWith(month)), today), [deliveries, month, today]);
  const openByZone = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of deliveries) if (["pending", "on_the_way", "failed"].includes(item.status)) counts.set(item.zoneId ?? "", (counts.get(item.zoneId ?? "") ?? 0) + 1);
    return counts;
  }, [deliveries]);
  const uncovered = grouped.get("") ?? [];
  const placeNames = React.useMemo(() => [...new Set([...grouped.values()].flat().map((place) => place.name))], [grouped]);
  return <Card className="gap-4">
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
      <div className="flex max-w-3xl flex-col gap-1.5"><CardTitle>Zonas de entrega</CardTitle><CardDescription>Cada zona dice cómo llega el pedido, qué días sale y cuánto te cuesta. Las entregas nuevas toman la zona de la dirección del cliente, con su forma, quién la lleva, el día y el costo.</CardDescription></div>
      <Button variant="outline" onClick={() => setEditing({})}><AnimatedIcon name="plus" data-icon="inline-start" />Nueva zona</Button>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {zones.length ? <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Zonas de entrega">
        {zones.map((zone) => {
          const tally = monthly.get(zone.id);
          const open = openByZone.get(zone.id) ?? 0;
          const covered = grouped.get(zone.id) ?? [];
          const rate = tally?.delivered ? Math.round((tally.onTime / tally.delivered) * 100) : null;
          return <li key={zone.id} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="truncate text-base font-semibold">{zone.name}</p>
                <div className="flex flex-wrap items-center gap-1.5"><ZoneModeChip mode={zone.mode} />{zone.isFallback ? <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">Todo lo demás</span> : null}</div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-lg font-semibold tabular-nums">{zone.mode === "pickup" ? "Sin costo" : zone.costPerOrderMinor ? money(zone.costPerOrderMinor) : "—"}</p>
                <p className="text-[11px] text-muted-foreground">{zone.mode === "pickup" ? "retira el cliente" : zone.costPerOrderMinor ? "por pedido" : "costo del canal"}</p>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              {zone.mode !== "pickup" ? <><dt className="text-muted-foreground">Lleva</dt><dd className="truncate">{zone.carrier || "Sin indicar"}</dd></> : null}
              <dt className="text-muted-foreground">Sale</dt><dd>{weekdaysText(zone.weekdays)} · {leadText(zone.leadDays).replace("Sale ", "").toLowerCase()}</dd>
              {zone.areas.length ? <><dt className="text-muted-foreground">Cubre</dt><dd className="truncate" title={zone.areas.join(", ")}>{zone.areas.join(", ")}</dd></> : null}
              {covered.length ? <><dt className="text-muted-foreground">Clientes en</dt><dd className="truncate" title={covered.map((place) => `${place.name} (${place.count})`).join(", ")}>{covered.map((place) => `${place.name} (${place.count})`).join(", ")}</dd></> : null}
            </dl>
            <div className="mt-auto flex items-end justify-between gap-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">{tally ? <>{tally.total} en el mes · {rate === null ? "sin terminar" : `${rate} % a tiempo`} · {money(tally.cost)}</> : "Sin entregas en el mes"}{open ? <><br />{open} por entregar</> : null}</p>
              <Button size="sm" variant="ghost" onClick={() => setEditing({ zone })}><AnimatedIcon name="edit" data-icon="inline-start" size={14} />Editar</Button>
            </div>
          </li>;
        })}
      </ul> : <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Todavía no hay zonas</p>
        <p className="mt-1">Arma una por cada forma de llegar: tu reparto en la ciudad, un transportista para lo que queda lejos y, si corresponde, el retiro en tu local. Desde ahí cada entrega sabe qué día sale y cuánto cuesta.</p>
      </div>}
      {uncovered.length ? <div className="flex flex-col gap-2 rounded-xl bg-muted/40 p-3">
        <p className="text-sm font-medium">Clientes en lugares sin zona</p>
        <div className="flex flex-wrap gap-1.5">
          {uncovered.slice(0, 12).map((place) => <button key={place.name} type="button" onClick={() => setEditing({ draft: { name: place.name, areas: [place.name] } })}
            className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs hover:bg-muted" title={`Crear una zona para ${place.name}`}>
            <AnimatedIcon name="plus" size={12} />{place.name}<span className="text-muted-foreground tabular-nums">{place.count}</span>
          </button>)}
        </div>
        <p className="text-xs text-muted-foreground">Toca un lugar para crear su zona, o agrégalo a una que ya tengas.</p>
      </div> : null}
    </CardContent>
    {editing ? <ZoneDialog zone={editing.zone} draft={editing.draft} zones={zones} places={placeNames} carriers={carriers} demo={demo} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} /> : null}
  </Card>;
}

/** Creates or edits a zone: its name, how it is delivered, the places it covers, its cost, days and lead time. */
export function ZoneDialog({ zone, draft, zones, places, carriers, demo, onClose, onSaved }: {
  zone?: DeliveryZone; draft?: Partial<DeliveryZone>; zones: DeliveryZone[]; places: string[]; carriers: string[]; demo: boolean; onClose: () => void; onSaved: () => void;
}) {
  const start = zone ?? draft ?? {};
  const [mode, setMode] = React.useState<ZoneMode>(start.mode ?? "own");
  const [carrier, setCarrier] = React.useState(start.carrier ?? "");
  const [areas, setAreas] = React.useState((start.areas ?? []).join(", "));
  const [weekdays, setWeekdays] = React.useState<number[]>(start.weekdays ?? []);
  const [busy, setBusy] = React.useState(false);
  const chosen = new Set(parseAreas(areas).map(customerKey));
  const otherFallback = zones.find((item) => item.isFallback && item.id !== zone?.id);
  const addArea = (name: string) => setAreas((current) => parseAreas(`${current},${name}`).join(", "));
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    setBusy(true);
    try {
      const result = await businessAction<{ done: string[] }>({ action: "save-zone", zone: {
        ...(zone ? { id: zone.id } : {}), name: text("name"), mode, carrier: mode === "pickup" ? "" : carrier.trim(), areas: parseAreas(areas),
        costPerOrder: mode === "pickup" ? 0 : Number(text("cost") || 0), weekdays, leadDays: Number(text("lead") || 0), isFallback: mode !== "pickup" && data.get("fallback") === "on", notes: text("notes"),
      } }, demo);
      notifySaved(result.done.join(" · "));
      onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar la zona"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!zone) return;
    setBusy(true);
    try { const result = await businessAction<{ done: string[] }>({ action: "archive-zone", id: zone.id }, demo); notifySaved(result.done[0] ?? "Zona quitada"); onSaved(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo quitar la zona"); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>{zone ? `Zona ${zone.name}` : "Nueva zona de entrega"}</DialogTitle><DialogDescription>Las entregas nuevas a estos lugares toman su forma, quién las lleva, el día y el costo. Lo ya entregado no cambia.</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={submit}><FieldGroup>
      <Field><FieldLabel htmlFor="zone-name">Nombre</FieldLabel><Input id="zone-name" name="name" required minLength={2} maxLength={60} defaultValue={start.name ?? ""} placeholder="Ej. Centro, Zona norte, Resto del país" /></Field>
      <Field><FieldLabel id="zone-mode-label">Cómo llega</FieldLabel>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby="zone-mode-label">
          {ZONE_MODES.map((option) => { const Icon = MODE_ICON[option]; return <button key={option} type="button" role="radio" aria-checked={mode === option} onClick={() => setMode(option)}
            className={cn("flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors", mode === option ? "border-foreground bg-muted/60 ring-1 ring-foreground" : "hover:bg-muted/40")}>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium"><Icon className="size-4" aria-hidden="true" />{ZONE_MODE_LABELS[option]}</span>
            <span className="text-xs text-muted-foreground">{ZONE_MODE_HINTS[option]}</span>
          </button>; })}
        </div>
      </Field>
      {mode !== "pickup" ? <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="zone-carrier">{mode === "own" ? "Quién reparte" : "Empresa o repartidor"}</FieldLabel><SuggestInput id="zone-carrier" value={carrier} maxLength={120} placeholder={mode === "own" ? "Ej. Moto propia (Tomás)" : "Ej. Starken, Andreani"} suggestions={carriers.map((value) => ({ value }))} onValueChange={setCarrier} /></Field>
        <Field><FieldLabel htmlFor="zone-cost">Costo por pedido</FieldLabel><Input id="zone-cost" name="cost" type="number" min="0" step="1" inputMode="numeric" defaultValue={start.costPerOrderMinor || ""} placeholder="0" /><FieldDescription>Lo que te cuesta cada entrega. En 0 se usa el del canal.</FieldDescription></Field>
      </div> : null}
      <Field><FieldLabel htmlFor="zone-areas">Lugares que cubre</FieldLabel>
        <Textarea id="zone-areas" rows={2} value={areas} onChange={(event) => setAreas(event.target.value)} placeholder="Barrios, localidades o ciudades, separados por coma" />
        {places.some((place) => !chosen.has(customerKey(place))) ? <div className="flex flex-wrap gap-1.5">{places.filter((place) => !chosen.has(customerKey(place))).slice(0, 14).map((place) => <button key={place} type="button" onClick={() => addArea(place)} className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted">+ {place}</button>)}</div> : null}
        <FieldDescription>Se compara con la ciudad o el barrio de cada dirección{mode === "pickup" ? "; el retiro se elige a mano en cada entrega" : ""}.</FieldDescription>
      </Field>
      <Field><FieldLabel id="zone-days-label">Días que sale</FieldLabel>
        <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="zone-days-label">
          {WEEKDAY_NAMES.map((name, index) => { const day = index + 1; const on = weekdays.includes(day); return <button key={name} type="button" aria-pressed={on} onClick={() => setWeekdays((current) => on ? current.filter((item) => item !== day) : [...current, day].sort())}
            className={cn("h-9 min-w-11 rounded-md border px-2 text-xs font-medium capitalize", on ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>{name.slice(0, 3)}</button>; })}
        </div>
        <FieldDescription>{weekdays.length ? weekdaysText(weekdays) : "Sin marcar: cualquier día."}</FieldDescription>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="zone-lead">Días desde la venta</FieldLabel><Input id="zone-lead" name="lead" type="number" min="0" max="60" step="1" defaultValue={start.leadDays ?? 0} /><FieldDescription>0: puede salir el mismo día.</FieldDescription></Field>
        {mode !== "pickup" ? <label className="flex items-start gap-2 self-center rounded-lg border p-3 text-sm">
          <input type="checkbox" name="fallback" defaultChecked={start.isFallback ?? false} className="mt-0.5 size-4 accent-[var(--primary)]" />
          <span><span className="font-medium">Todo lo demás</span><span className="block text-xs text-muted-foreground">Para las direcciones que no están en otra zona.{otherFallback ? ` Hoy es ${otherFallback.name}.` : ""}</span></span>
        </label> : null}
      </div>
      <Field><FieldLabel htmlFor="zone-notes">Notas</FieldLabel><Input id="zone-notes" name="notes" maxLength={500} defaultValue={start.notes ?? ""} placeholder="Horario de salida, dónde se despacha…" /></Field>
    </FieldGroup>
      <DialogFooter className="gap-2 sm:justify-between">
        {zone ? <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void remove()}><AnimatedIcon name="delete" data-icon="inline-start" />Quitar zona</Button> : <span />}
        <div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : zone ? "Guardar" : "Crear zona"}</Button></div>
      </DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
