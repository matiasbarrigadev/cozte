"use client";

import * as React from "react";
import { toast } from "sonner";
import { DELIVERY_STATUS_LABELS, DIRECT_CHANNEL, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, canFillSaleCosts, channelPrice, isOpenDelivery, needsDelivery, saleItemsText, salePayment, saleVariableCost, type CustomerDirectory, type PaymentMethod, type Sale, type SalePatch, type SalesChannel } from "@/lib/business";
import { calculateCosts, type DomainState } from "@/lib/domain";
import { AnimatedIcon } from "@/components/animated-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { SuggestInput, type Suggestion } from "@/components/ui/suggest-input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";
import { MonthPicker, ReceiptLink, SectionHeader, businessAction, formatDate, notifySaved, todayFor, uploadDocument, useBusinessView, useCustomerDirectory, useMoney } from "./business-ui";
import { EditableDate, EditableNumber, EditableSuggest, EditableText, SortableHead, TableToolbar, downloadCsv, matches, monthName, sheetCell, sheetHead, usePersistentState, type SortState } from "./data-table";
import { RecordHistory } from "./record-history";
import { DeliveryStatusBadge, relativeDay } from "./delivery-status";
import { useDeliveries } from "./deliveries-section";
import { SaleCards } from "./mobile-cards";
import { PaymentBadge, PaymentDialog, PaymentPicker, paymentFields, type PaymentChoice } from "./payment";
import { SaleRegister, type SalePreset } from "./sale-register";
import { useIsMobile } from "@/hooks/use-mobile";

const leftOf = (sale: Sale) => sale.variableCostMinor === null ? null : sale.totalMinor - sale.variableCostMinor - sale.sellingCostMinor - sale.deliveryCostMinor;
const toDeliver = (sale: Sale) => Boolean(sale.delivery && isOpenDelivery(sale.delivery.status));

type Period = "today" | "week" | "month";
const PERIODS: readonly Period[] = ["today", "week", "month"];
const PERIOD_LABELS: Record<Period, string> = { today: "Hoy", week: "Esta semana", month: "Mes" };
type StatusFilter = "all" | "owed" | "deliver";
type SortKey = "date" | "customer" | "total" | "left";

/** Monday of the week a day falls in. */
function weekStart(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

/** The change that puts a sale back as it was before an edit. */
function inverseSalePatch(sale: Sale, patch: SalePatch): SalePatch {
  const back: SalePatch = {};
  if (patch.soldOn !== undefined) back.soldOn = sale.soldOn;
  if (patch.customer !== undefined) back.customer = sale.customer;
  if (patch.note !== undefined) back.note = sale.note;
  if (patch.channelId !== undefined) { back.channelId = sale.channelId; back.deliveryCost = sale.deliveryCostMinor; }
  if (patch.deliveryCost !== undefined) back.deliveryCost = sale.deliveryCostMinor;
  if (patch.items !== undefined) back.items = sale.items.map((item) => ({ productId: item.productId, quantity: item.quantityMilli / 1000, unitPrice: item.unitPriceMinor }));
  if (patch.markPaid !== undefined || patch.paidAmount !== undefined || patch.paymentMethod !== undefined) { back.paidAmount = sale.paidMinor; back.paymentMethod = sale.paymentMethod; }
  return back;
}

export type BulkActions = {
  markPaid: (sales: Sale[], method: PaymentMethod) => Promise<void>;
  markDelivered: (sales: Sale[]) => Promise<void>;
  changeChannel: (sales: Sale[], channelId: string) => Promise<void>;
  archive: (sales: Sale[]) => Promise<void>;
};

/**
 * The day's sales work: what was sold today, what customers owe and what has to go out, a register to record a sale
 * in seconds, and the list of sales by day, week or month to correct, collect and deliver, one by one or in groups.
 * Channels and their margins live in their own section.
 */
export function SalesSection({ state, demo, month, onMonthChange, onOpenCozte, onOpenDeliveries, onOpenChannels, onDataChanged }: { state: DomainState; demo: boolean; month: string; onMonthChange: (month: string) => void; onOpenCozte: () => void; onOpenDeliveries?: () => void; onOpenChannels?: () => void; onDataChanged?: () => void }) {
  const today = todayFor(demo);
  const todayMonth = today.slice(0, 7);
  const start = weekStart(today);
  const [period, setPeriod] = usePersistentState<Period>("ventas:periodo", "today", PERIODS);
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const current = useBusinessView(todayMonth, demo, state);
  // The month chosen, or the days of this week that fall in the month before.
  const otherMonth = period === "month" && month !== todayMonth ? month : period === "week" && start.slice(0, 7) !== todayMonth ? start.slice(0, 7) : null;
  const other = useBusinessView(otherMonth, demo, state);
  const { data: deliveryData } = useDeliveries(todayMonth, demo, state.revision);
  const money = useMoney(state.organization.currency);
  const directory = useCustomerDirectory(demo, current.view?.sales.length);
  const customerSuggestions = React.useMemo<Suggestion[]>(() => directory.customers.map((item) => ({ value: item.name, hint: [item.address, item.sales > 1 ? `${item.sales} compras` : ""].filter(Boolean).join(" · ") || undefined })), [directory]);
  const [saleOpen, setSaleOpen] = React.useState(false);
  const [itemsSale, setItemsSale] = React.useState<Sale | null>(null);
  const [paying, setPaying] = React.useState<Sale | null>(null);
  const [preset, setPreset] = React.useState<SalePreset | null>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key.toLowerCase() !== "n" || event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable], [role=combobox], [role=dialog]")) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const changed = () => { current.reload(); other.reload(); onDataChanged?.(); };
  async function patchSale(sale: Sale, patch: SalePatch): Promise<boolean> {
    try { await businessAction({ action: "update-sale", id: sale.id, patch }, demo); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar el cambio"); return false; }
  }
  async function update(sale: Sale, patch: SalePatch, message = "Venta actualizada", undoable = true): Promise<boolean> {
    if (!await patchSale(sale, patch)) return false;
    notifySaved(message, undoable ? () => void update(sale, inverseSalePatch(sale, patch), "Cambio deshecho", false) : undefined);
    changed();
    return true;
  }
  async function archive(sale: Sale) {
    try { await businessAction({ action: "archive", kind: "sale", id: sale.id }, demo); notifySaved("Venta anulada"); changed(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo anular"); }
  }
  async function scheduleDelivery(sale: Sale) {
    try { await businessAction({ action: "save-delivery", delivery: { saleId: sale.id, scheduledOn: sale.soldOn >= today ? sale.soldOn : today, status: "pending" } }, demo); notifySaved("Entrega creada: complétala en Entregas"); changed(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo crear la entrega"); }
  }
  const repeat = (sale: Sale) => {
    setPreset({ key: Date.now(), channelId: sale.channelId, customer: sale.customer, items: sale.items.map((item) => ({ productId: item.productId, quantity: item.quantityMilli / 1000 })) });
    searchRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    toast.message("Venta cargada en la caja: revisala y registrala", { id: "cozte-edit" });
  };
  // Several sales at once, one after the other; the notice says how many went through.
  async function inBulk(sales: Sale[], run: (sale: Sale) => Promise<unknown>, done: (count: number) => string) {
    let count = 0;
    for (const sale of sales) { try { await run(sale); count++; } catch { /* Counted below. */ } }
    if (count < sales.length) toast.error(`${done(count)}; ${sales.length - count} no se pudieron cambiar`);
    else notifySaved(done(count));
    changed();
  }
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const bulk: BulkActions = {
    markPaid: (sales, method) => inBulk(sales.filter((sale) => salePayment(sale).status !== "paid"), (sale) => businessAction({ action: "update-sale", id: sale.id, patch: { markPaid: true, paymentMethod: method } }, demo), (count) => `${plural(count, "venta cobrada", "ventas cobradas")}`),
    markDelivered: (sales) => inBulk(sales.filter(toDeliver), (sale) => businessAction({ action: "save-delivery", delivery: { id: sale.delivery!.id, status: "delivered" } }, demo), (count) => `${plural(count, "entrega marcada", "entregas marcadas")} como entregada${count === 1 ? "" : "s"}`),
    changeChannel: (sales, channelId) => inBulk(sales.filter((sale) => (sale.channelId ?? DIRECT_CHANNEL.id) !== channelId), (sale) => businessAction({ action: "update-sale", id: sale.id, patch: { channelId: channelId === DIRECT_CHANNEL.id ? null : channelId } }, demo), (count) => `Canal cambiado en ${plural(count, "venta", "ventas")}`),
    archive: (sales) => inBulk(sales, (sale) => businessAction({ action: "archive", kind: "sale", id: sale.id }, demo), (count) => `${plural(count, "venta anulada", "ventas anuladas")}`),
  };

  const view = current.view;
  const costs = React.useMemo(() => calculateCosts(state), [state]);
  const periodSales = React.useMemo(() => {
    if (!view) return [];
    if (period === "today") return view.sales.filter((sale) => sale.soldOn === today);
    if (period === "week") return [...view.sales, ...(start.slice(0, 7) !== todayMonth ? other.view?.sales ?? [] : [])].filter((sale) => sale.soldOn >= start && sale.soldOn <= today);
    return (month === todayMonth ? view : other.view)?.sales ?? [];
  }, [view, other.view, period, today, start, todayMonth, month]);
  const owed = view?.owed ?? [];
  const rows = status === "owed" ? owed : status === "deliver" ? periodSales.filter(toDeliver) : periodSales;
  const fillable = periodSales.filter((sale) => canFillSaleCosts(sale, costs));
  async function fillAll() {
    await inBulk(fillable, (sale) => businessAction({ action: "update-sale", id: sale.id, patch: { fillMissingCosts: true } }, demo), (count) => `${plural(count, "venta completada", "ventas completadas")} con el costo de hoy`);
  }
  const soldToday = view?.sales.filter((sale) => sale.soldOn === today) ?? [];
  const openDeliveries = deliveryData?.deliveries.filter((item) => isOpenDelivery(item.status)) ?? [];
  const deliverToday = openDeliveries.filter((item) => item.scheduledOn === today);
  const late = openDeliveries.filter((item) => item.scheduledOn < today);
  const periodLabel = period === "today" ? "hoy" : period === "week" ? "esta semana" : monthName(month);
  const showList = (next: StatusFilter) => { setStatus(next); listRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); };

  return <>
    <SectionHeader eyebrow="Día a día" title="Ventas" description="Anotá cada venta en segundos, cobrá lo pendiente y seguí lo que hay que entregar. Cozte ve cada cambio al instante: pedile lo que quieras entender del negocio." />
    {!view ? <TextShimmer className="text-sm">Cargando ventas…</TextShimmer> : <div className={cn("flex flex-col gap-6 transition-opacity", (current.loading || other.loading) && "opacity-60")}>
      <div className="grid gap-3 sm:grid-cols-3">
        <DayCard label="Vendido hoy" value={money(soldToday.reduce((sum, sale) => sum + sale.totalMinor, 0))} note={soldToday.length ? plural(soldToday.length, "venta", "ventas") : "Todavía ninguna venta hoy"} onClick={() => { setPeriod("today"); showList("all"); }} action="Ver las de hoy" />
        <DayCard label="Por cobrar" value={money(view.receivable.totalMinor)} tone={view.receivable.totalMinor > 0 ? "attention" : undefined}
          note={view.receivable.sales ? `${plural(view.receivable.sales, "venta", "ventas")}${view.receivable.oldestOn ? ` · la más vieja del ${formatDate(view.receivable.oldestOn)}` : ""}` : "Nadie te debe nada"} onClick={() => showList("owed")} action="Ver quién debe" />
        <DayCard label="Para entregar hoy" value={String(deliverToday.length)} tone={late.length ? "attention" : undefined}
          note={late.length ? `${plural(late.length, "atrasada", "atrasadas")} de días anteriores` : deliverToday.length ? "Ninguna atrasada" : "Nada para hoy"} onClick={onOpenDeliveries} action="Ir a Entregas" />
      </div>

      {state.products.length ? <SaleRegister ref={searchRef} state={state} channels={view.channels} demo={demo} today={today} suggestions={customerSuggestions} preset={preset} onSaved={changed} onOpenDialog={() => setSaleOpen(true)} onOpenChannels={onOpenChannels} />
        : <Card><CardContent><Empty className="py-6"><EmptyHeader><EmptyTitle>Primero, tus productos</EmptyTitle><EmptyDescription>Para registrar ventas, Cozte necesita saber qué vendes y cuánto cuesta hacerlo. Cárgalos en Costos de producción o cuéntaselos a Cozte.</EmptyDescription></EmptyHeader><Button variant="outline" onClick={onOpenCozte}>Contarle a Cozte qué fabrico</Button></Empty></CardContent></Card>}

      {fillable.length ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/70 px-4 py-3 text-sm dark:border-amber-400/30 dark:bg-amber-500/5">
        <p><span className="font-medium">{plural(fillable.length, "venta", "ventas")} con costo incompleto.</span> Cuando se registraron faltaba el costo de algún producto; hoy ese costo está completo y el resultado del mes ya lo usa como estimación. Complétalas para dejarlo fijo en cada venta.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void fillAll()}>Completar con el costo de hoy</Button>
      </div> : null}

      <div ref={listRef} className="scroll-mt-4"><Card className="gap-4">
        <CardHeader className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5"><CardTitle>{status === "owed" ? "Ventas por cobrar" : status === "deliver" ? "Ventas por entregar" : "Ventas"}</CardTitle>
              <CardDescription>{status === "owed" ? "Todas las que te deben, de cualquier fecha, la más vieja primero. Tocá el estado de pago para registrar un cobro." : <><span className="hidden md:inline">Hacé clic en una celda para corregirla: Enter guarda, Escape cancela. Marcá varias para cobrarlas, entregarlas o cambiarles el canal juntas.</span><span className="md:hidden">Tocá «Editar» para corregir una venta o el estado de pago para cobrarla.</span></>}</CardDescription></div>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented label="Período" value={period} options={PERIODS.map((value) => ({ value, label: PERIOD_LABELS[value] }))} onChange={(value) => { setPeriod(value); if (status === "owed") setStatus("all"); }} />
              {period === "month" && status !== "owed" ? <MonthPicker month={month} today={today} onChange={onMonthChange} /> : null}
            </div>
          </div>
          <Segmented label="Mostrar" value={status} onChange={setStatus} options={[
            { value: "all", label: "Todas" },
            { value: "owed", label: `Por cobrar${owed.length ? ` · ${owed.length}` : ""}` },
            { value: "deliver", label: `Por entregar${periodSales.filter(toDeliver).length ? ` · ${periodSales.filter(toDeliver).length}` : ""}` },
          ]} />
        </CardHeader>
        <CardContent>
          {rows.length ? <SalesTable key={`${status}:${period}:${month}`} rows={rows} costs={costs} today={today} label={status === "owed" ? "por cobrar" : periodLabel} exportName={status === "owed" ? "ventas-por-cobrar" : `ventas-${period === "month" ? month : period === "week" ? start : today}`} customerSuggestions={customerSuggestions} state={state} channels={view.channels} demo={demo} money={money}
            onUpdate={update} onArchive={(sale) => void archive(sale)} onEditItems={setItemsSale} onSchedule={(sale) => void scheduleDelivery(sale)} onOpenDeliveries={onOpenDeliveries} onCollect={setPaying} onRepeat={repeat} bulk={bulk} />
            : <Empty className="py-6"><EmptyHeader><EmptyTitle>{status === "owed" ? "Nadie te debe nada" : status === "deliver" ? `No hay entregas pendientes de ventas de ${periodLabel}` : `No hay ventas ${period === "month" ? `en ${periodLabel}` : periodLabel}`}</EmptyTitle>
              <EmptyDescription>{status === "all" ? "Registralas en la caja de arriba o mandale a Cozte la foto del remito o factura." : "Cuando haya, aparecen acá."}</EmptyDescription></EmptyHeader>
              {status === "all" ? <Button variant="outline" onClick={onOpenCozte}>Enviar un remito a Cozte</Button> : null}</Empty>}
        </CardContent>
      </Card></div>
    </div>}
    {saleOpen && view ? <SaleDialog directory={directory} state={state} channels={view.channels} demo={demo} month={todayMonth} onClose={() => setSaleOpen(false)} onSaved={() => { setSaleOpen(false); changed(); }} /> : null}
    {itemsSale ? <SaleItemsDialog sale={itemsSale} state={state} onClose={() => setItemsSale(null)} onSave={async (items) => { if (await update(itemsSale, { items }, "Productos de la venta actualizados")) setItemsSale(null); }} /> : null}
    {paying ? <PaymentDialog sale={paying} money={money} onClose={() => setPaying(null)} onSave={(patch, message) => update(paying, patch, message)} /> : null}
  </>;
}

function DayCard({ label, value, note, tone, onClick, action }: { label: string; value: string; note: string; tone?: "attention"; onClick?: () => void; action: string }) {
  return <button type="button" onClick={onClick} disabled={!onClick} className={cn("group flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:border-foreground/30 disabled:cursor-default", tone === "attention" && "border-amber-300 bg-amber-50/60 dark:border-amber-400/30 dark:bg-amber-500/5")}>
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="text-2xl font-semibold tabular-nums">{value}</span>
    <span className="text-xs text-muted-foreground">{note}</span>
    {onClick ? <span className="mt-1 text-xs font-medium text-primary opacity-80 group-hover:opacity-100">{action} →</span> : null}
  </button>;
}

/** A small row of mutually exclusive buttons. */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg border bg-muted/40 p-0.5">
    {options.map((option) => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} onClick={() => onChange(option.value)}
      className={cn("rounded-md px-3 py-1 text-sm transition-colors", value === option.value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>{option.label}</button>)}
  </div>;
}

/** The sales as an editable sheet: search and filters on top, selection for actions in groups, most recent first unless sorted. */
function SalesTable({ rows: sales, costs, today, label, exportName, customerSuggestions, state, channels, demo, money, onUpdate, onArchive, onEditItems, onSchedule, onOpenDeliveries, onCollect, onRepeat, bulk }: {
  rows: Sale[]; costs: ReturnType<typeof calculateCosts>; today: string; label: string; exportName: string; customerSuggestions: Suggestion[]; state: DomainState; channels: SalesChannel[]; demo: boolean; money: (value: number) => string;
  onUpdate: (sale: Sale, patch: SalePatch, message?: string, undoable?: boolean) => Promise<boolean>; onArchive: (sale: Sale) => void; onEditItems: (sale: Sale) => void; onSchedule: (sale: Sale) => void; onOpenDeliveries?: () => void;
  onCollect: (sale: Sale) => void; onRepeat: (sale: Sale) => void; bulk: BulkActions;
}) {
  const [search, setSearch] = React.useState("");
  const [channelFilter, setChannelFilter] = usePersistentState<string>("ventas:canal", "all");
  const [sort, setSort] = React.useState<SortState<SortKey>>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkMethod, setBulkMethod] = usePersistentState<PaymentMethod>("ventas:cobro-grupo", "cash", PAYMENT_METHODS);
  const [confirmArchive, setConfirmArchive] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const isMobile = useIsMobile();
  const channelOptions = [...channels.map((channel) => ({ value: channel.id, label: channel.name })), { value: DIRECT_CHANNEL.id, label: DIRECT_CHANNEL.name }];
  const rows = React.useMemo(() => {
    const filtered = sales.filter((sale) => {
      if (channelFilter !== "all" && (sale.channelId ?? DIRECT_CHANNEL.id) !== channelFilter) return false;
      return matches(search, [sale.customer, sale.channelName, sale.note, saleItemsText(sale.items), sale.soldOn]);
    });
    if (!sort) return filtered;
    const direction = sort.direction === "asc" ? 1 : -1;
    const value = (sale: Sale): string | number => sort.key === "date" ? sale.soldOn : sort.key === "customer" ? sale.customer.toLowerCase() : sort.key === "total" ? sale.totalMinor : leftOf(sale) ?? -Infinity;
    return [...filtered].sort((a, b) => { const x = value(a), y = value(b); return (x < y ? -1 : x > y ? 1 : 0) * direction; });
  }, [sales, search, channelFilter, sort]);
  const chosen = rows.filter((sale) => selected.has(sale.id));
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const run = async (action: () => Promise<void>) => { setWorking(true); try { await action(); setSelected(new Set()); } finally { setWorking(false); } };
  // The footer follows the month's result: a sale recorded without a product's cost counts it at today's cost.
  const totals = rows.reduce((sum, sale) => ({ total: sum.total + sale.totalMinor, owed: sum.owed + salePayment(sale).owedMinor, left: sum.left + sale.totalMinor - saleVariableCost(sale, costs, state.organization.currency).amount - sale.sellingCostMinor - sale.deliveryCostMinor }), { total: 0, owed: 0, left: 0 });
  const [history, setHistory] = React.useState<Sale | null>(null);
  const exportRows = () => downloadCsv(exportName, ["Fecha", "Canal", "Cliente", "Productos", "Total", "Cobrado", "Debe", "Medio de pago", "Comisiones y cargos", "Costo de entrega", "Te dejó", "Entrega", "Nota"],
    rows.map((sale) => [sale.soldOn, sale.channelName, sale.customer, saleItemsText(sale.items), sale.totalMinor, sale.paidMinor, salePayment(sale).owedMinor, sale.paymentMethod ? PAYMENT_METHOD_LABELS[sale.paymentMethod] : "", sale.sellingCostMinor, sale.deliveryCostMinor, leftOf(sale), sale.delivery ? `${DELIVERY_STATUS_LABELS[sale.delivery.status]} (${sale.delivery.scheduledOn})` : "", sale.note]));
  return <div className="flex flex-col gap-3">
    <TableToolbar search={search} onSearch={setSearch} placeholder="Buscar cliente, producto, canal o nota" shown={rows.length} total={sales.length} filters={[
      { id: "channel", label: "Canal", value: channelFilter, onChange: setChannelFilter, options: [{ value: "all", label: "Todos los canales" }, ...channelOptions] },
    ]}><Button type="button" size="sm" variant="outline" className="h-8" onClick={exportRows} title="Descarga lo que ves (con los filtros aplicados)"><AnimatedIcon name="cloud" data-icon="inline-start" size={14} />Descargar Excel</Button></TableToolbar>
    {chosen.length && !isMobile ? <div className="sticky top-2 z-40 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-md" role="toolbar" aria-label="Acciones con las ventas elegidas">
      <span className="text-sm font-medium tabular-nums">{chosen.length} elegida{chosen.length === 1 ? "" : "s"}</span>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      <Dropdown size="sm" aria-label="Medio de cobro" value={bulkMethod} onChange={(event) => setBulkMethod(event.target.value as PaymentMethod)}>{PAYMENT_METHODS.map((method) => <DropdownOption key={method} value={method}>{PAYMENT_METHOD_LABELS[method]}</DropdownOption>)}</Dropdown>
      <Button type="button" size="sm" disabled={working || !chosen.some((sale) => salePayment(sale).status !== "paid")} onClick={() => void run(() => bulk.markPaid(chosen, bulkMethod))}><AnimatedIcon name="wallet" data-icon="inline-start" size={14} />Marcar cobradas</Button>
      <Button type="button" size="sm" variant="outline" disabled={working || !chosen.some(toDeliver)} onClick={() => void run(() => bulk.markDelivered(chosen))}><AnimatedIcon name="truck" data-icon="inline-start" size={14} />Marcar entregadas</Button>
      <Dropdown size="sm" aria-label="Cambiar canal" value="" placeholder="Cambiar canal…" disabled={working} onChange={(event) => { const value = event.target.value; if (value) void run(() => bulk.changeChannel(chosen, value)); }}>{channelOptions.map((option) => <DropdownOption key={option.value} value={option.value}>{option.label}</DropdownOption>)}</Dropdown>
      <Button type="button" size="sm" variant="outline" className="text-destructive" disabled={working} onClick={() => setConfirmArchive(true)}><AnimatedIcon name="delete" data-icon="inline-start" size={14} />Anular</Button>
      <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>Quitar selección</Button>
    </div> : null}
    {history ? <RecordHistory kind="sale" id={history.id} title={`Venta del ${history.soldOn.slice(8, 10)}/${history.soldOn.slice(5, 7)}${history.customer ? ` a ${history.customer}` : ""}`} demo={demo} onClose={() => setHistory(null)} /> : null}
    {isMobile ? <SaleCards rows={rows} today={today} channels={channels} money={money} suggestions={customerSuggestions} onUpdate={onUpdate} onArchive={onArchive} onEditItems={onEditItems} onOpenDeliveries={onOpenDeliveries} onCollect={onCollect} onRepeat={onRepeat} /> : <div className="max-h-[min(70vh,48rem)] overflow-auto rounded-lg border">
      <Table className="border-separate border-spacing-0">
        <TableHeader className="sticky top-0 z-20 bg-card"><TableRow className="hover:bg-transparent">
          <TableHead className={cn(sheetHead, "sticky left-0 z-30 w-10 min-w-10 max-w-10 bg-muted px-0 text-center")}><input type="checkbox" className="size-4 accent-primary" checked={allChosen} aria-label="Elegir todas las ventas que se ven" onChange={() => setSelected(allChosen ? new Set() : new Set(rows.map((sale) => sale.id)))} /></TableHead>
          <SortableHead column="date" label="Fecha" sort={sort} onSort={setSort} className="sticky left-10 z-30 min-w-48 bg-muted" />
          <SortableHead column="customer" label="Cliente" sort={sort} onSort={setSort} className="min-w-40" defaultDirection="asc" />
          <TableHead className={cn(sheetHead, "min-w-52")}>Producto</TableHead>
          <TableHead className={cn(sheetHead, "min-w-20 text-right")}>Cant.</TableHead>
          <TableHead className={cn(sheetHead, "min-w-28 text-right")}>Precio u.</TableHead>
          <SortableHead column="total" label="Total" sort={sort} onSort={setSort} className="min-w-28 text-right" />
          <TableHead className={cn(sheetHead, "min-w-40")}>Pago</TableHead>
          <TableHead className={cn(sheetHead, "min-w-40")}>Canal</TableHead>
          <TableHead className={cn(sheetHead, "min-w-36")}>Entrega</TableHead>
          <SortableHead column="left" label="Te dejó" sort={sort} onSort={setSort} className="min-w-28 text-right" />
          <TableHead className={cn(sheetHead, "min-w-44")}>Nota</TableHead>
          <TableHead className={cn(sheetHead, "w-32")} />
        </TableRow></TableHeader>
        <TableBody>{rows.map((sale) => {
          const single = sale.items.length === 1 ? sale.items[0] : null;
          const left = leftOf(sale);
          const channelValue = sale.channelId ?? DIRECT_CHANNEL.id;
          const channelKnown = channelOptions.some((option) => option.value === channelValue);
          const isChosen = selected.has(sale.id);
          return <TableRow key={sale.id} className={cn("group/row hover:bg-muted/30", isChosen && "bg-primary/5")}>
            <TableCell className={cn(sheetCell, "sticky left-0 z-10 w-10 min-w-10 max-w-10 bg-card text-center", isChosen && "bg-primary/5")}><input type="checkbox" className="size-4 accent-primary" checked={isChosen} aria-label={`Elegir la venta del ${sale.soldOn}${sale.customer ? ` a ${sale.customer}` : ""}`} onChange={() => toggle(sale.id)} /></TableCell>
            <TableCell className={cn(sheetCell, "sticky left-10 z-10 bg-card", isChosen && "bg-primary/5")}><div className="flex items-center">
              <EditableDate today={today} value={sale.soldOn} label={`Fecha de la venta a ${sale.customer || sale.channelName}`} onCommit={(soldOn) => void onUpdate(sale, { soldOn })} className="w-36 shrink-0" />
              <span className="pr-3 text-xs whitespace-nowrap text-muted-foreground">{relativeDay(sale.soldOn, today)}</span>
            </div></TableCell>
            <TableCell className={sheetCell}><EditableSuggest suggestions={customerSuggestions} value={sale.customer} label="Cliente" placeholder="Sin cliente" onCommit={(customer) => void onUpdate(sale, { customer })} /></TableCell>
            <TableCell className={sheetCell}>{single ? <Dropdown variant="cell" aria-label="Producto vendido" value={single.productId} onChange={(event) => { if (event.target.value !== single.productId) void onUpdate(sale, { items: [{ productId: event.target.value, quantity: single.quantityMilli / 1000 }] }, "Producto cambiado"); }}>
              {state.products.some((product) => product.id === single.productId) ? null : <DropdownOption value={single.productId} disabled>{single.productName}</DropdownOption>}
              {state.products.map((product) => <DropdownOption key={product.id} value={product.id}>{product.name}</DropdownOption>)}
            </Dropdown> : <button type="button" onClick={() => onEditItems(sale)} className="flex h-11 w-full items-center px-3 text-left text-sm hover:bg-accent/30" title={saleItemsText(sale.items)}><span className="truncate">{saleItemsText(sale.items)}</span></button>}</TableCell>
            <TableCell className={sheetCell}>{single ? <EditableNumber value={single.quantityMilli / 1000} label="Cantidad" min={0.001} onCommit={(quantity) => void onUpdate(sale, { items: [{ productId: single.productId, quantity, unitPrice: single.unitPriceMinor }] })} /> : <span className="block px-3 text-right text-xs text-muted-foreground">{sale.items.reduce((sum, item) => sum + item.quantityMilli, 0) / 1000} u.</span>}</TableCell>
            <TableCell className={sheetCell}>{single ? <EditableNumber value={single.unitPriceMinor} label="Precio por unidad" onCommit={(unitPrice) => void onUpdate(sale, { items: [{ productId: single.productId, quantity: single.quantityMilli / 1000, unitPrice }] }, "Precio actualizado")} /> : <span className="block px-3 text-right text-xs text-muted-foreground">Varios</span>}</TableCell>
            <TableCell className={cn(sheetCell, "px-3 text-right font-medium tabular-nums")}>{money(sale.totalMinor)}</TableCell>
            <TableCell className={cn(sheetCell, "px-3")}><PaymentBadge sale={sale} money={money} onClick={() => onCollect(sale)} /></TableCell>
            <TableCell className={sheetCell}>
              <Dropdown variant="cell" aria-label="Canal de la venta" value={channelValue} onChange={(event) => { if (event.target.value !== channelValue) void onUpdate(sale, { channelId: event.target.value === DIRECT_CHANNEL.id ? null : event.target.value }, "Canal cambiado: se recalcularon comisión y entrega"); }}>
                {channelKnown ? null : <DropdownOption value={channelValue} disabled>{sale.channelName}</DropdownOption>}
                {channelOptions.map((option) => <DropdownOption key={option.value} value={option.value}>{option.label}</DropdownOption>)}
              </Dropdown>
            </TableCell>
            <TableCell className={cn(sheetCell, "px-3")}>{sale.delivery
              ? <button type="button" onClick={onOpenDeliveries} className="inline-flex items-center gap-1.5 rounded-full hover:opacity-80" title="Ver en Entregas"><DeliveryStatusBadge status={sale.delivery.status} /><span className="text-xs text-muted-foreground tabular-nums">{sale.delivery.scheduledOn.slice(8, 10)}/{sale.delivery.scheduledOn.slice(5, 7)}</span></button>
              : <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onSchedule(sale)}><AnimatedIcon name="plus" data-icon="inline-start" size={12} />Programar</Button>}</TableCell>
            <TableCell className={cn(sheetCell, "px-3 text-right font-semibold tabular-nums", left !== null && left < 0 && "text-destructive")}>{left === null ? canFillSaleCosts(sale, costs)
              ? <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs font-normal" title="Algún producto no tenía el costo completo al venderse; hoy sí. Completarlo cambia lo que dejó esta venta." onClick={() => void onUpdate(sale, { fillMissingCosts: true }, "Venta completada con el costo de hoy", false)}>Completar costo</Button>
              : <span className="text-xs font-normal text-muted-foreground" title="Algún producto no tenía el costo completo al venderse, y todavía no lo tiene">Costo incompleto</span> : money(left)}</TableCell>
            <TableCell className={sheetCell}><EditableText value={sale.note} label="Nota" placeholder="—" onCommit={(note) => void onUpdate(sale, { note })} /></TableCell>
            <TableCell className={cn(sheetCell, "px-1")}><div className="flex items-center justify-end gap-0.5">
              <Button size="icon-sm" variant="ghost" aria-label="Repetir esta venta" title="Repetir: la carga en la caja" onClick={() => onRepeat(sale)}><AnimatedIcon name="refresh" size={14} /></Button>
              <ReceiptLink documentId={sale.documentId} demo={demo} label="Remito" />
              <Button size="icon-sm" variant="ghost" aria-label="Historial de la venta" title="Historial" onClick={() => setHistory(sale)}><AnimatedIcon name="history" size={14} /></Button>
              <Button size="icon-sm" variant="ghost" aria-label="Editar productos de la venta" title="Editar productos" onClick={() => onEditItems(sale)}><AnimatedIcon name="edit" size={14} /></Button>
              <Button size="icon-sm" variant="ghost" aria-label="Anular venta" title="Anular venta" onClick={() => onArchive(sale)}><AnimatedIcon name="delete" size={14} /></Button>
            </div></TableCell>
          </TableRow>;
        })}</TableBody>
        <TableFooter><TableRow>
          <TableCell colSpan={6} className="px-3 text-sm">{rows.length === sales.length ? "Total" : "Lo filtrado"} {label} · {rows.length} venta{rows.length === 1 ? "" : "s"}</TableCell>
          <TableCell className="px-3 text-right tabular-nums">{money(totals.total)}</TableCell>
          <TableCell className="px-3 text-sm tabular-nums">{totals.owed ? <span className="text-amber-800 dark:text-amber-300">Deben {money(totals.owed)}</span> : <span className="text-muted-foreground">{PAYMENT_STATUS_LABELS.paid}s</span>}</TableCell>
          <TableCell colSpan={2} />
          <TableCell className="px-3 text-right tabular-nums">{money(totals.left)}</TableCell>
          <TableCell colSpan={2} />
        </TableRow></TableFooter>
      </Table>
    </div>}
    <p className="text-xs text-muted-foreground">&quot;Te dejó&quot; es lo cobrado menos insumos, mano de obra, comisiones y entrega: lo que cada venta aporta para pagar los gastos fijos del mes. Si cambias el canal se recalculan la comisión y el costo de entrega.</p>
    {confirmArchive ? <Dialog open onOpenChange={(open) => { if (!open) setConfirmArchive(false); }}><DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>¿Anular {chosen.length === 1 ? "la venta elegida" : `las ${chosen.length} ventas elegidas`}?</DialogTitle><DialogDescription>Dejan de contar en el resultado del mes y se quitan sus entregas. Quedan en el historial.</DialogDescription></DialogHeader>
      <DialogFooter><Button type="button" variant="outline" onClick={() => setConfirmArchive(false)}>Cancelar</Button><Button type="button" variant="destructive" disabled={working} onClick={() => { setConfirmArchive(false); void run(() => bulk.archive(chosen)); }}>Anular</Button></DialogFooter>
    </DialogContent></Dialog> : null}
  </div>;
}

type ItemLine = { key: number; productId: string; quantity: string; price: string };

/** Changes the products of a sale; prices left empty keep the one charged (or the channel's list price for a new product). */
function SaleItemsDialog({ sale, state, onClose, onSave }: { sale: Sale; state: DomainState; onClose: () => void; onSave: (items: { productId: string; quantity: number; unitPrice?: number }[]) => Promise<void> }) {
  const [lines, setLines] = React.useState<ItemLine[]>(() => sale.items.map((item, index) => ({ key: index, productId: item.productId, quantity: String(item.quantityMilli / 1000), price: String(item.unitPriceMinor) })));
  const [busy, setBusy] = React.useState(false);
  const update = (key: number, change: Partial<ItemLine>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...change } : line));
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="sm:max-w-xl">
    <DialogHeader><DialogTitle>Productos de la venta</DialogTitle><DialogDescription>Venta del {sale.soldOn.slice(8, 10)}/{sale.soldOn.slice(5, 7)} por {sale.channelName}{sale.customer ? ` a ${sale.customer}` : ""}. Los productos que ya estaban conservan su costo del día de la venta.</DialogDescription></DialogHeader>
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_6rem_7rem_auto] gap-2 text-xs text-muted-foreground"><span>Producto</span><span>Cantidad</span><span>Precio u.</span><span className="w-8" /></div>
      {lines.map((line) => <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_6rem_7rem_auto] items-center gap-2">
        <Dropdown aria-label="Producto" className="w-full" value={line.productId} onChange={(event) => update(line.key, { productId: event.target.value, price: "" })}>
          {state.products.some((product) => product.id === line.productId) ? null : <DropdownOption value={line.productId} disabled>{sale.items.find((item) => item.productId === line.productId)?.productName ?? "Producto"}</DropdownOption>}
          {state.products.map((product) => <DropdownOption key={product.id} value={product.id}>{product.name}</DropdownOption>)}
        </Dropdown>
        <Input aria-label="Cantidad" type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => update(line.key, { quantity: event.target.value })} />
        <Input aria-label="Precio por unidad" type="number" min="0" step="any" inputMode="decimal" value={line.price} placeholder="De lista" onChange={(event) => update(line.key, { price: event.target.value })} />
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Quitar producto" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}><AnimatedIcon name="close" /></Button>
      </div>)}
      <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setLines((current) => [...current, { key: Date.now(), productId: state.products[0]?.id ?? "", quantity: "1", price: "" }])}><AnimatedIcon name="plus" data-icon="inline-start" />Otro producto</Button>
    </div>
    <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="button" disabled={busy || !lines.some((line) => Number(line.quantity) > 0)} onClick={async () => {
      setBusy(true);
      try { await onSave(lines.filter((line) => line.productId && Number(line.quantity) > 0).map((line) => ({ productId: line.productId, quantity: Number(line.quantity), ...(line.price ? { unitPrice: Number(line.price) } : {}) }))); }
      finally { setBusy(false); }
    }}>{busy ? "Guardando…" : "Guardar productos"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

type Line = { key: number; productId: string; quantity: string; price: string };

/** The full form: several products, delivery with its address, a receipt. `initialCustomer` opens it for a known customer, with their default address. */
export function SaleDialog({ directory, state, channels, demo, month, onClose, onSaved, initialCustomer = "" }: { directory: CustomerDirectory; state: DomainState; channels: SalesChannel[]; demo: boolean; month: string; onClose: () => void; onSaved: () => void; initialCustomer?: string }) {
  const initial = initialCustomer ? directory.customers.find((item) => item.name === initialCustomer) : undefined;
  const [customer, setCustomer] = React.useState(initialCustomer);
  const [address, setAddress] = React.useState(initial?.address ?? "");
  const [recipient, setRecipient] = React.useState(initial?.recipient ?? "");
  const [contact, setContact] = React.useState(initial?.contact ?? "");
  const pickCustomer = (name: string) => {
    const known = directory.customers.find((item) => item.name === name);
    if (!known) return;
    if (known.address) setAddress(known.address);
    if (known.contact) setContact(known.contact);
    if (known.recipient) setRecipient(known.recipient);
  };
  const money = useMoney(state.organization.currency);
  const idempotencyKey = React.useMemo(() => crypto.randomUUID(), []);
  const [channelId, setChannelId] = React.useState(channels[0]?.id ?? DIRECT_CHANNEL.id);
  const [lines, setLines] = React.useState<Line[]>([{ key: 0, productId: state.products[0]?.id ?? "", quantity: "1", price: "" }]);
  const [file, setFile] = React.useState<File | null>(null);
  const [payment, setPayment] = React.useState<PaymentChoice>("cash");
  const [busy, setBusy] = React.useState(false);
  const channel = channels.find((item) => item.id === channelId) ?? DIRECT_CHANNEL;
  const [addDelivery, setAddDelivery] = React.useState(false);
  const delivers = needsDelivery(channel) || addDelivery;
  const today = todayFor(demo);
  const defaultDate = today.startsWith(month) ? today : `${month}-01`;
  const update = (key: number, change: Partial<Line>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...change } : line));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const documentId = file && !demo ? await uploadDocument(file) : undefined;
      const delivery = String(data.get("delivery") ?? "").trim();
      const field = (name: string) => String(data.get(name) ?? "").trim();
      const deliveryDetails = delivers ? { scheduledOn: field("deliveryDate") || undefined, address: address.trim(), recipient: recipient.trim() || undefined, contact: contact.trim(), timeWindow: field("timeWindow") } : undefined;
      await businessAction({ action: "record-sale", idempotencyKey, sale: {
        soldOn: String(data.get("date")), channelId: channel.id === DIRECT_CHANNEL.id ? null : channel.id,
        items: lines.filter((line) => line.productId && Number(line.quantity) > 0).map((line) => ({ productId: line.productId, quantity: Number(line.quantity), ...(line.price ? { unitPrice: Number(line.price) } : {}) })),
        ...(delivery ? { deliveryCost: Number(delivery) } : {}), customer: customer.trim(), documentId,
        ...(deliveryDetails ? { delivery: deliveryDetails } : {}),
        ...paymentFields(payment),
      } }, demo);
      notifySaved("Venta registrada");
      onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo registrar"); }
    finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>Registrar venta</DialogTitle><DialogDescription>Si no escribes el precio se usa el de lista con el ajuste del canal. También puedes mandarle a Cozte la foto del remito.</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={submit}><FieldGroup>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="sale-date">Fecha</FieldLabel><DatePicker id="sale-date" name="date" required defaultValue={defaultDate} today={today} /></Field>
        <Field><FieldLabel htmlFor="sale-channel">Canal</FieldLabel><Dropdown id="sale-channel" className="w-full" value={channelId} onChange={(event) => setChannelId(event.target.value)}>{channels.map((item) => <DropdownOption key={item.id} value={item.id}>{item.name}</DropdownOption>)}<DropdownOption value={DIRECT_CHANNEL.id}>{DIRECT_CHANNEL.name}</DropdownOption></Dropdown></Field>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Productos</span>
        {lines.map((line) => {
          const product = state.products.find((item) => item.id === line.productId);
          const listPrice = product ? channelPrice(product, channel, state.organization.currency) : null;
          return <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_6rem_8rem_auto] items-center gap-2">
            <Dropdown aria-label="Producto" className="w-full" value={line.productId} onChange={(event) => update(line.key, { productId: event.target.value })}>{state.products.map((item) => <DropdownOption key={item.id} value={item.id}>{item.name}</DropdownOption>)}</Dropdown>
            <Input aria-label="Cantidad" type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(event) => update(line.key, { quantity: event.target.value })} />
            <Input aria-label="Precio por unidad" type="number" min="0" step="any" inputMode="decimal" value={line.price} placeholder={listPrice === null ? "Precio" : money(listPrice)} onChange={(event) => update(line.key, { price: event.target.value })} />
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Quitar producto" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}><AnimatedIcon name="close" /></Button>
          </div>;
        })}
        <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setLines((current) => [...current, { key: Date.now(), productId: state.products[0]?.id ?? "", quantity: "1", price: "" }])}><AnimatedIcon name="plus" data-icon="inline-start" />Otro producto</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="sale-delivery">Costo de entrega</FieldLabel><Input id="sale-delivery" name="delivery" type="number" min="0" step="any" inputMode="decimal" placeholder={money(channel.deliveryCostPerOrderMinor)} /><FieldDescription>Déjalo vacío para usar el habitual del canal.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="sale-customer">Cliente</FieldLabel><SuggestInput id="sale-customer" value={customer} placeholder="Opcional" suggestions={directory.customers.map((item) => ({ value: item.name, hint: item.address || undefined }))} onValueChange={(value, picked) => { setCustomer(value); if (picked) pickCustomer(value); }} /></Field>
      </div>
      <Field><FieldLabel>Pago</FieldLabel><PaymentPicker value={payment} onChange={setPayment} /></Field>
      {delivers ? <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Entrega</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="sale-delivery-date">Fecha de entrega</FieldLabel><DatePicker id="sale-delivery-date" name="deliveryDate" defaultValue={defaultDate} today={today} clearable placeholder="Sin fecha" /><FieldDescription>Si ya pasó, queda como entregada.</FieldDescription></Field>
          <Field><FieldLabel htmlFor="sale-window">Franja horaria</FieldLabel><Input id="sale-window" name="timeWindow" placeholder="Ej. 9 a 13" /></Field>
          <Field><FieldLabel htmlFor="sale-address">Dirección</FieldLabel><SuggestInput id="sale-address" value={address} placeholder="Calle, número, ciudad" suggestions={directory.addresses.map((value) => ({ value }))} onValueChange={(value) => setAddress(value)} /></Field>
          <Field><FieldLabel htmlFor="sale-recipient">Recibe</FieldLabel><SuggestInput id="sale-recipient" value={recipient} placeholder="Si es otra persona que el cliente" suggestions={directory.recipients.map((value) => ({ value }))} onValueChange={(value) => setRecipient(value)} /></Field>
          <Field><FieldLabel htmlFor="sale-contact">Contacto</FieldLabel><Input id="sale-contact" value={contact} onChange={(event) => setContact(event.target.value)} placeholder="Teléfono" /></Field>
        </div>
        {!needsDelivery(channel) ? <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setAddDelivery(false)}>Sin entrega</Button> : null}
      </fieldset> : <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setAddDelivery(true)}><AnimatedIcon name="plus" data-icon="inline-start" />Agregar entrega</Button>}
      <Field><FieldLabel htmlFor="sale-receipt">Remito o factura</FieldLabel><Input id="sale-receipt" type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><FieldDescription>PDF o imagen de hasta 4 MB. Opcional.</FieldDescription></Field>
    </FieldGroup>
    <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy || !state.products.length}>{busy ? "Guardando…" : "Registrar venta"}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
