"use client";

import * as React from "react";
import { toast } from "sonner";
import { DELIVERY_STATUSES, DELIVERY_STATUS_HINTS, DELIVERY_STATUS_LABELS, byProximity, daysFrom, deliverySummary, isOpenDelivery, saleItemsText, type Delivery, type DeliveryStatus, type SalesChannel } from "@/lib/business";
import type { DomainState } from "@/lib/domain";
import { demoDeliveryList, demoRecords, demoZoneData } from "@/lib/demo-store";
import { ZONE_MODE_LABELS, type DeliveryZone } from "@/lib/delivery-zones";
import { ZonesPanel, type ZonePlace } from "./delivery-zones";
import { RouteSheet } from "./route-sheet";
import { countryByCode } from "@/lib/locations";
import { AnimatedIcon } from "@/components/animated-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { SuggestInput } from "@/components/ui/suggest-input";
import type { CustomerDirectory } from "@/lib/business";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";
import { MonthPicker, SectionHeader, Stat, Tip, businessAction, notifySaved, todayFor, useBusinessView, useCustomerDirectory, useDemoVersion, useMoney } from "./business-ui";
import { EditableDate, EditableNumber, EditableSuggest, EditableText, SortableHead, TableToolbar, downloadCsv, matches, monthName, sheetCell, sheetHead, usePersistentState, type SortState } from "./data-table";
import { RecordHistory } from "./record-history";
import { DELIVERY_TONE, relativeDay } from "./delivery-status";
import { DeliveryCards } from "./mobile-cards";
import { useIsMobile } from "@/hooks/use-mobile";

type DeliveryData = { deliveries: Delivery[]; channels: SalesChannel[]; zones: DeliveryZone[]; places: ZonePlace[]; routeOrigin: string };
type Patch = Partial<Pick<Delivery, "scheduledOn" | "timeWindow" | "status" | "method" | "carrier" | "recipient" | "address" | "contact" | "tracking" | "note" | "deliveredOn" | "zoneId">> & { cost?: number };

/** The change that puts a delivery back as it was before an edit (including when it was delivered). */
function inverseDeliveryPatch(delivery: Delivery, patch: Patch): Patch {
  const back: Patch = {};
  for (const key of ["scheduledOn", "timeWindow", "method", "carrier", "recipient", "address", "contact", "tracking", "note"] as const) if (patch[key] !== undefined) back[key] = delivery[key];
  if (patch.status !== undefined) { back.status = delivery.status; back.deliveredOn = delivery.deliveredOn; }
  if (patch.cost !== undefined) back.cost = delivery.costMinor;
  // A zone change can bring the zone's method, carrier and cost: undo puts them back too.
  if (patch.zoneId !== undefined) { back.zoneId = delivery.zoneId; back.method = delivery.method; back.carrier = delivery.carrier; back.cost = delivery.costMinor; }
  return back;
}
type Quick = "all" | "open" | "today" | "overdue" | "delivered" | "failed";
type SortKey = "date" | "recipient" | "cost";

/** The month's deliveries plus every open one; fetched for a workspace, built in the browser for the demo. */
export function useDeliveries(month: string, demo: boolean, revision: number) {
  const [version, setVersion] = React.useState(0);
  const [loaded, setLoaded] = React.useState<{ key: string; data: DeliveryData } | null>(null);
  const demoChanges = useDemoVersion(demo);
  const demoData = React.useMemo<DeliveryData | null>(() => demo ? { deliveries: demoDeliveryList(month), channels: demoRecords().channels, ...demoZoneData() } : null, [demo, month, demoChanges]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const today = todayFor(demo);

  async function save(delivery: Delivery | null, patch: Patch & { saleId?: string }, message?: string, undoable = true) {
    try {
      const result = await businessAction<{ done: string[] }>({ action: "save-delivery", delivery: { ...(delivery ? { id: delivery.id } : {}), ...patch } }, demo);
      notifySaved(message ?? result.done[0] ?? "Entrega actualizada", delivery && undoable ? () => void save(delivery, inverseDeliveryPatch(delivery, patch), "Cambio deshecho", false) : undefined);
      reload();
      if (patch.cost !== undefined || patch.zoneId !== undefined) onDataChanged?.();
      return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar"); return false; }
  }
  async function remove(delivery: Delivery) {
    try { await businessAction({ action: "archive", kind: "delivery", id: delivery.id }, demo); notifySaved("Entrega quitada; la venta sigue registrada"); reload(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo quitar"); }
  }
  async function saveChannel(channel: SalesChannel, change: { deliveryMethod?: string; deliveryCostPerOrder?: number }) {
    try {
      await businessAction({ action: "save-channel", channel: {
        id: channel.id, name: channel.name, deliveryMethod: change.deliveryMethod ?? channel.deliveryMethod, commissionPercent: channel.commissionBps / 100, feePerOrder: channel.feePerOrderMinor,
        deliveryCostPerOrder: change.deliveryCostPerOrder ?? channel.deliveryCostPerOrderMinor, unitsPerOrder: channel.unitsPerOrderMilli / 1000, priceAdjustmentPercent: channel.priceAdjustmentBps / 100,
      } }, demo);
      notifySaved(`${channel.name}: entrega actualizada para las próximas ventas`);
      reload(); onDataChanged?.();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar"); }
  }

  const deliveries = data?.deliveries ?? [];
  const summary = deliverySummary(deliveries, today, month);
  const directory = useCustomerDirectory(demo, deliveries.length);
  return <>
    <SectionHeader eyebrow="Logística" title="Entregas" description="Cada pedido que tiene que llegar al cliente: cuándo, a dónde, quién lo lleva y cuánto cuesta. La más cercana a hoy aparece primero; lo que cambies acá actualiza el costo de la venta y el resultado del mes.">
      <Button onClick={() => setScheduleOpen(true)}><AnimatedIcon name="plus" data-icon="inline-start" />Programar entrega</Button>
    </SectionHeader>
    {!data ? <TextShimmer className="text-sm">Cargando entregas…</TextShimmer> : <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Para hoy" value={String(summary.today)} note={summary.next7 ? `${summary.next7} en los próximos 7 días` : "Nada más esta semana"} />
        <Stat label="Atrasadas o con problema" value={String(summary.overdue + summary.failed - deliveries.filter((item) => item.status === "failed" && daysFrom(item.scheduledOn, today) < 0).length)} note={summary.failed ? `${summary.failed} no se pudieron entregar` : "Todo en fecha"} tone={summary.overdue || summary.failed ? "negative" : undefined} />
        <Stat label="Entregadas en el mes" value={String(summary.delivered)} note={summary.onTheWay ? `${summary.onTheWay} en camino ahora` : undefined} />
        <Stat label="Costo de entregar en el mes" value={money(summary.cost)} note={summary.averageCost !== null ? `${money(summary.averageCost)} por entrega` : undefined} />
      </div>

      <RouteSheet deliveries={deliveries} zones={data.zones} routeOrigin={data.routeOrigin ?? ""} today={today} country={countryByCode(state.organization.country)?.name ?? ""} businessName={state.organization.name} demo={demo} onSave={(delivery, patch, message) => save(delivery, patch, message)} onChanged={reload} />

      {!data.channels.some((channel) => channel.deliveryMethod || channel.deliveryCostPerOrderMinor) ? <Tip title="Para que las entregas se creen solas">Indica en «Cómo entrega cada canal» (abajo) la forma y el costo de entregar de tus canales. Desde ahí, cada venta por un canal que entrega aparece acá con su fecha, y puedes seguirla hasta que llega.</Tip> : null}
      <Card className="gap-4">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5"><CardTitle>Entregas</CardTitle><CardDescription>Las del mes y todas las que siguen abiertas. <span className="hidden md:inline">Haz clic en una celda para cambiarla; el estado se elige de la lista.</span><span className="md:hidden">Cambia el estado desde cada tarjeta o toca «Editar».</span></CardDescription></div>
          <MonthPicker month={month} today={todayFor(demo)} onChange={onMonthChange} />
        </CardHeader>
        <CardContent>
          {deliveries.length ? <DeliveriesTable directory={directory} deliveries={deliveries} channels={data.channels} zones={data.zones} demo={demo} today={today} money={money} onSave={save} onRemove={(delivery) => void remove(delivery)} onOpenSales={onOpenSales} />
            : <Empty className="py-6"><EmptyHeader><EmptyTitle>No hay entregas en {monthName(month)}</EmptyTitle><EmptyDescription>Cuando registras una venta por un canal que entrega (o con dirección), su entrega aparece acá. También puedes programar una para una venta que ya tengas.</EmptyDescription></EmptyHeader><Button variant="outline" onClick={() => setScheduleOpen(true)}>Programar entrega</Button></Empty>}
        </CardContent>
      </Card>

      <ZonesPanel zones={data.zones} places={data.places} deliveries={deliveries} month={month} today={today} carriers={directory.carriers} money={money} demo={demo} onChanged={() => { reload(); onDataChanged?.(); }} />

      <Card>
        <CardHeader><CardTitle>Cómo entrega cada canal</CardTitle><CardDescription>La forma y el costo habitual de entregar un pedido en cada canal: se usan cuando la dirección no está en una zona con su propio costo. Lo que ya se vendió conserva su costo.</CardDescription></CardHeader>
        <CardContent>{data.channels.length ? <><ul className="flex flex-col gap-3 md:hidden" aria-label="Cómo entrega cada canal">{data.channels.map((channel) => <li key={channel.id} className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-sm font-medium">{channel.name}</p>
          <div className="grid grid-cols-[1fr_8rem] gap-2 text-xs text-muted-foreground">
            <span>Forma de entrega</span><span>Costo por pedido</span>
            <EditableText value={channel.deliveryMethod} label={`Forma de entrega de ${channel.name}`} placeholder="Ej. moto propia, correo" className="h-9 rounded-md border border-input text-foreground" onCommit={(deliveryMethod) => void saveChannel(channel, { deliveryMethod })} />
            <EditableNumber value={channel.deliveryCostPerOrderMinor} label={`Costo por pedido de ${channel.name}`} className="h-9 rounded-md border border-input text-foreground" onCommit={(deliveryCostPerOrder) => void saveChannel(channel, { deliveryCostPerOrder })} />
          </div>
          <p className="text-xs text-muted-foreground">{new Intl.NumberFormat("es-AR").format(channel.unitsPerOrderMilli / 1000)} unidades por pedido · {money(channel.deliveryCostPerOrderMinor / Math.max(channel.unitsPerOrderMilli / 1000, 0.001))} por unidad</p>
        </li>)}</ul><div className="hidden overflow-x-auto rounded-lg border md:block"><Table className="border-separate border-spacing-0">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead className={sheetHead}>Canal</TableHead><TableHead className={cn(sheetHead, "min-w-56")}>Forma de entrega</TableHead><TableHead className={cn(sheetHead, "min-w-36 text-right")}>Costo por pedido</TableHead><TableHead className={cn(sheetHead, "text-right")}>Unidades por pedido</TableHead><TableHead className={cn(sheetHead, "text-right")}>Por unidad</TableHead></TableRow></TableHeader>
          <TableBody>{data.channels.map((channel) => <TableRow key={channel.id} className="hover:bg-muted/30">
            <TableCell className={cn(sheetCell, "px-3 font-medium")}>{channel.name}</TableCell>
            <TableCell className={sheetCell}><EditableText value={channel.deliveryMethod} label={`Forma de entrega de ${channel.name}`} placeholder="Ej. moto propia, correo, retiro" onCommit={(deliveryMethod) => void saveChannel(channel, { deliveryMethod })} /></TableCell>
            <TableCell className={sheetCell}><EditableNumber value={channel.deliveryCostPerOrderMinor} label={`Costo por pedido de ${channel.name}`} onCommit={(deliveryCostPerOrder) => void saveChannel(channel, { deliveryCostPerOrder })} /></TableCell>
            <TableCell className={cn(sheetCell, "px-3 text-right tabular-nums")}>{new Intl.NumberFormat("es-AR").format(channel.unitsPerOrderMilli / 1000)}</TableCell>
            <TableCell className={cn(sheetCell, "px-3 text-right tabular-nums text-muted-foreground")}>{money(channel.deliveryCostPerOrderMinor / Math.max(channel.unitsPerOrderMilli / 1000, 0.001))}</TableCell>
          </TableRow>)}</TableBody>
        </Table></div></> : <p className="text-sm text-muted-foreground">Todavía no hay canales de venta. Agrégalos en Ventas o cuéntaselos a Cozte.</p>}
          <Tip className="mt-4">Entregar también es un costo de cada venta. Si un pedido lleva pocas unidades, el envío pesa mucho en cada una: por eso conviene mirar el costo por unidad y, si hace falta, fijar un mínimo de compra o cobrar el envío.</Tip>
        </CardContent>
      </Card>
    </div>}
    {scheduleOpen && data ? <ScheduleDialog zones={data.zones} directory={directory} state={state} demo={demo} month={month} today={today} existing={new Set(deliveries.map((item) => item.saleId))} onClose={() => setScheduleOpen(false)} onSave={async (saleId, patch) => { if (await save(null, { saleId, ...patch })) setScheduleOpen(false); }} /> : null}
  </>;
}

function DeliveriesTable({ directory, deliveries, channels, zones, demo, today, money, onSave, onRemove, onOpenSales }: {
  directory: CustomerDirectory; deliveries: Delivery[]; channels: SalesChannel[]; zones: DeliveryZone[]; demo: boolean; today: string; money: (value: number) => string;
  onSave: (delivery: Delivery, patch: Patch, message?: string) => Promise<boolean>; onRemove: (delivery: Delivery) => void; onOpenSales?: () => void;
}) {
  const [search, setSearch] = React.useState("");
  const [quick, setQuick] = usePersistentState<Quick>("entregas:estado", "all", ["all", "open", "today", "overdue", "delivered", "failed"]);
  const [channelFilter, setChannelFilter] = usePersistentState<string>("entregas:canal", "all");
  const [carrierFilter, setCarrierFilter] = usePersistentState<string>("entregas:quien", "all");
  const [zoneFilter, setZoneFilter] = usePersistentState<string>("entregas:zona", "all");
  const [sort, setSort] = React.useState<SortState<SortKey>>(null);
  const isMobile = useIsMobile();
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
      if (zoneFilter !== "all" && (item.zoneId ?? "none") !== zoneFilter) return false;
      return matches(search, [item.zoneName, item.recipient, item.address, item.contact, item.carrier, item.method, item.tracking, item.note, item.sale.customer, item.sale.channelName, item.sale.items, DELIVERY_STATUS_LABELS[item.status]]);
    });
    if (!sort) return byProximity(filtered, (item) => item.scheduledOn, today);
    const direction = sort.direction === "asc" ? 1 : -1;
    const value = (item: Delivery): string | number => sort.key === "date" ? item.scheduledOn : sort.key === "recipient" ? (item.recipient || item.sale.customer).toLowerCase() : item.costMinor;
    return [...filtered].sort((a, b) => { const x = value(a), y = value(b); return (x < y ? -1 : x > y ? 1 : 0) * direction; });
  }, [deliveries, search, quick, channelFilter, carrierFilter, zoneFilter, sort, today]);
  const channelOptions = [{ value: "all", label: "Todos los canales" }, ...channels.map((channel) => ({ value: channel.id, label: channel.name })), ...(deliveries.some((item) => !item.sale.channelId) ? [{ value: "direct", label: "Venta directa" }] : [])];
  const quickChips: { id: Quick; label: string }[] = [{ id: "all", label: "Todas" }, { id: "open", label: "Por entregar" }, { id: "today", label: "Hoy" }, { id: "overdue", label: "Atrasadas" }, { id: "failed", label: "Con problema" }, { id: "delivered", label: "Entregadas" }];
  const disabled = false;
  const [history, setHistory] = React.useState<Delivery | null>(null);
  const exportRows = () => downloadCsv(`entregas-${today.slice(0, 7)}`, ["Fecha", "Franja", "Estado", "Recibe", "Dirección", "Zona", "Contacto", "Quién entrega", "Forma", "Seguimiento", "Costo", "Productos", "Canal", "Vendida el", "Entregada el", "Nota"],
    rows.map((item) => [item.scheduledOn, item.timeWindow, DELIVERY_STATUS_LABELS[item.status], item.recipient || item.sale.customer, item.address, item.zoneName, item.contact, item.carrier, item.method, item.tracking, item.costMinor, item.sale.items, item.sale.channelName, item.sale.soldOn, item.deliveredOn, item.note]));
  const recipientSuggestions = [...directory.customers.map((item) => ({ value: item.name, hint: item.address || undefined })), ...directory.recipients.map((value) => ({ value }))];
  const addressSuggestions = directory.addresses.map((value) => ({ value }));
  const carrierSuggestions = directory.carriers.map((value) => ({ value }));
  return <div className="flex flex-col gap-3">
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar por estado">
      {quickChips.map((chip) => <button key={chip.id} type="button" role="tab" aria-selected={quick === chip.id} onClick={() => setQuick(chip.id)}
        className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors", quick === chip.id ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted", chip.id === "overdue" && counts.overdue && quick !== chip.id && "border-red-300 text-red-800 dark:border-red-400/40 dark:text-red-200")}>
        {chip.label}<span className={cn("tabular-nums", quick === chip.id ? "opacity-80" : "text-muted-foreground")}>{counts[chip.id]}</span>
      </button>)}
    </div>
    <TableToolbar search={search} onSearch={setSearch} placeholder="Buscar cliente, dirección, producto o seguimiento" shown={rows.length} total={deliveries.length} filters={[
      { id: "channel", label: "Canal", value: channelFilter, onChange: setChannelFilter, options: channelOptions },
      ...(zones.length ? [{ id: "zone", label: "Zona", value: zoneFilter, onChange: setZoneFilter, options: [{ value: "all", label: "Todas las zonas" }, ...zones.map((zone) => ({ value: zone.id, label: zone.name })), { value: "none", label: "Sin zona" }] }] : []),
      ...(carriers.length ? [{ id: "carrier", label: "Quién entrega", value: carrierFilter, onChange: setCarrierFilter, options: [{ value: "all", label: "Todos los que entregan" }, ...carriers.map((carrier) => ({ value: carrier, label: carrier }))] }] : []),
    ]}>{sort ? <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSort(null)}>Orden: más cercanas a hoy</Button> : null}<Button type="button" size="sm" variant="outline" className="h-8" onClick={exportRows} title="Descarga lo que ves (con los filtros aplicados)"><AnimatedIcon name="cloud" data-icon="inline-start" size={14} />Descargar Excel</Button></TableToolbar>
    {history ? <RecordHistory kind="delivery" id={history.id} title={`Entrega a ${history.recipient || history.sale.customer || "cliente"}`} demo={demo} onClose={() => setHistory(null)} /> : null}
    {isMobile ? <DeliveryCards rows={rows} today={today} money={money} onSave={onSave} onRemove={onRemove} /> : <div className="max-h-[min(70vh,48rem)] overflow-auto rounded-lg border">
      <Table className="border-separate border-spacing-0">
        <TableHeader className="sticky top-0 z-20 bg-card"><TableRow className="hover:bg-transparent">
          <SortableHead column="date" label="Fecha" sort={sort} onSort={setSort} className="sticky left-0 z-30 min-w-44 bg-muted" defaultDirection="asc" />
          <TableHead className={cn(sheetHead, "min-w-28")}>Franja</TableHead>
          <TableHead className={cn(sheetHead, "min-w-44")}>Estado</TableHead>
          <SortableHead column="recipient" label="Recibe" sort={sort} onSort={setSort} className="min-w-40" defaultDirection="asc" />
          <TableHead className={cn(sheetHead, "min-w-56")}>Dirección</TableHead>
          {zones.length ? <TableHead className={cn(sheetHead, "min-w-44")}>Zona</TableHead> : null}
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
            <TableCell className={cn(sheetCell, "sticky left-0 z-10", late ? "bg-red-50 dark:bg-card" : open && days === 0 ? "bg-amber-50 dark:bg-card" : "bg-card")}><div className="flex items-center">
              <EditableDate today={today} value={item.scheduledOn} label={`Fecha de entrega a ${item.recipient || item.sale.customer || "cliente"}`} disabled={disabled} onCommit={(scheduledOn) => void onSave(item, { scheduledOn })} className="w-36 shrink-0" />
              <span className={cn("pr-3 text-xs whitespace-nowrap", late ? "font-medium text-red-700 dark:text-red-300" : days === 0 && open ? "font-medium text-amber-800 dark:text-amber-200" : "text-muted-foreground")}>{relativeDay(item.scheduledOn, today)}</span>
            </div></TableCell>
            <TableCell className={sheetCell}><EditableText value={item.timeWindow} label="Franja horaria" placeholder="—" disabled={disabled} onCommit={(timeWindow) => void onSave(item, { timeWindow })} /></TableCell>
            <TableCell className={cn(sheetCell, "px-1.5")}>
              <Dropdown variant="cell" aria-label="Estado de la entrega" value={item.status} disabled={disabled} className={cn("my-1.5 h-8 rounded-full px-2.5 text-xs font-medium ring-1", DELIVERY_TONE[item.status])} onChange={(event) => { const status = event.target.value as DeliveryStatus; if (status !== item.status) void onSave(item, { status }); }}>
                {DELIVERY_STATUSES.map((status) => <DropdownOption key={status} value={status} hint={DELIVERY_STATUS_HINTS[status]}>{DELIVERY_STATUS_LABELS[status]}</DropdownOption>)}
              </Dropdown>
            </TableCell>
            <TableCell className={sheetCell}><EditableSuggest suggestions={recipientSuggestions} value={item.recipient} label="Recibe" placeholder={item.sale.customer || "—"} disabled={disabled} onCommit={(recipient) => void onSave(item, { recipient })} /></TableCell>
            <TableCell className={sheetCell}><EditableSuggest suggestions={addressSuggestions} value={item.address} label="Dirección" placeholder="Sin dirección" disabled={disabled} onCommit={(address) => void onSave(item, { address })} /></TableCell>
            {zones.length ? <TableCell className={cn(sheetCell, "px-1.5")}>
              <Dropdown variant="cell" aria-label="Zona de la entrega" value={item.zoneId ?? "none"} disabled={disabled} className="my-1.5 h-8 px-2 text-xs" onChange={(event) => { const zoneId = event.target.value === "none" ? null : event.target.value; if (zoneId !== item.zoneId) void onSave(item, { zoneId }); }}>
                <DropdownOption value="none" hint="Toma el costo que tenga la venta">Sin zona</DropdownOption>
                {zones.map((zone) => <DropdownOption key={zone.id} value={zone.id} hint={`${ZONE_MODE_LABELS[zone.mode]}${zone.mode !== "pickup" && zone.costPerOrderMinor ? ` · ${money(zone.costPerOrderMinor)}` : ""}`}>{zone.name}</DropdownOption>)}
                {item.zoneId && !zones.some((zone) => zone.id === item.zoneId) ? <DropdownOption value={item.zoneId}>{item.zoneName || "Zona quitada"}</DropdownOption> : null}
              </Dropdown>
            </TableCell> : null}
            <TableCell className={sheetCell}><EditableText value={item.contact} label="Contacto" placeholder="—" disabled={disabled} onCommit={(contact) => void onSave(item, { contact })} /></TableCell>
            <TableCell className={sheetCell}><EditableSuggest suggestions={carrierSuggestions} value={item.carrier} label="Quién entrega" placeholder="—" disabled={disabled} onCommit={(carrier) => void onSave(item, { carrier })} /></TableCell>
            <TableCell className={sheetCell}><EditableText value={item.method} label="Forma de entrega" placeholder="—" disabled={disabled} onCommit={(method) => void onSave(item, { method })} /></TableCell>
            <TableCell className={sheetCell}><EditableText value={item.tracking} label="Código de seguimiento" placeholder="—" disabled={disabled} onCommit={(tracking) => void onSave(item, { tracking })} /></TableCell>
            <TableCell className={sheetCell}><EditableNumber value={item.costMinor} label="Costo de la entrega" disabled={disabled} onCommit={(cost) => void onSave(item, { cost }, "Costo de entrega actualizado en la venta")} /></TableCell>
            <TableCell className={cn(sheetCell, "px-3")}><button type="button" onClick={onOpenSales} className="flex min-w-0 flex-col text-left hover:opacity-80" title="Ver en Ventas">
              <span className="truncate text-sm">{item.sale.items || "Venta"}</span>
              <span className="truncate text-xs text-muted-foreground">{item.sale.channelName} · vendida el {item.sale.soldOn.slice(8, 10)}/{item.sale.soldOn.slice(5, 7)} · {money(item.sale.totalMinor)}</span>
            </button></TableCell>
            <TableCell className={sheetCell}><EditableText value={item.note} label="Nota" placeholder="—" disabled={disabled} onCommit={(note) => void onSave(item, { note })} /></TableCell>
            <TableCell className={cn(sheetCell, "px-1")}><div className="flex items-center justify-end gap-0.5">
              <Button size="icon-sm" variant="ghost" aria-label="Historial de la entrega" title="Historial" onClick={() => setHistory(item)}><AnimatedIcon name="history" size={14} /></Button>
              {open ? <Button size="icon-sm" variant="ghost" aria-label="Marcar como entregada" title="Marcar como entregada" disabled={disabled} onClick={() => void onSave(item, { status: "delivered" }, "Entrega marcada como entregada")}><AnimatedIcon name="check" size={14} /></Button> : null}
              <Button size="icon-sm" variant="ghost" aria-label="Quitar entrega" title="Quitar entrega (la venta sigue)" disabled={disabled} onClick={() => onRemove(item)}><AnimatedIcon name="delete" size={14} /></Button>
            </div></TableCell>
          </TableRow>;
        })}</TableBody>
        <TableFooter><TableRow>
          <TableCell colSpan={zones.length ? 10 : 9} className="px-3 text-sm">{rows.length === deliveries.length ? "Todas" : "Lo filtrado"} · {rows.length} entrega{rows.length === 1 ? "" : "s"}</TableCell>
          <TableCell className="px-3 text-right tabular-nums">{money(rows.reduce((sum, item) => sum + item.costMinor, 0))}</TableCell>
          <TableCell colSpan={3} />
        </TableRow></TableFooter>
      </Table>
    </div>}
  </div>;
}

/** Schedules a delivery for a sale of the month that does not have one yet. */
function ScheduleDialog({ zones, directory, state, demo, month, today, existing, onClose, onSave }: { zones: DeliveryZone[]; directory: CustomerDirectory; state: DomainState; demo: boolean; month: string; today: string; existing: Set<string>; onClose: () => void; onSave: (saleId: string, patch: Patch) => Promise<void> }) {
  const { view } = useBusinessView(month, demo, state);
  const money = useMoney(state.organization.currency);
  const candidates = (view?.sales ?? []).filter((sale) => !sale.delivery && !existing.has(sale.id));
  const [saleId, setSaleId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const selected = candidates.find((sale) => sale.id === saleId) ?? candidates[0];
  const known = directory.customers.find((item) => item.name === selected?.customer);
  const [recipient, setRecipient] = React.useState<string | null>(null);
  const [address, setAddress] = React.useState<string | null>(null);
  const [carrier, setCarrier] = React.useState("");
  const [contact, setContact] = React.useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "").trim();
    const cost = field("cost");
    const zone = field("zone");
    setBusy(true);
    try {
      await onSave(selected.id, {
        scheduledOn: field("date") || today, timeWindow: field("window"), recipient: (recipient ?? selected.customer).trim(), address: (address ?? known?.address ?? "").trim(), contact: (contact ?? known?.contact ?? "").trim(), carrier: carrier.trim(), note: field("note"),
        ...(cost ? { cost: Number(cost) } : {}), ...(zone && zone !== "auto" ? { zoneId: zone === "none" ? null : zone } : {}),
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
        <Field><FieldLabel htmlFor="schedule-date">Fecha</FieldLabel><DatePicker id="schedule-date" name="date" required defaultValue={today} today={today} /><FieldDescription>Si ya pasó, queda como entregada.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="schedule-window">Franja horaria</FieldLabel><Input id="schedule-window" name="window" placeholder="Ej. 9 a 13" /></Field>
        <Field><FieldLabel htmlFor="schedule-recipient">Recibe</FieldLabel><SuggestInput id="schedule-recipient" value={recipient ?? selected?.customer ?? ""} placeholder="Nombre" suggestions={[...directory.customers.map((item) => ({ value: item.name })), ...directory.recipients.map((value) => ({ value }))]} onValueChange={(value) => setRecipient(value)} /></Field>
        <Field><FieldLabel htmlFor="schedule-contact">Contacto</FieldLabel><Input id="schedule-contact" value={contact ?? known?.contact ?? ""} onChange={(event) => setContact(event.target.value)} placeholder="Teléfono" /></Field>
      </div>
      <Field><FieldLabel htmlFor="schedule-address">Dirección</FieldLabel><SuggestInput id="schedule-address" value={address ?? known?.address ?? ""} placeholder="Calle, número, ciudad" suggestions={directory.addresses.map((value) => ({ value }))} onValueChange={(value) => setAddress(value)} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="schedule-carrier">Quién entrega</FieldLabel><SuggestInput id="schedule-carrier" value={carrier} placeholder="Ej. moto propia, correo" suggestions={directory.carriers.map((value) => ({ value }))} onValueChange={(value) => setCarrier(value)} /></Field>
        <Field><FieldLabel htmlFor="schedule-cost">Costo</FieldLabel><Input id="schedule-cost" name="cost" type="number" min="0" step="1" placeholder={selected ? money(selected.deliveryCostMinor) : ""} /><FieldDescription>Vacío: el de la zona o el de la venta.</FieldDescription></Field>
      </div>
      {zones.length ? <Field><FieldLabel htmlFor="schedule-zone">Zona</FieldLabel>
        <Dropdown id="schedule-zone" name="zone" className="w-full" defaultValue="auto">
          <DropdownOption value="auto" hint="La de la ciudad o el barrio de la dirección">Según la dirección</DropdownOption>
          {zones.map((zone) => <DropdownOption key={zone.id} value={zone.id} hint={ZONE_MODE_LABELS[zone.mode]}>{zone.name}</DropdownOption>)}
          <DropdownOption value="none">Sin zona</DropdownOption>
        </Dropdown>
        <FieldDescription>La zona pone el día de salida, quién la lleva y el costo, salvo lo que escribas acá.</FieldDescription>
      </Field> : null}
      <Field><FieldLabel htmlFor="schedule-note">Nota</FieldLabel><Input id="schedule-note" name="note" placeholder="Timbre, horario, referencias" /></Field>
    </FieldGroup>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Programar entrega"}</Button></DialogFooter>
    </form> : <Empty className="py-4"><EmptyHeader><EmptyTitle>Todas las ventas del mes ya tienen entrega</EmptyTitle><EmptyDescription>Registra una venta nueva o elige otro mes arriba.</EmptyDescription></EmptyHeader></Empty>}
  </DialogContent></Dialog>;
}
