"use client";

import * as React from "react";
import { toast } from "sonner";
import { DELIVERY_STATUSES, DELIVERY_STATUS_HINTS, DELIVERY_STATUS_LABELS, byProximity, daysFrom, deliverySummary, isOpenDelivery, saleItemsText, type Delivery, type DeliveryStatus, type SalesChannel } from "@/lib/business";
import type { DomainState } from "@/lib/domain";
import { demoBusinessRecords, demoDeliveries } from "@/lib/demo";
import { AnimatedIcon } from "@/components/animated-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";
import { MonthPicker, SectionHeader, Stat, Tip, businessAction, todayIso, useBusinessView, useMoney } from "./business-ui";
import { EditableDate, EditableNumber, EditableText, SortableHead, TableToolbar, matches, sheetCell, sheetHead, type SortState } from "./data-table";
import { DELIVERY_TONE, relativeDay } from "./delivery-status";

type DeliveryData = { deliveries: Delivery[]; channels: SalesChannel[] };
type Patch = Partial<Pick<Delivery, "scheduledOn" | "timeWindow" | "status" | "method" | "carrier" | "recipient" | "address" | "contact" | "tracking" | "note">> & { cost?: number };
type Quick = "all" | "open" | "today" | "overdue" | "delivered" | "failed";
type SortKey = "date" | "recipient" | "cost";

/** The month's deliveries plus every open one; fetched for a workspace, built in the browser for the demo. */
function useDeliveries(month: string, demo: boolean, revision: number) {
  const [version, setVersion] = React.useState(0);
  const [loaded, setLoaded] = React.useState<{ key: string; data: DeliveryData } | null>(null);
  const demoData = React.useMemo<DeliveryData | null>(() => demo ? { deliveries: demoDeliveries(todayIso()), channels: demoBusinessRecords().channels } : null, [demo]);
  const key = `${month}:${version}:${revision}`;
  React.useEffect(() => {
    if (demo) return;
    let active = true;
    fetch(`/api/deliveries?month=${month}`, { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error((await response.json()).error ?? "No se pudieron cargar las entregas"); return response.json() as Promise<DeliveryData>; })
      .then((data) => { if (active) setLoaded({ key, data }); })
      .catch((error) => { if (active) toast.error(error instanceof Error ? error.message : "No se pudieron cargar las entregas"); });
    return () => { active = false; };
  }, [demo, month, key]);
  return { data: demo ? demoData : loaded?.data ?? null, loading: !demo && loaded?.key !== key, reload: React.useCallback(() => setVersion((current) => current + 1), []) };
}

/**
 * Deliveries as their own world: what is due today and this week, what is late, and every delivery in an editable,
 * filterable sheet, closest to today first. Its cost lives on the sale, so the month's result follows each change.
 */
export function DeliveriesSection({ state, demo, month, onMonthChange, onOpenSales, onDataChanged }: { state: DomainState; demo: boolean; month: string; onMonthChange: (month: string) => void; onOpenSales?: () => void; onDataChanged?: () => void }) {
  const { data, loading, reload } = useDeliveries(month, demo, state.revision);
  const money = useMoney(state.organization.currency);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const today = todayIso();

  async function save(delivery: Delivery | null, patch: Patch & { saleId?: string }, message?: string) {
    if (demo) { toast.info("Demostración: los cambios no se guardan"); return false; }
    try {
      const result = await businessAction<{ done: string[] }>({ action: "save-delivery", delivery: { ...(delivery ? { id: delivery.id } : {}), ...patch } });
      toast.success(message ?? result.done[0] ?? "Entrega actualizada");
      reload();
      if (patch.cost !== undefined) onDataChanged?.();
      return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar"); return false; }
  }
  async function remove(delivery: Delivery) {
    if (demo) { toast.info("Demostración: los cambios no se guardan"); return; }
    try { await businessAction({ action: "archive", kind: "delivery", id: delivery.id }); toast.success("Entrega quitada; la venta sigue registrada"); reload(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo quitar"); }
  }
  async function saveChannel(channel: SalesChannel, change: { deliveryMethod?: string; deliveryCostPerOrder?: number }) {
    if (demo) { toast.info("Demostración: los cambios no se guardan"); return; }
    try {
      await businessAction({ action: "save-channel", channel: {
        id: channel.id, name: channel.name, deliveryMethod: change.deliveryMethod ?? channel.deliveryMethod, commissionPercent: channel.commissionBps / 100, feePerOrder: channel.feePerOrderMinor,
        deliveryCostPerOrder: change.deliveryCostPerOrder ?? channel.deliveryCostPerOrderMinor, unitsPerOrder: channel.unitsPerOrderMilli / 1000, priceAdjustmentPercent: channel.priceAdjustmentBps / 100,
      } });
      toast.success(`${channel.name}: entrega actualizada para las próximas ventas`);
      reload(); onDataChanged?.();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar"); }
  }

  const deliveries = data?.deliveries ?? [];
  const summary = deliverySummary(deliveries, today, month);
  return <>
    <SectionHeader eyebrow="Logística" title="Entregas" description="Cada pedido que tiene que llegar al cliente: cuándo, a dónde, quién lo lleva y cuánto cuesta. La más cercana a hoy aparece primero; lo que cambies acá actualiza el costo de la venta y el resultado del mes.">
      <Button onClick={() => setScheduleOpen(true)}><AnimatedIcon name="plus" data-icon="inline-start" />Programar entrega</Button>
    </SectionHeader>
    {!data ? <TextShimmer className="text-sm">Cargando entregas…</TextShimmer> : <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Para hoy" value={String(summary.today)} note={summary.next7 ? `${summary.next7} en los próximos 7 días` : "Nada más esta semana"} />
        <Stat label="Atrasadas o con problema" value={String(summary.overdue + summary.failed - deliveries.filter((item) => item.status === "failed" && daysFrom(item.scheduledOn, today) < 0).length)} note={summary.failed ? `${summary.failed} no se pudieron entregar` : "Todo en fecha"} tone={summary.overdue || summary.failed ? "negative" : undefined} />
        <Stat label="Entregadas en el mes" value={String(summary.delivered)} note={summary.onTheWay ? `${summary.onTheWay} en camino ahora` : undefined} />
        <Stat label="Costo de entregar en el mes" value={money(summary.cost)} note={summary.averageCost !== null ? `${money(summary.averageCost)} por entrega` : undefined} />
      </div>

      <Card className="gap-4">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5"><CardTitle>Entregas</CardTitle><CardDescription>Las del mes y todas las que siguen abiertas. Haz clic en una celda para cambiarla; el estado se elige de la lista.</CardDescription></div>
          <MonthPicker month={month} onChange={onMonthChange} />
        </CardHeader>
        <CardContent>
          {deliveries.length ? <DeliveriesTable deliveries={deliveries} channels={data.channels} demo={demo} today={today} money={money} onSave={save} onRemove={(delivery) => void remove(delivery)} onOpenSales={onOpenSales} />
            : <Empty className="py-6"><EmptyHeader><EmptyTitle>No hay entregas este mes</EmptyTitle><EmptyDescription>Cuando registras una venta por un canal que entrega (o con dirección), su entrega aparece acá. También puedes programar una para una venta que ya tengas.</EmptyDescription></EmptyHeader><Button variant="outline" onClick={() => setScheduleOpen(true)}>Programar entrega</Button></Empty>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cómo entrega cada canal</CardTitle><CardDescription>La forma y el costo habitual de entregar un pedido en cada canal. Se usan para las próximas ventas; lo que ya se vendió conserva su costo.</CardDescription></CardHeader>
        <CardContent>{data.channels.length ? <div className="overflow-x-auto rounded-lg border"><Table className="border-separate border-spacing-0">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead className={sheetHead}>Canal</TableHead><TableHead className={cn(sheetHead, "min-w-56")}>Forma de entrega</TableHead><TableHead className={cn(sheetHead, "min-w-36 text-right")}>Costo por pedido</TableHead><TableHead className={cn(sheetHead, "text-right")}>Unidades por pedido</TableHead><TableHead className={cn(sheetHead, "text-right")}>Por unidad</TableHead></TableRow></TableHeader>
          <TableBody>{data.channels.map((channel) => <TableRow key={channel.id} className="hover:bg-muted/30">
            <TableCell className={cn(sheetCell, "px-3 font-medium")}>{channel.name}</TableCell>
            <TableCell className={sheetCell}><EditableText value={channel.deliveryMethod} label={`Forma de entrega de ${channel.name}`} placeholder="Ej. moto propia, correo, retiro" disabled={demo} onCommit={(deliveryMethod) => void saveChannel(channel, { deliveryMethod })} /></TableCell>
            <TableCell className={sheetCell}><EditableNumber value={channel.deliveryCostPerOrderMinor} label={`Costo por pedido de ${channel.name}`} disabled={demo} onCommit={(deliveryCostPerOrder) => void saveChannel(channel, { deliveryCostPerOrder })} /></TableCell>
            <TableCell className={cn(sheetCell, "px-3 text-right tabular-nums")}>{new Intl.NumberFormat("es-AR").format(channel.unitsPerOrderMilli / 1000)}</TableCell>
            <TableCell className={cn(sheetCell, "px-3 text-right tabular-nums text-muted-foreground")}>{money(channel.deliveryCostPerOrderMinor / Math.max(channel.unitsPerOrderMilli / 1000, 0.001))}</TableCell>
          </TableRow>)}</TableBody>
        </Table></div> : <p className="text-sm text-muted-foreground">Todavía no hay canales de venta. Agrégalos en Ventas o cuéntaselos a Cozte.</p>}
          <Tip className="mt-4">Entregar también es un costo de cada venta. Si un pedido lleva pocas unidades, el envío pesa mucho en cada una: por eso conviene mirar el costo por unidad y, si hace falta, fijar un mínimo de compra o cobrar el envío.</Tip>
        </CardContent>
      </Card>
    </div>}
    {scheduleOpen ? <ScheduleDialog state={state} demo={demo} month={month} existing={new Set(deliveries.map((item) => item.saleId))} onClose={() => setScheduleOpen(false)} onSave={async (saleId, patch) => { if (await save(null, { saleId, ...patch })) setScheduleOpen(false); }} /> : null}
  </>;
}

function DeliveriesTable({ deliveries, channels, demo, today, money, onSave, onRemove, onOpenSales }: {
  deliveries: Delivery[]; channels: SalesChannel[]; demo: boolean; today: string; money: (value: number) => string;
  onSave: (delivery: Delivery, patch: Patch, message?: string) => Promise<boolean>; onRemove: (delivery: Delivery) => void; onOpenSales?: () => void;
}) {
  const [search, setSearch] = React.useState("");
  const [quick, setQuick] = React.useState<Quick>("all");
  const [channelFilter, setChannelFilter] = React.useState("all");
  const [carrierFilter, setCarrierFilter] = React.useState("all");
  const [sort, setSort] = React.useState<SortState<SortKey>>(null);
  const carriers = [...new Set(deliveries.map((item) => item.carrier).filter(Boolean))].sort();
  const counts: Record<Quick, number> = {
    all: deliveries.length,
    open: deliveries.filter((item) => isOpenDelivery(item.status)).length,
    today: deliveries.filter((item) => isOpenDelivery(item.status) && daysFrom(item.scheduledOn, today) === 0).length,
    overdue: deliveries.filter((item) => isOpenDelivery(item.status) && daysFrom(item.scheduledOn, today) < 0).length,
    delivered: deliveries.filter((item) => item.status === "delivered").length,
    failed: deliveries.filter((item) => item.status === "failed").length,
  };
  const rows = React.useMemo(() => {
    const filtered = deliveries.filter((item) => {
      if (quick === "open" && !isOpenDelivery(item.status)) return false;
      if (quick === "today" && !(isOpenDelivery(item.status) && daysFrom(item.scheduledOn, today) === 0)) return false;
      if (quick === "overdue" && !(isOpenDelivery(item.status) && daysFrom(item.scheduledOn, today) < 0)) return false;
      if (quick === "delivered" && item.status !== "delivered") return false;
      if (quick === "failed" && item.status !== "failed") return false;
      if (channelFilter !== "all" && (item.sale.channelId ?? "direct") !== channelFilter) return false;
      if (carrierFilter !== "all" && item.carrier !== carrierFilter) return false;
      return matches(search, [item.recipient, item.address, item.contact, item.carrier, item.method, item.tracking, item.note, item.sale.customer, item.sale.channelName, item.sale.items, DELIVERY_STATUS_LABELS[item.status]]);
    });
    if (!sort) return byProximity(filtered, (item) => item.scheduledOn, today);
    const direction = sort.direction === "asc" ? 1 : -1;
    const value = (item: Delivery): string | number => sort.key === "date" ? item.scheduledOn : sort.key === "recipient" ? (item.recipient || item.sale.customer).toLowerCase() : item.costMinor;
    return [...filtered].sort((a, b) => { const x = value(a), y = value(b); return (x < y ? -1 : x > y ? 1 : 0) * direction; });
  }, [deliveries, search, quick, channelFilter, carrierFilter, sort, today]);
  const channelOptions = [{ value: "all", label: "Todos los canales" }, ...channels.map((channel) => ({ value: channel.id, label: channel.name })), ...(deliveries.some((item) => !item.sale.channelId) ? [{ value: "direct", label: "Venta directa" }] : [])];
  const quickChips: { id: Quick; label: string }[] = [{ id: "all", label: "Todas" }, { id: "open", label: "Por entregar" }, { id: "today", label: "Hoy" }, { id: "overdue", label: "Atrasadas" }, { id: "failed", label: "Con problema" }, { id: "delivered", label: "Entregadas" }];
  const disabled = demo;
  return <div className="flex flex-col gap-3">
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar por estado">
      {quickChips.map((chip) => <button key={chip.id} type="button" role="tab" aria-selected={quick === chip.id} onClick={() => setQuick(chip.id)}
        className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors", quick === chip.id ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted", chip.id === "overdue" && counts.overdue && quick !== chip.id && "border-red-300 text-red-800 dark:border-red-400/40 dark:text-red-200")}>
        {chip.label}<span className={cn("tabular-nums", quick === chip.id ? "opacity-80" : "text-muted-foreground")}>{counts[chip.id]}</span>
      </button>)}
    </div>
    <TableToolbar search={search} onSearch={setSearch} placeholder="Buscar cliente, dirección, producto o seguimiento" shown={rows.length} total={deliveries.length} filters={[
      { id: "channel", label: "Canal", value: channelFilter, onChange: setChannelFilter, options: channelOptions },
      ...(carriers.length ? [{ id: "carrier", label: "Quién entrega", value: carrierFilter, onChange: setCarrierFilter, options: [{ value: "all", label: "Todos los que entregan" }, ...carriers.map((carrier) => ({ value: carrier, label: carrier }))] }] : []),
    ]}>{sort ? <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSort(null)}>Orden: más cercanas a hoy</Button> : null}</TableToolbar>
    <div className="overflow-x-auto rounded-lg border">
      <Table className="border-separate border-spacing-0">
        <TableHeader><TableRow className="hover:bg-transparent">
          <SortableHead column="date" label="Fecha" sort={sort} onSort={setSort} className="min-w-44" defaultDirection="asc" />
          <TableHead className={cn(sheetHead, "min-w-28")}>Franja</TableHead>
          <TableHead className={cn(sheetHead, "min-w-44")}>Estado</TableHead>
          <SortableHead column="recipient" label="Recibe" sort={sort} onSort={setSort} className="min-w-40" defaultDirection="asc" />
          <TableHead className={cn(sheetHead, "min-w-56")}>Dirección</TableHead>
          <TableHead className={cn(sheetHead, "min-w-36")}>Contacto</TableHead>
          <TableHead className={cn(sheetHead, "min-w-40")}>Quién entrega</TableHead>
          <TableHead className={cn(sheetHead, "min-w-36")}>Forma</TableHead>
          <TableHead className={cn(sheetHead, "min-w-36")}>Seguimiento</TableHead>
          <SortableHead column="cost" label="Costo" sort={sort} onSort={setSort} className="min-w-28 text-right" />
          <TableHead className={cn(sheetHead, "min-w-56")}>Venta</TableHead>
          <TableHead className={cn(sheetHead, "min-w-44")}>Nota</TableHead>
          <TableHead className={cn(sheetHead, "w-20")} />
        </TableRow></TableHeader>
        <TableBody>{rows.map((item) => {
          const days = daysFrom(item.scheduledOn, today);
          const open = isOpenDelivery(item.status);
          const late = open && days < 0;
          return <TableRow key={item.id} className={cn("hover:bg-muted/30", late && "bg-red-50/60 dark:bg-red-500/5", open && days === 0 && "bg-amber-50/60 dark:bg-amber-500/5")}>
            <TableCell className={sheetCell}><div className="flex items-center">
              <EditableDate value={item.scheduledOn} label={`Fecha de entrega a ${item.recipient || item.sale.customer || "cliente"}`} disabled={disabled} onCommit={(scheduledOn) => void onSave(item, { scheduledOn })} className="w-36 shrink-0" />
              <span className={cn("pr-3 text-xs whitespace-nowrap", late ? "font-medium text-red-700 dark:text-red-300" : days === 0 && open ? "font-medium text-amber-800 dark:text-amber-200" : "text-muted-foreground")}>{relativeDay(item.scheduledOn, today)}</span>
            </div></TableCell>
            <TableCell className={sheetCell}><EditableText value={item.timeWindow} label="Franja horaria" placeholder="—" disabled={disabled} onCommit={(timeWindow) => void onSave(item, { timeWindow })} /></TableCell>
            <TableCell className={cn(sheetCell, "px-1.5")}>
              <Dropdown variant="cell" aria-label="Estado de la entrega" value={item.status} disabled={disabled} className={cn("my-1.5 h-8 rounded-full px-2.5 text-xs font-medium ring-1", DELIVERY_TONE[item.status])} onChange={(event) => { const status = event.target.value as DeliveryStatus; if (status !== item.status) void onSave(item, { status }); }}>
                {DELIVERY_STATUSES.map((status) => <DropdownOption key={status} value={status} hint={DELIVERY_STATUS_HINTS[status]}>{DELIVERY_STATUS_LABELS[status]}</DropdownOption>)}
              </Dropdown>
            </TableCell>
            <TableCell className={sheetCell}><EditableText value={item.recipient} label="Recibe" placeholder={item.sale.customer || "—"} disabled={disabled} onCommit={(recipient) => void onSave(item, { recipient })} /></TableCell>
            <TableCell className={sheetCell}><EditableText value={item.address} label="Dirección" placeholder="Sin dirección" disabled={disabled} onCommit={(address) => void onSave(item, { address })} /></TableCell>
            <TableCell className={sheetCell}><EditableText value={item.contact} label="Contacto" placeholder="—" disabled={disabled} onCommit={(contact) => void onSave(item, { contact })} /></TableCell>
            <TableCell className={sheetCell}><EditableText value={item.carrier} label="Quién entrega" placeholder="—" disabled={disabled} onCommit={(carrier) => void onSave(item, { carrier })} /></TableCell>
            <TableCell className={sheetCell}><EditableText value={item.method} label="Forma de entrega" placeholder="—" disabled={disabled} onCommit={(method) => void onSave(item, { method })} /></TableCell>
            <TableCell className={sheetCell}><EditableText value={item.tracking} label="Código de seguimiento" placeholder="—" disabled={disabled} onCommit={(tracking) => void onSave(item, { tracking })} /></TableCell>
            <TableCell className={sheetCell}><EditableNumber value={item.costMinor} label="Costo de la entrega" disabled={disabled} onCommit={(cost) => void onSave(item, { cost }, "Costo de entrega actualizado en la venta")} /></TableCell>
            <TableCell className={cn(sheetCell, "px-3")}><button type="button" onClick={onOpenSales} className="flex min-w-0 flex-col text-left hover:opacity-80" title="Ver en Ventas">
              <span className="truncate text-sm">{item.sale.items || "Venta"}</span>
              <span className="truncate text-xs text-muted-foreground">{item.sale.channelName} · vendida el {item.sale.soldOn.slice(8, 10)}/{item.sale.soldOn.slice(5, 7)} · {money(item.sale.totalMinor)}</span>
            </button></TableCell>
            <TableCell className={sheetCell}><EditableText value={item.note} label="Nota" placeholder="—" disabled={disabled} onCommit={(note) => void onSave(item, { note })} /></TableCell>
            <TableCell className={cn(sheetCell, "px-1")}><div className="flex items-center justify-end gap-0.5">
              {open ? <Button size="icon-sm" variant="ghost" aria-label="Marcar como entregada" title="Marcar como entregada" disabled={disabled} onClick={() => void onSave(item, { status: "delivered" }, "Entrega marcada como entregada")}><AnimatedIcon name="check" size={14} /></Button> : null}
              <Button size="icon-sm" variant="ghost" aria-label="Quitar entrega" title="Quitar entrega (la venta sigue)" disabled={disabled} onClick={() => onRemove(item)}><AnimatedIcon name="delete" size={14} /></Button>
            </div></TableCell>
          </TableRow>;
        })}</TableBody>
        <TableFooter><TableRow>
          <TableCell colSpan={9} className="px-3 text-sm">{rows.length === deliveries.length ? "Todas" : "Lo filtrado"} · {rows.length} entrega{rows.length === 1 ? "" : "s"}</TableCell>
          <TableCell className="px-3 text-right tabular-nums">{money(rows.reduce((sum, item) => sum + item.costMinor, 0))}</TableCell>
          <TableCell colSpan={3} />
        </TableRow></TableFooter>
      </Table>
    </div>
  </div>;
}

/** Schedules a delivery for a sale of the month that does not have one yet. */
function ScheduleDialog({ state, demo, month, existing, onClose, onSave }: { state: DomainState; demo: boolean; month: string; existing: Set<string>; onClose: () => void; onSave: (saleId: string, patch: Patch) => Promise<void> }) {
  const { view } = useBusinessView(month, demo, state);
  const money = useMoney(state.organization.currency);
  const candidates = (view?.sales ?? []).filter((sale) => !sale.delivery && !existing.has(sale.id));
  const [saleId, setSaleId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const selected = candidates.find((sale) => sale.id === saleId) ?? candidates[0];
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "").trim();
    const cost = field("cost");
    setBusy(true);
    try {
      await onSave(selected.id, {
        scheduledOn: field("date") || todayIso(), timeWindow: field("window"), recipient: field("recipient") || selected.customer, address: field("address"), contact: field("contact"), carrier: field("carrier"), note: field("note"),
        ...(cost ? { cost: Number(cost) } : {}),
      });
    } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>Programar entrega</DialogTitle><DialogDescription>Para una venta del mes que todavía no tiene entrega. Las ventas por canales que entregan ya la crean solas al registrarse.</DialogDescription></DialogHeader>
    {!view ? <TextShimmer className="text-sm">Cargando ventas…</TextShimmer> : candidates.length ? <form className="flex flex-col gap-4" onSubmit={submit}><FieldGroup>
      <Field><FieldLabel htmlFor="schedule-sale">Venta</FieldLabel>
        <Dropdown id="schedule-sale" className="w-full" value={selected?.id ?? ""} onChange={(event) => setSaleId(event.target.value)}>
          {candidates.map((sale) => <DropdownOption key={sale.id} value={sale.id} hint={`${sale.channelName} · ${money(sale.totalMinor)}`}>{sale.soldOn.slice(8, 10)}/{sale.soldOn.slice(5, 7)} · {sale.customer || saleItemsText(sale.items)}</DropdownOption>)}
        </Dropdown>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="schedule-date">Fecha</FieldLabel><Input id="schedule-date" name="date" type="date" required defaultValue={todayIso()} /><FieldDescription>Si ya pasó, queda como entregada.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="schedule-window">Franja horaria</FieldLabel><Input id="schedule-window" name="window" placeholder="Ej. 9 a 13" /></Field>
        <Field><FieldLabel htmlFor="schedule-recipient">Recibe</FieldLabel><Input id="schedule-recipient" name="recipient" defaultValue={selected?.customer} placeholder="Nombre" /></Field>
        <Field><FieldLabel htmlFor="schedule-contact">Contacto</FieldLabel><Input id="schedule-contact" name="contact" placeholder="Teléfono" /></Field>
      </div>
      <Field><FieldLabel htmlFor="schedule-address">Dirección</FieldLabel><Input id="schedule-address" name="address" placeholder="Calle, número, ciudad" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="schedule-carrier">Quién entrega</FieldLabel><Input id="schedule-carrier" name="carrier" placeholder="Ej. moto propia, correo" /></Field>
        <Field><FieldLabel htmlFor="schedule-cost">Costo</FieldLabel><Input id="schedule-cost" name="cost" type="number" min="0" step="1" placeholder={selected ? money(selected.deliveryCostMinor) : ""} /><FieldDescription>Vacío: el de la venta.</FieldDescription></Field>
      </div>
      <Field><FieldLabel htmlFor="schedule-note">Nota</FieldLabel><Input id="schedule-note" name="note" placeholder="Timbre, horario, referencias" /></Field>
    </FieldGroup>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Programar entrega"}</Button></DialogFooter>
    </form> : <Empty className="py-4"><EmptyHeader><EmptyTitle>Todas las ventas del mes ya tienen entrega</EmptyTitle><EmptyDescription>Registra una venta nueva o elige otro mes arriba.</EmptyDescription></EmptyHeader></Empty>}
  </DialogContent></Dialog>;
}
