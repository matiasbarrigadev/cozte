"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Copy, MapPin, MessageCircle, Navigation, Phone, Route as RouteIcon, Truck } from "lucide-react";
import { toast } from "sonner";
import type { Delivery, DeliveryStatus } from "@/lib/business";
import { mapsDirectionsLink, mapsRouteLinks, mapsSearchLink, routeDayLabel, routeSheet, routeText, suggestRouteOrder, whatsappChatLink, whatsappShareLink, type RouteGroup, type RouteStop } from "@/lib/delivery-routes";
import type { DeliveryZone } from "@/lib/delivery-zones";
import { AnimatedIcon } from "@/components/animated-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { businessAction, notifySaved } from "./business-ui";
import { EditableText, downloadCsv } from "./data-table";
import { ZoneModeChip } from "./delivery-zones";

type Patch = Partial<Pick<Delivery, "scheduledOn" | "status" | "tracking" | "note">>;
type SaveDelivery = (delivery: Delivery, patch: Patch, message?: string) => Promise<boolean>;

const addDays = (date: string, count: number) => new Date(Date.parse(`${date}T12:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
const ROUTE_COLOR: Record<RouteGroup["mode"], string> = { own: "var(--data-1)", none: "var(--data-4)", carrier: "var(--data-2)", pickup: "var(--data-5)" };

async function copy(text: string, message = "Copiado") {
  try { await navigator.clipboard.writeText(text); toast.success(message); }
  catch { toast.error("No se pudo copiar"); }
}

/**
 * The day's route sheet: open deliveries by zone, in driving order for own delivery (time windows first, neighborhood
 * by neighborhood), with the route in Google Maps, a text for WhatsApp and a driver mode; the carriers' dispatch list;
 * the pickups; and what failed, to reschedule.
 */
export function RouteSheet({ deliveries, zones, routeOrigin, today, country, businessName, demo, onSave, onChanged }: {
  deliveries: Delivery[]; zones: DeliveryZone[]; routeOrigin: string; today: string; country: string; businessName: string; demo: boolean;
  onSave: SaveDelivery; onChanged: () => void;
}) {
  const [date, setDate] = React.useState(today);
  // The driver works on the route as it was when they started: delivered stops leave the sheet, not their list.
  const [driving, setDriving] = React.useState<RouteGroup | null>(null);
  const sheet = React.useMemo(() => routeSheet(deliveries, date, today, zones), [deliveries, date, today, zones]);
  const tomorrow = addDays(today, 1);
  const count = (day: string) => routeSheet(deliveries, day, today, zones).groups.reduce((sum, group) => sum + group.stops.length, 0);
  const stops = sheet.groups.reduce((sum, group) => sum + group.stops.length, 0);
  const dayLabel = routeDayLabel(date, today);
  const nextDay = React.useMemo(() => [...new Set(deliveries.filter((item) => ["pending", "on_the_way"].includes(item.status) && item.scheduledOn > date).map((item) => item.scheduledOn))].sort()[0], [deliveries, date]);

  async function saveOrigin(origin: string) {
    try { const result = await businessAction<{ done: string[] }>({ action: "save-route-origin", origin }, demo); notifySaved(result.done[0]); onChanged(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar"); }
  }

  return <Card className="gap-4">
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
      <div className="flex max-w-2xl flex-col gap-1.5">
        <CardTitle className="flex items-center gap-2"><RouteIcon className="size-4 text-muted-foreground" aria-hidden="true" />Hoja de ruta</CardTitle>
        <CardDescription>Lo que sale {dayLabel.startsWith("hoy") || dayLabel.startsWith("mañana") ? dayLabel : `el ${dayLabel}`}, zona por zona. Tu reparto va en orden de manejo (primero las franjas de la mañana, barrio por barrio); puedes moverlo y el orden queda guardado.</CardDescription>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Día de la ruta">
        {[{ day: today, label: "Hoy" }, { day: tomorrow, label: "Mañana" }].map((option) => <button key={option.day} type="button" aria-pressed={date === option.day} onClick={() => setDate(option.day)}
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium", date === option.day ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>
          {option.label}<span className={cn("tabular-nums", date === option.day ? "opacity-80" : "text-muted-foreground")}>{count(option.day)}</span>
        </button>)}
        <DatePicker value={date} onChange={(value) => { if (value) setDate(value); }} today={today} min={today} aria-label="Elegir día" className="h-8 w-40" />
      </div>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <label className="flex max-w-xl flex-col gap-1 text-xs font-medium text-muted-foreground sm:flex-row sm:items-center sm:gap-2">
        <span className="shrink-0">Las rutas salen desde</span>
        <Input key={routeOrigin} defaultValue={routeOrigin} maxLength={200} placeholder="Donde esté el repartidor (o escribe la dirección del taller)" className="h-8 text-sm text-foreground"
          onBlur={(event) => { const value = event.currentTarget.value.trim(); if (value !== routeOrigin) void saveOrigin(value); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      </label>
      {stops ? <p className="text-sm text-muted-foreground">{stops} entrega{stops === 1 ? "" : "s"} en {sheet.groups.length} {sheet.groups.length === 1 ? "grupo" : "grupos"}{sheet.groups.some((group) => group.stops.some((item) => item.late)) ? " · incluye las atrasadas que siguen abiertas" : ""}.</p>
        : <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No hay entregas abiertas para {dayLabel.startsWith("hoy") || dayLabel.startsWith("mañana") ? dayLabel.split(",")[0] : `el ${dayLabel}`}.{nextDay ? <> La próxima es el <button type="button" className="font-medium text-foreground underline-offset-4 hover:underline" onClick={() => setDate(nextDay)}>{routeDayLabel(nextDay, today)}</button>.</> : null}</div>}
      {sheet.groups.map((group) => group.mode === "carrier"
        ? <DispatchCard key={group.key} group={group} dayLabel={dayLabel} onSave={onSave} />
        : group.mode === "pickup" ? <PickupCard key={group.key} group={group} onSave={onSave} />
        : <RouteCard key={group.key} group={group} dayLabel={dayLabel} origin={routeOrigin} country={country} demo={demo} onSave={onSave} onChanged={onChanged} onDrive={() => setDriving(group)} />)}
      {sheet.toReschedule.length ? <section className="flex flex-col gap-2 rounded-xl border border-red-300/60 bg-red-50/50 p-3 dark:border-red-400/30 dark:bg-red-500/5" aria-label="Para reprogramar">
        <p className="text-sm font-medium">No se pudieron entregar: conviene reprogramarlas</p>
        <ul className="flex flex-col gap-1.5">{sheet.toReschedule.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="min-w-0"><span className="font-medium">{item.recipient || item.sale.customer || "Cliente"}</span><span className="text-muted-foreground"> · {item.address || "Sin dirección"}{item.note ? ` · ${item.note}` : ""}</span></span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void onSave(item, { scheduledOn: date === today ? tomorrow : date, status: "pending" }, `Reprogramada para el ${routeDayLabel(date === today ? tomorrow : date, today)}`)}>Pasar a {date === today ? "mañana" : "este día"}</Button>
        </li>)}</ul>
      </section> : null}
    </CardContent>
    {driving ? <DriverMode group={driving} dayLabel={dayLabel} origin={routeOrigin} country={country} businessName={businessName} onSave={onSave} onClose={() => setDriving(null)} /> : null}
  </Card>;
}

function RouteActions({ group, dayLabel, links, onDrive, extra }: { group: RouteGroup; dayLabel: string; links: string[]; onDrive?: () => void; extra?: React.ReactNode }) {
  const text = routeText(group, dayLabel, links);
  return <div className="flex flex-wrap gap-1.5">
    {links.map((link, index) => <Button key={link} size="sm" render={<a href={link} target="_blank" rel="noreferrer" />} nativeButton={false}><MapPin data-icon="inline-start" />{links.length === 1 ? "Abrir en Google Maps" : `Maps · tramo ${index + 1}`}</Button>)}
    <Button size="sm" variant="outline" render={<a href={whatsappShareLink(text)} target="_blank" rel="noreferrer" />} nativeButton={false}><MessageCircle data-icon="inline-start" />Enviar por WhatsApp</Button>
    <Button size="sm" variant="outline" onClick={() => void copy(text, "Ruta copiada")}><Copy data-icon="inline-start" />Copiar</Button>
    {onDrive ? <Button size="sm" variant="outline" onClick={onDrive}><Navigation data-icon="inline-start" />Modo repartidor</Button> : null}
    {extra}
  </div>;
}

/** Own delivery (or no zone): the stops as a numbered line in driving order, each one movable. */
function RouteCard({ group, dayLabel, origin, country, demo, onSave, onChanged, onDrive }: {
  group: RouteGroup; dayLabel: string; origin: string; country: string; demo: boolean; onSave: SaveDelivery; onChanged: () => void; onDrive: () => void;
}) {
  const [order, setOrder] = React.useState<string[] | null>(null);
  const saved = group.stops.map((item) => item.id).join();
  const [seen, setSeen] = React.useState(saved);
  if (seen !== saved) { setSeen(saved); setOrder(null); }
  const stops = order ? order.map((id) => group.stops.find((item) => item.id === id)).filter((item): item is RouteStop => Boolean(item)) : group.stops;
  const links = mapsRouteLinks(stops.map((item) => item.address).filter(Boolean), origin, country);
  const suggested = suggestRouteOrder(group.stops).map((item) => item.id);
  const differs = suggested.join() !== stops.map((item) => item.id).join();
  async function persist(ids: string[], message: string) {
    setOrder(ids);
    try { await businessAction({ action: "save-route-order", ids }, demo); notifySaved(message); onChanged(); }
    catch (error) { setOrder(null); toast.error(error instanceof Error ? error.message : "No se pudo guardar el orden"); }
  }
  const move = (index: number, by: number) => {
    const ids = stops.map((item) => item.id);
    const [taken] = ids.splice(index, 1);
    ids.splice(index + by, 0, taken);
    void persist(ids, "Orden de la ruta guardado");
  };
  const color = ROUTE_COLOR[group.mode];
  return <section className="flex flex-col gap-3 rounded-xl border p-3 sm:p-4" aria-label={`Ruta ${group.title}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 text-base font-semibold">{group.title}{group.zone ? <ZoneModeChip mode={group.zone.mode} /> : <Badge variant="outline">Sin zona</Badge>}</p>
        <p className="text-xs text-muted-foreground">{stops.length} parada{stops.length === 1 ? "" : "s"}{group.carrier ? ` · la lleva ${group.carrier}` : ""}{origin ? ` · sale desde ${origin}` : " · sale desde donde esté el repartidor"}</p>
      </div>
      <RouteActions group={{ ...group, stops }} dayLabel={dayLabel} links={links} onDrive={onDrive} extra={differs ? <Button size="sm" variant="ghost" onClick={() => void persist(suggested, "Ruta en el orden sugerido")}>Usar orden sugerido</Button> : null} />
    </div>
    <ol className="flex flex-col">
      {stops.map((stop, index) => <li key={stop.id} className="relative grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-3 pb-3 last:pb-0">
        {index < stops.length - 1 ? <span className="absolute top-8 bottom-0 left-4 w-0.5 -translate-x-1/2 rounded-full" style={{ background: `color-mix(in oklab, ${color} 35%, transparent)` }} aria-hidden="true" /> : null}
        <span className="z-10 flex size-8 items-center justify-center rounded-full text-sm font-semibold text-white tabular-nums" style={{ background: color }}>{index + 1}</span>
        <div className="flex min-w-0 flex-col gap-0.5 pt-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{stop.recipient || stop.sale.customer || "Cliente"}
            {stop.timeWindow ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal">{stop.timeWindow}</span> : null}
            {stop.late ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-500/15 dark:text-red-200">Atrasada</span> : null}
            {stop.status === "on_the_way" ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-900 dark:bg-sky-400/15 dark:text-sky-200">En camino</span> : null}
          </p>
          {stop.address ? <a href={mapsSearchLink(stop.address, country)} target="_blank" rel="noreferrer" className="w-fit text-sm text-muted-foreground underline-offset-4 hover:underline">{stop.address}</a> : <span className="text-xs text-amber-700 dark:text-amber-300">Sin dirección: queda fuera del mapa</span>}
          <p className="text-xs text-muted-foreground">{[stop.sale.items, stop.contact, stop.note && `Nota: ${stop.note}`].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex items-start gap-0.5 pt-0.5">
          <Button size="icon-sm" variant="ghost" aria-label={`Subir a ${stop.recipient || "la parada"}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button>
          <Button size="icon-sm" variant="ghost" aria-label={`Bajar a ${stop.recipient || "la parada"}`} disabled={index === stops.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Marcar como entregada" title="Marcar como entregada" onClick={() => void onSave(stop, { status: "delivered" }, `Entregada: ${stop.recipient || stop.sale.customer || "cliente"}`)}><AnimatedIcon name="check" size={14} /></Button>
        </div>
      </li>)}
    </ol>
  </section>;
}

/** What goes with a carrier: who receives, where, what and the tracking code, ready to copy, send or download. */
function DispatchCard({ group, dayLabel, onSave }: { group: RouteGroup; dayLabel: string; onSave: SaveDelivery }) {
  const pending = group.stops.filter((item) => item.status === "pending");
  const exportRows = () => downloadCsv(`despacho-${group.title}-${dayLabel.replace(/\D+/g, "-")}`, ["Recibe", "Dirección", "Contacto", "Productos", "Seguimiento", "Nota", "Estado"],
    group.stops.map((item) => [item.recipient || item.sale.customer, item.address, item.contact, item.sale.items, item.tracking, item.note, item.status === "on_the_way" ? "Despachada" : "Por despachar"]));
  return <section className="flex flex-col gap-3 rounded-xl border p-3 sm:p-4" aria-label={`Despacho ${group.title}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 text-base font-semibold"><Truck className="size-4 text-muted-foreground" aria-hidden="true" />Para entregar a {group.carrier || group.title}<ZoneModeChip mode="carrier" /></p>
        <p className="text-xs text-muted-foreground">Zona {group.title} · {group.stops.length} paquete{group.stops.length === 1 ? "" : "s"}{pending.length ? ` · ${pending.length} por despachar` : " · todo despachado"}</p>
      </div>
      <RouteActions group={group} dayLabel={dayLabel} links={[]} extra={<>
        <Button size="sm" variant="outline" onClick={exportRows}><AnimatedIcon name="cloud" data-icon="inline-start" size={14} />Descargar Excel</Button>
        {pending.length ? <Button size="sm" variant="outline" onClick={async () => { for (const item of pending) await onSave(item, { status: "on_the_way" }, `${pending.length} marcada${pending.length === 1 ? "" : "s"} como despachada${pending.length === 1 ? "" : "s"}`); }}>Marcar como despachadas</Button> : null}
      </>} />
    </div>
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left font-medium">Recibe</th><th className="px-3 py-2 text-left font-medium">Dirección</th><th className="px-3 py-2 text-left font-medium">Contacto</th><th className="px-3 py-2 text-left font-medium">Productos</th><th className="px-3 py-2 text-left font-medium">Seguimiento</th><th className="px-3 py-2 text-left font-medium">Estado</th></tr></thead>
        <tbody>{group.stops.map((item) => <tr key={item.id} className="border-t align-top">
          <td className="px-3 py-2 font-medium">{item.recipient || item.sale.customer || "Cliente"}{item.late ? <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] text-red-800 dark:bg-red-500/15 dark:text-red-200">Atrasada</span> : null}</td>
          <td className="px-3 py-2 text-muted-foreground">{item.address || "—"}</td>
          <td className="px-3 py-2 text-muted-foreground">{item.contact || "—"}</td>
          <td className="px-3 py-2 text-muted-foreground">{item.sale.items}</td>
          <td className="px-1 py-1"><EditableText value={item.tracking} label={`Seguimiento de ${item.recipient || "la entrega"}`} placeholder="Agregar código" onCommit={(tracking) => void onSave(item, { tracking }, "Código de seguimiento guardado")} /></td>
          <td className="px-3 py-2 text-xs">{item.status === "on_the_way" ? <span className="text-sky-800 dark:text-sky-200">Despachada</span> : <span className="text-amber-800 dark:text-amber-200">Por despachar</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function PickupCard({ group, onSave }: { group: RouteGroup; onSave: SaveDelivery }) {
  return <section className="flex flex-col gap-2 rounded-xl border p-3 sm:p-4" aria-label={`Retiros ${group.title}`}>
    <p className="flex flex-wrap items-center gap-2 text-base font-semibold">{group.title}<ZoneModeChip mode="pickup" /></p>
    <ul className="flex flex-col divide-y">{group.stops.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <span className="min-w-0"><span className="font-medium">{item.recipient || item.sale.customer || "Cliente"}</span><span className="text-muted-foreground"> · {[item.timeWindow, item.sale.items, item.contact].filter(Boolean).join(" · ")}</span></span>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void onSave(item, { status: "delivered" }, `Retirado: ${item.recipient || item.sale.customer || "cliente"}`)}><AnimatedIcon name="check" data-icon="inline-start" size={12} />Ya lo retiró</Button>
    </li>)}</ul>
  </section>;
}

/**
 * The route for whoever drives: one stop at a time with big buttons to navigate, call or message the customer and
 * mark it delivered or not delivered; what is done folds away.
 */
function DriverMode({ group, dayLabel, origin, country, businessName, onSave, onClose }: {
  group: RouteGroup; dayLabel: string; origin: string; country: string; businessName: string; onSave: SaveDelivery; onClose: () => void;
}) {
  const [done, setDone] = React.useState<Record<string, DeliveryStatus>>({});
  const [failing, setFailing] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const current = group.stops.find((item) => !done[item.id]);
  const finished = group.stops.filter((item) => done[item.id]).length;
  const links = mapsRouteLinks(group.stops.filter((item) => !done[item.id]).map((item) => item.address).filter(Boolean), origin, country);
  async function mark(stop: RouteStop, status: DeliveryStatus, note?: string) {
    if (await onSave(stop, { status, ...(note ? { note: [stop.note, note].filter(Boolean).join(" · ") } : {}) }, status === "delivered" ? `Entregada: ${stop.recipient || "cliente"}` : `No se pudo entregar a ${stop.recipient || "cliente"}`)) {
      setDone((value) => ({ ...value, [stop.id]: status }));
      setFailing(null); setReason("");
    }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="flex max-h-[100dvh] flex-col gap-3 overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Ruta {group.title}</DialogTitle>
        <DialogDescription>{dayLabel} · {finished} de {group.stops.length} listas</DialogDescription>
      </DialogHeader>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={group.stops.length} aria-valuenow={finished}><div className="h-full rounded-full bg-[var(--data-1)] transition-all" style={{ width: `${(finished / Math.max(group.stops.length, 1)) * 100}%` }} /></div>
      {links[0] && current ? <Button variant="outline" render={<a href={links[0]} target="_blank" rel="noreferrer" />} nativeButton={false}><MapPin data-icon="inline-start" />Ver lo que falta en Google Maps</Button> : null}
      <ol className="flex flex-col gap-2">
        {group.stops.map((stop, index) => {
          const status = done[stop.id];
          const active = stop.id === current?.id;
          const chat = whatsappChatLink(stop.contact, `Hola${stop.recipient ? ` ${stop.recipient.split(" ")[0]}` : ""}, soy de ${businessName}: voy en camino con tu pedido.`);
          const phone = stop.contact.replace(/[^\d+]/g, "");
          return <li key={stop.id} className={cn("rounded-xl border p-3", active && "border-foreground ring-1 ring-foreground", status && "opacity-60")}>
            <div className="flex items-start gap-3">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white", status === "failed" ? "bg-red-600" : "bg-[var(--data-1)]")}>{status === "delivered" ? "✓" : status === "failed" ? "!" : index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">{stop.recipient || stop.sale.customer || "Cliente"}{stop.timeWindow ? <span className="ml-2 text-xs font-normal text-muted-foreground">{stop.timeWindow}</span> : null}</p>
                <p className="text-sm">{stop.address || "Sin dirección"}</p>
                {active ? <p className="mt-1 text-xs text-muted-foreground">{[stop.sale.items, stop.note && `Nota: ${stop.note}`].filter(Boolean).join(" · ")}</p> : null}
              </div>
            </div>
            {active ? <div className="mt-3 grid grid-cols-2 gap-2">
              {stop.address ? <Button className="h-11" variant="outline" render={<a href={mapsDirectionsLink(stop.address, country)} target="_blank" rel="noreferrer" />} nativeButton={false}><Navigation data-icon="inline-start" />Cómo llegar</Button> : <span />}
              {phone.replace(/\D/g, "").length >= 6 ? <Button className="h-11" variant="outline" render={<a href={`tel:${phone}`} />} nativeButton={false}><Phone data-icon="inline-start" />Llamar</Button> : <span />}
              {chat ? <Button className="col-span-2 h-11" variant="outline" render={<a href={chat} target="_blank" rel="noreferrer" />} nativeButton={false}><MessageCircle data-icon="inline-start" />Avisar que voy en camino</Button> : null}
              {failing === stop.id ? <div className="col-span-2 flex flex-col gap-2">
                <Input autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Qué pasó (no había nadie, dirección mal…)" maxLength={200} />
                <div className="grid grid-cols-2 gap-2"><Button variant="ghost" onClick={() => setFailing(null)}>Volver</Button><Button variant="destructive" onClick={() => void mark(stop, "failed", reason.trim() || "No se pudo entregar")}>Guardar</Button></div>
              </div> : <>
                <Button className="h-12" variant="outline" onClick={() => setFailing(stop.id)}>No se pudo</Button>
                <Button className="h-12" onClick={() => void mark(stop, "delivered")}><AnimatedIcon name="check" data-icon="inline-start" />Entregada</Button>
              </>}
            </div> : null}
          </li>;
        })}
      </ol>
      {!current ? <p className="rounded-xl bg-muted/50 p-3 text-center text-sm">Ruta terminada. {Object.values(done).filter((status) => status === "failed").length ? "Las que no se pudieron entregar quedan para reprogramar." : "Todo entregado."}</p> : null}
    </DialogContent>
  </Dialog>;
}
