"use client";

import * as React from "react";
import { toast } from "sonner";
import { DIRECT_CHANNEL, canFillSaleCosts, channelPrice, needsDelivery, saleItemsText, type ChannelEconomics, type CustomerDirectory, type Sale, type SalePatch, type SalesChannel } from "@/lib/business";
import { calculateCosts, type DomainState } from "@/lib/domain";
import { AnimatedIcon } from "@/components/animated-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { SuggestInput, type Suggestion } from "@/components/ui/suggest-input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";
import { MonthPicker, ReceiptLink, SectionHeader, Stat, Tip, businessAction, notifySaved, todayFor, uploadDocument, useBusinessView, useCustomerDirectory, useMoney } from "./business-ui";
import { EditableDate, EditableNumber, EditableSuggest, EditableText, SortableHead, TableToolbar, downloadCsv, matches, monthName, sheetCell, sheetHead, usePersistentState, type SortState } from "./data-table";
import { RecordHistory } from "./record-history";
import { DELIVERY_STATUS_LABELS } from "@/lib/business";
import { DeliveryStatusBadge, relativeDay } from "./delivery-status";
import { SaleCards } from "./mobile-cards";
import { useIsMobile } from "@/hooks/use-mobile";

const percent = (bps: number) => `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(bps / 100)} %`;
const leftOf = (sale: Sale) => sale.variableCostMinor === null ? null : sale.totalMinor - sale.variableCostMinor - sale.sellingCostMinor - sale.deliveryCostMinor;

type SortKey = "date" | "customer" | "total" | "left";

/** The change that puts a sale back as it was before an edit. */
function inverseSalePatch(sale: Sale, patch: SalePatch): SalePatch {
  const back: SalePatch = {};
  if (patch.soldOn !== undefined) back.soldOn = sale.soldOn;
  if (patch.customer !== undefined) back.customer = sale.customer;
  if (patch.note !== undefined) back.note = sale.note;
  if (patch.channelId !== undefined) { back.channelId = sale.channelId; back.deliveryCost = sale.deliveryCostMinor; }
  if (patch.deliveryCost !== undefined) back.deliveryCost = sale.deliveryCostMinor;
  if (patch.items !== undefined) back.items = sale.items.map((item) => ({ productId: item.productId, quantity: item.quantityMilli / 1000, unitPrice: item.unitPriceMinor }));
  return back;
}

export function SalesSection({ state, demo, month, onMonthChange, onOpenCozte, onOpenDeliveries, onDataChanged }: { state: DomainState; demo: boolean; month: string; onMonthChange: (month: string) => void; onOpenCozte: () => void; onOpenDeliveries?: () => void; onDataChanged?: () => void }) {
  const { view, loading, reload } = useBusinessView(month, demo, state);
  const money = useMoney(state.organization.currency);
  const [channelDialog, setChannelDialog] = React.useState<SalesChannel | "new" | null>(null);
  const [saleOpen, setSaleOpen] = React.useState(false);
  const [itemsSale, setItemsSale] = React.useState<Sale | null>(null);
  const directory = useCustomerDirectory(demo, view?.sales.length);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key.toLowerCase() !== "n" || event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable], [role=combobox], [role=dialog]")) return;
      event.preventDefault();
      setSaleOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const customerSuggestions = React.useMemo<Suggestion[]>(() => directory.customers.map((item) => ({ value: item.name, hint: [item.address, item.sales > 1 ? `${item.sales} compras` : ""].filter(Boolean).join(" · ") || undefined })), [directory]);

  const today = todayFor(demo);
  async function archive(kind: "channel" | "sale", id: string) {
    try { await businessAction({ action: "archive", kind, id }, demo); notifySaved(kind === "channel" ? "Canal quitado" : "Venta anulada"); reload(); onDataChanged?.(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo quitar"); }
  }
  async function update(sale: Sale, patch: SalePatch, message = "Venta actualizada", undoable = true) {
    try {
      await businessAction({ action: "update-sale", id: sale.id, patch }, demo);
      notifySaved(message, undoable ? () => void update(sale, inverseSalePatch(sale, patch), "Cambio deshecho", false) : undefined);
      reload(); onDataChanged?.();
      return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar el cambio"); return false; }
  }
  async function scheduleDelivery(sale: Sale) {
    try { await businessAction({ action: "save-delivery", delivery: { saleId: sale.id, scheduledOn: sale.soldOn >= today ? sale.soldOn : today, status: "pending" } }, demo); notifySaved("Entrega creada: complétala en Entregas"); reload(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo crear la entrega"); }
  }

  const costs = React.useMemo(() => calculateCosts(state), [state]);
  const fillable = (view?.sales ?? []).filter((sale) => canFillSaleCosts(sale, costs));
  async function fillAll() {
    let done = 0;
    for (const sale of fillable) { try { await businessAction({ action: "update-sale", id: sale.id, patch: { fillMissingCosts: true } }, demo); done++; } catch { /* Reported below. */ } }
    notifySaved(done === fillable.length ? `${done} venta${done === 1 ? "" : "s"} completada${done === 1 ? "" : "s"} con el costo de hoy` : `Se completaron ${done} de ${fillable.length} ventas`);
    reload(); onDataChanged?.();
  }
  const byProduct = new Map<string, ChannelEconomics[]>();
  for (const row of view?.economics ?? []) byProduct.set(row.productId, [...byProduct.get(row.productId) ?? [], row]);
  const sales = view?.sales ?? [];
  const result = view?.result;

  return <>
    <SectionHeader eyebrow="Vender" title="Ventas" description="Todas tus ventas en una tabla que puedes editar y filtrar, la más reciente primero. Cada cambio recalcula lo que te dejó la venta y el resultado del mes, y Cozte lo ve al instante.">
      <Button variant="outline" onClick={() => setChannelDialog("new")}><AnimatedIcon name="plus" data-icon="inline-start" />Agregar canal</Button>
      <Button onClick={() => setSaleOpen(true)} title="Atajo: tecla N"><AnimatedIcon name="plus" data-icon="inline-start" />Registrar venta<kbd className="ml-1 hidden rounded border border-current/30 px-1 text-[10px] opacity-70 sm:inline">N</kbd></Button>
    </SectionHeader>
    {!view || !result ? <TextShimmer className="text-sm">Cargando ventas…</TextShimmer> : <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Vendido en el mes" value={money(result.revenue)} note={`${result.sales} venta${result.sales === 1 ? "" : "s"}`} />
        <Stat label="Te dejaron las ventas" value={money(result.contribution)} note="Después de producir, vender y entregar" tone={result.contribution < 0 ? "negative" : undefined} />
        <Stat label="Venta promedio" value={result.sales ? money(result.revenue / result.sales) : "—"} />
        <Stat label="Comisiones y cargos" value={money(result.sellingCost)} note={result.revenue ? `${Math.round(result.sellingCost / result.revenue * 100)} % de lo vendido` : undefined} />
      </div>

      {fillable.length ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/70 px-4 py-3 text-sm dark:border-amber-400/30 dark:bg-amber-500/5">
        <p><span className="font-medium">{fillable.length} venta{fillable.length === 1 ? "" : "s"} con costo incompleto.</span> Cuando se registraron faltaba el costo de algún producto, así que no se sabe cuánto dejaron. Hoy ese costo está completo.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void fillAll()}>Completar con el costo de hoy</Button>
      </div> : null}
      <Card className="gap-4">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5"><CardTitle>Ventas</CardTitle><CardDescription>Haz clic en una celda para corregirla: Enter guarda, Escape cancela. El precio cobrado y el costo de cada producto quedan como estaban el día de la venta.</CardDescription></div>
          <MonthPicker month={month} onChange={onMonthChange} />
        </CardHeader>
        <CardContent>
          {!state.products.length ? <Empty className="py-6"><EmptyHeader><EmptyTitle>Primero, tus productos</EmptyTitle><EmptyDescription>Para registrar ventas, Cozte necesita saber qué vendes y cuánto cuesta hacerlo. Cárgalos en Costos de producción o cuéntaselos a Cozte.</EmptyDescription></EmptyHeader><Button variant="outline" onClick={onOpenCozte}>Contarle a Cozte qué fabrico</Button></Empty>
            : sales.length ? <SalesTable costs={costs} month={month} today={today} customerSuggestions={customerSuggestions} sales={sales} state={state} channels={view.channels} demo={demo} money={money} onUpdate={update} onArchive={(sale) => void archive("sale", sale.id)} onEditItems={setItemsSale} onSchedule={(sale) => void scheduleDelivery(sale)} onOpenDeliveries={onOpenDeliveries} />
            : <Empty className="py-6"><EmptyHeader><EmptyTitle>No hay ventas registradas en {monthName(month)}</EmptyTitle><EmptyDescription>Regístralas acá o mándale a Cozte la foto del remito o factura.</EmptyDescription></EmptyHeader><Button variant="outline" onClick={onOpenCozte}>Enviar un remito a Cozte</Button></Empty>}
          {state.products.length ? <QuickSale key={view.sales.length} state={state} channels={view.channels} demo={demo} today={today} month={month} suggestions={customerSuggestions} onSaved={() => { reload(); onDataChanged?.(); }} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Tus canales de venta</CardTitle><CardDescription>Dónde y cómo vendes. Si no cargas ninguno, las ventas se toman como venta directa, sin comisión ni envío. La forma y el costo de entregar de cada canal se ajustan también en Entregas.</CardDescription></CardHeader>
        <CardContent>{view.channels.length ? <div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Canal</TableHead><TableHead>Cómo entrega</TableHead><TableHead className="text-right">Comisión</TableHead><TableHead className="text-right">Cargo por venta</TableHead><TableHead className="text-right">Entregar un pedido</TableHead><TableHead className="text-right">Unidades por pedido</TableHead><TableHead className="text-right">Precio</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
          <TableBody>{view.channels.map((channel) => <TableRow key={channel.id}>
            <TableCell className="font-medium">{channel.name}</TableCell>
            <TableCell className="text-muted-foreground">{channel.deliveryMethod || "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{percent(channel.commissionBps)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(channel.feePerOrderMinor)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(channel.deliveryCostPerOrderMinor)}</TableCell>
            <TableCell className="text-right tabular-nums">{new Intl.NumberFormat("es-AR").format(channel.unitsPerOrderMilli / 1000)}</TableCell>
            <TableCell className="text-right">{channel.priceAdjustmentBps ? <Badge variant="outline">{channel.priceAdjustmentBps > 0 ? "+" : ""}{percent(channel.priceAdjustmentBps)}</Badge> : <span className="text-muted-foreground">De lista</span>}</TableCell>
            <TableCell className="text-right"><div className="flex justify-end gap-1"><Button size="icon-sm" variant="ghost" aria-label={`Editar ${channel.name}`} onClick={() => setChannelDialog(channel)}><AnimatedIcon name="edit" /></Button><Button size="icon-sm" variant="ghost" aria-label={`Quitar ${channel.name}`} onClick={() => void archive("channel", channel.id)}><AnimatedIcon name="delete" /></Button></div></TableCell>
          </TableRow>)}</TableBody>
        </Table></div> : <Empty className="py-6"><EmptyHeader><EmptyTitle>Todavía no hay canales</EmptyTitle><EmptyDescription>Agrega los lugares donde vendes (local, ferias, Instagram, Mercado Libre, mayoristas) o cuéntaselos a Cozte.</EmptyDescription></EmptyHeader></Empty>}</CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cuánto te queda por unidad</CardTitle><CardDescription>Precio de cada producto en cada canal, menos lo que cuesta producirlo, venderlo y entregarlo.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state.products.length ? [...byProduct.values()].map((rows) => <div key={rows[0].productId} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{rows[0].productName}</h3>
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Canal</TableHead><TableHead className="text-right">Precio</TableHead><TableHead className="text-right">Producir</TableHead><TableHead className="text-right">Vender</TableHead><TableHead className="text-right">Entregar</TableHead><TableHead className="text-right">Te queda</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map((row) => <TableRow key={row.channelId}>
                <TableCell>{row.channelName}</TableCell>
                <TableCell className="text-right tabular-nums">{row.price === null ? <span className="text-muted-foreground">Sin precio</span> : money(row.price)}</TableCell>
                <TableCell className="text-right tabular-nums">{row.productionCost === null ? <span className="text-muted-foreground">Incompleto</span> : money(row.productionCost)}</TableCell>
                <TableCell className="text-right tabular-nums">{row.sellingCost === null ? "—" : money(row.sellingCost)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(row.deliveryCost)}</TableCell>
                <TableCell className={cn("text-right font-semibold tabular-nums", row.left !== null && row.left < 0 && "text-destructive")}>{row.left === null ? "—" : <>{money(row.left)}<span className="ml-1 text-xs font-normal text-muted-foreground">{row.leftPercent !== null ? `${Math.round(row.leftPercent)} %` : ""}</span></>}</TableCell>
              </TableRow>)}</TableBody>
            </Table></div>
          </div>) : <p className="text-sm text-muted-foreground">Primero carga tus productos en Costos de producción.</p>}
          <Tip>&quot;Te queda&quot; es lo que sobra de cada unidad después de producirla, venderla y entregarla. Con eso se pagan los gastos de la empresa (contador, publicidad, envíos fijos) y lo que sobra es ganancia. Un canal que vende más barato o cobra comisión puede convenir igual si vende mucho más.</Tip>
        </CardContent>
      </Card>
    </div>}
    {channelDialog ? <ChannelDialog channel={channelDialog === "new" ? null : channelDialog} demo={demo} onClose={() => setChannelDialog(null)} onSaved={() => { setChannelDialog(null); reload(); onDataChanged?.(); }} /> : null}
    {saleOpen && view ? <SaleDialog directory={directory} state={state} channels={view.channels} demo={demo} month={month} onClose={() => setSaleOpen(false)} onSaved={() => { setSaleOpen(false); reload(); onDataChanged?.(); }} /> : null}
    {itemsSale ? <SaleItemsDialog sale={itemsSale} state={state} onClose={() => setItemsSale(null)} onSave={async (items) => { if (await update(itemsSale, { items }, "Productos de la venta actualizados")) setItemsSale(null); }} /> : null}
  </>;
}

/** The month's sales as an editable sheet: search and filters on top, most recent first unless sorted by a column. */
function SalesTable({ costs, month, today, customerSuggestions, sales, state, channels, demo, money, onUpdate, onArchive, onEditItems, onSchedule, onOpenDeliveries }: {
  costs: ReturnType<typeof calculateCosts>; month: string; today: string; customerSuggestions: Suggestion[]; sales: Sale[]; state: DomainState; channels: SalesChannel[]; demo: boolean; money: (value: number) => string;
  onUpdate: (sale: Sale, patch: SalePatch, message?: string, undoable?: boolean) => Promise<boolean>; onArchive: (sale: Sale) => void; onEditItems: (sale: Sale) => void; onSchedule: (sale: Sale) => void; onOpenDeliveries?: () => void;
}) {
  const [search, setSearch] = React.useState("");
  const [channelFilter, setChannelFilter] = usePersistentState<string>("ventas:canal", "all");
  const [deliveryFilter, setDeliveryFilter] = usePersistentState<string>("ventas:entrega", "all");
  const [sort, setSort] = React.useState<SortState<SortKey>>(null);
  const isMobile = useIsMobile();
  const channelOptions = [...channels.map((channel) => ({ value: channel.id, label: channel.name })), { value: DIRECT_CHANNEL.id, label: DIRECT_CHANNEL.name }];
  const rows = React.useMemo(() => {
    const filtered = sales.filter((sale) => {
      if (channelFilter !== "all" && (sale.channelId ?? DIRECT_CHANNEL.id) !== channelFilter) return false;
      if (deliveryFilter === "open" && !(sale.delivery && ["pending", "on_the_way", "failed"].includes(sale.delivery.status))) return false;
      if (deliveryFilter === "delivered" && sale.delivery?.status !== "delivered") return false;
      if (deliveryFilter === "none" && sale.delivery) return false;
      return matches(search, [sale.customer, sale.channelName, sale.note, saleItemsText(sale.items), sale.soldOn]);
    });
    const direction = sort?.direction === "asc" ? 1 : -1;
    const value = (sale: Sale): string | number => !sort || sort.key === "date" ? sale.soldOn : sort.key === "customer" ? sale.customer.toLowerCase() : sort.key === "total" ? sale.totalMinor : leftOf(sale) ?? -Infinity;
    return [...filtered].sort((a, b) => { const x = value(a), y = value(b); return (x < y ? -1 : x > y ? 1 : 0) * (sort ? direction : -1); });
  }, [sales, search, channelFilter, deliveryFilter, sort]);
  const totals = rows.reduce((sum, sale) => ({ total: sum.total + sale.totalMinor, selling: sum.selling + sale.sellingCostMinor, delivery: sum.delivery + sale.deliveryCostMinor, left: sum.left + (leftOf(sale) ?? 0) }), { total: 0, selling: 0, delivery: 0, left: 0 });
  const disabled = false;
  const [history, setHistory] = React.useState<Sale | null>(null);
  const exportRows = () => downloadCsv(`ventas-${month}`, ["Fecha", "Canal", "Cliente", "Productos", "Cobrado", "Comisiones y cargos", "Costo de entrega", "Te dejó", "Entrega", "Nota"],
    rows.map((sale) => [sale.soldOn, sale.channelName, sale.customer, saleItemsText(sale.items), sale.totalMinor, sale.sellingCostMinor, sale.deliveryCostMinor, leftOf(sale), sale.delivery ? `${DELIVERY_STATUS_LABELS[sale.delivery.status]} (${sale.delivery.scheduledOn})` : "", sale.note]));
  return <div className="flex flex-col gap-3">
    <TableToolbar search={search} onSearch={setSearch} placeholder="Buscar cliente, producto, canal o nota" shown={rows.length} total={sales.length} filters={[
      { id: "channel", label: "Canal", value: channelFilter, onChange: setChannelFilter, options: [{ value: "all", label: "Todos los canales" }, ...channelOptions] },
      { id: "delivery", label: "Entrega", value: deliveryFilter, onChange: setDeliveryFilter, options: [{ value: "all", label: "Con y sin entrega" }, { value: "open", label: "Entrega por hacer", hint: "Pendiente, en camino o con problema" }, { value: "delivered", label: "Ya entregadas" }, { value: "none", label: "Sin entrega" }] },
    ]}><Button type="button" size="sm" variant="outline" className="h-8" onClick={exportRows} title="Descarga lo que ves (con los filtros aplicados)"><AnimatedIcon name="cloud" data-icon="inline-start" size={14} />Descargar Excel</Button></TableToolbar>
    {history ? <RecordHistory kind="sale" id={history.id} title={`Venta del ${history.soldOn.slice(8, 10)}/${history.soldOn.slice(5, 7)}${history.customer ? ` a ${history.customer}` : ""}`} demo={demo} onClose={() => setHistory(null)} /> : null}
    {isMobile ? <SaleCards rows={rows} today={today} channels={channels} money={money} suggestions={customerSuggestions} onUpdate={onUpdate} onArchive={onArchive} onEditItems={onEditItems} onOpenDeliveries={onOpenDeliveries} /> : <div className="max-h-[min(70vh,48rem)] overflow-auto rounded-lg border">
      <Table className="border-separate border-spacing-0">
        <TableHeader className="sticky top-0 z-20 bg-card"><TableRow className="hover:bg-transparent">
          <SortableHead column="date" label="Fecha" sort={sort} onSort={setSort} className="sticky left-0 z-30 min-w-48 bg-muted" />
          <TableHead className={cn(sheetHead, "min-w-40")}>Canal</TableHead>
          <SortableHead column="customer" label="Cliente" sort={sort} onSort={setSort} className="min-w-40" defaultDirection="asc" />
          <TableHead className={cn(sheetHead, "min-w-52")}>Producto</TableHead>
          <TableHead className={cn(sheetHead, "min-w-24 text-right")}>Cantidad</TableHead>
          <TableHead className={cn(sheetHead, "min-w-28 text-right")}>Precio u.</TableHead>
          <SortableHead column="total" label="Cobrado" sort={sort} onSort={setSort} className="min-w-28 text-right" />
          <TableHead className={cn(sheetHead, "min-w-28 text-right")} title="Comisión, cargo por venta y gastos de venta por unidad">Vender</TableHead>
          <TableHead className={cn(sheetHead, "min-w-28 text-right")}>Entregar</TableHead>
          <SortableHead column="left" label="Te dejó" sort={sort} onSort={setSort} className="min-w-28 text-right" />
          <TableHead className={cn(sheetHead, "min-w-36")}>Entrega</TableHead>
          <TableHead className={cn(sheetHead, "min-w-44")}>Nota</TableHead>
          <TableHead className={cn(sheetHead, "w-24")} />
        </TableRow></TableHeader>
        <TableBody>{rows.map((sale) => {
          const single = sale.items.length === 1 ? sale.items[0] : null;
          const left = leftOf(sale);
          const channelValue = sale.channelId ?? DIRECT_CHANNEL.id;
          const channelKnown = channelOptions.some((option) => option.value === channelValue);
          return <TableRow key={sale.id} className="group/row hover:bg-muted/30">
            <TableCell className={cn(sheetCell, "sticky left-0 z-10 bg-card")}><div className="flex items-center">
              <EditableDate value={sale.soldOn} label={`Fecha de la venta a ${sale.customer || sale.channelName}`} disabled={disabled} onCommit={(soldOn) => void onUpdate(sale, { soldOn })} className="w-36 shrink-0" />
              <span className="pr-3 text-xs whitespace-nowrap text-muted-foreground">{relativeDay(sale.soldOn, today)}</span>
            </div></TableCell>
            <TableCell className={sheetCell}>
              <Dropdown variant="cell" aria-label="Canal de la venta" value={channelValue} disabled={disabled} onChange={(event) => { if (event.target.value !== channelValue) void onUpdate(sale, { channelId: event.target.value === DIRECT_CHANNEL.id ? null : event.target.value }, "Canal cambiado: se recalcularon comisión y entrega"); }}>
                {channelKnown ? null : <DropdownOption value={channelValue} disabled>{sale.channelName}</DropdownOption>}
                {channelOptions.map((option) => <DropdownOption key={option.value} value={option.value}>{option.label}</DropdownOption>)}
              </Dropdown>
            </TableCell>
            <TableCell className={sheetCell}><EditableSuggest suggestions={customerSuggestions} value={sale.customer} label="Cliente" placeholder="Sin cliente" disabled={disabled} onCommit={(customer) => void onUpdate(sale, { customer })} /></TableCell>
            <TableCell className={sheetCell}>{single ? <Dropdown variant="cell" aria-label="Producto vendido" value={single.productId} disabled={disabled} onChange={(event) => { if (event.target.value !== single.productId) void onUpdate(sale, { items: [{ productId: event.target.value, quantity: single.quantityMilli / 1000 }] }, "Producto cambiado"); }}>
              {state.products.some((product) => product.id === single.productId) ? null : <DropdownOption value={single.productId} disabled>{single.productName}</DropdownOption>}
              {state.products.map((product) => <DropdownOption key={product.id} value={product.id}>{product.name}</DropdownOption>)}
            </Dropdown> : <button type="button" disabled={disabled} onClick={() => onEditItems(sale)} className="flex h-11 w-full items-center px-3 text-left text-sm hover:bg-accent/30 disabled:cursor-default" title={saleItemsText(sale.items)}><span className="truncate">{saleItemsText(sale.items)}</span></button>}</TableCell>
            <TableCell className={sheetCell}>{single ? <EditableNumber value={single.quantityMilli / 1000} label="Cantidad" disabled={disabled} min={0.001} onCommit={(quantity) => void onUpdate(sale, { items: [{ productId: single.productId, quantity, unitPrice: single.unitPriceMinor }] })} /> : <span className="block px-3 text-right text-xs text-muted-foreground">{sale.items.reduce((sum, item) => sum + item.quantityMilli, 0) / 1000} u.</span>}</TableCell>
            <TableCell className={sheetCell}>{single ? <EditableNumber value={single.unitPriceMinor} label="Precio por unidad" disabled={disabled} onCommit={(unitPrice) => void onUpdate(sale, { items: [{ productId: single.productId, quantity: single.quantityMilli / 1000, unitPrice }] }, "Precio actualizado")} /> : <span className="block px-3 text-right text-xs text-muted-foreground">Varios</span>}</TableCell>
            <TableCell className={cn(sheetCell, "px-3 text-right font-medium tabular-nums")}>{money(sale.totalMinor)}</TableCell>
            <TableCell className={cn(sheetCell, "px-3 text-right tabular-nums text-muted-foreground")}>{money(sale.sellingCostMinor)}</TableCell>
            <TableCell className={sheetCell}><EditableNumber value={sale.deliveryCostMinor} label="Costo de entregar" disabled={disabled} onCommit={(deliveryCost) => void onUpdate(sale, { deliveryCost }, "Costo de entrega actualizado")} /></TableCell>
            <TableCell className={cn(sheetCell, "px-3 text-right font-semibold tabular-nums", left !== null && left < 0 && "text-destructive")}>{left === null ? canFillSaleCosts(sale, costs)
              ? <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs font-normal" title="Algún producto no tenía el costo completo al venderse; hoy sí. Completarlo cambia lo que dejó esta venta." onClick={() => void onUpdate(sale, { fillMissingCosts: true }, "Venta completada con el costo de hoy", false)}>Completar costo</Button>
              : <span className="text-xs font-normal text-muted-foreground" title="Algún producto no tenía el costo completo al venderse, y todavía no lo tiene">Costo incompleto</span> : money(left)}</TableCell>
            <TableCell className={cn(sheetCell, "px-3")}>{sale.delivery
              ? <button type="button" onClick={onOpenDeliveries} className="inline-flex items-center gap-1.5 rounded-full hover:opacity-80" title="Ver en Entregas"><DeliveryStatusBadge status={sale.delivery.status} /><span className="text-xs text-muted-foreground tabular-nums">{sale.delivery.scheduledOn.slice(8, 10)}/{sale.delivery.scheduledOn.slice(5, 7)}</span></button>
              : <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={disabled} onClick={() => onSchedule(sale)}><AnimatedIcon name="plus" data-icon="inline-start" size={12} />Programar</Button>}</TableCell>
            <TableCell className={sheetCell}><EditableText value={sale.note} label="Nota" placeholder="—" disabled={disabled} onCommit={(note) => void onUpdate(sale, { note })} /></TableCell>
            <TableCell className={cn(sheetCell, "px-1")}><div className="flex items-center justify-end gap-0.5">
              <ReceiptLink documentId={sale.documentId} demo={demo} label="Remito" />
              <Button size="icon-sm" variant="ghost" aria-label="Historial de la venta" title="Historial" onClick={() => setHistory(sale)}><AnimatedIcon name="history" size={14} /></Button>
              <Button size="icon-sm" variant="ghost" aria-label="Editar productos de la venta" title="Editar productos" disabled={disabled} onClick={() => onEditItems(sale)}><AnimatedIcon name="edit" size={14} /></Button>
              <Button size="icon-sm" variant="ghost" aria-label="Anular venta" title="Anular venta" disabled={disabled} onClick={() => onArchive(sale)}><AnimatedIcon name="delete" size={14} /></Button>
            </div></TableCell>
          </TableRow>;
        })}</TableBody>
        <TableFooter><TableRow>
          <TableCell colSpan={6} className="px-3 text-sm">{rows.length === sales.length ? `Total de ${monthName(month)}` : `Lo filtrado de ${monthName(month)}`} · {rows.length} venta{rows.length === 1 ? "" : "s"}</TableCell>
          <TableCell className="px-3 text-right tabular-nums">{money(totals.total)}</TableCell>
          <TableCell className="px-3 text-right tabular-nums">{money(totals.selling)}</TableCell>
          <TableCell className="px-3 text-right tabular-nums">{money(totals.delivery)}</TableCell>
          <TableCell className="px-3 text-right tabular-nums">{money(totals.left)}</TableCell>
          <TableCell colSpan={3} />
        </TableRow></TableFooter>
      </Table>
    </div>}
    <p className="text-xs text-muted-foreground">&quot;Te dejó&quot; es lo cobrado menos insumos, mano de obra, comisiones y entrega: lo que cada venta aporta para pagar los gastos fijos del mes. Si cambias el canal se recalculan la comisión y el costo de entrega.</p>
  </div>;
}

/** A sale in one line under the table: date, channel, product, quantity and customer, at the channel's price. */
function QuickSale({ state, channels, demo, today, month, suggestions, onSaved }: { state: DomainState; channels: SalesChannel[]; demo: boolean; today: string; month: string; suggestions: Suggestion[]; onSaved: () => void }) {
  const [soldOn, setSoldOn] = React.useState(today.startsWith(month) ? today : `${month}-01`);
  const [channelId, setChannelId] = React.useState(channels[0]?.id ?? DIRECT_CHANNEL.id);
  const [productId, setProductId] = React.useState(state.products[0]?.id ?? "");
  const [quantity, setQuantity] = React.useState("1");
  const [customer, setCustomer] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const idempotencyKey = React.useMemo(() => crypto.randomUUID(), []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!productId || !(Number(quantity) > 0)) return;
    setBusy(true);
    try {
      await businessAction({ action: "record-sale", idempotencyKey, sale: { soldOn, channelId: channelId === DIRECT_CHANNEL.id ? null : channelId, items: [{ productId, quantity: Number(quantity) }], customer: customer.trim() } }, demo);
      notifySaved("Venta registrada");
      onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo registrar"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed bg-muted/30 p-2" aria-label="Carga rápida de una venta">
    <span className="px-1 text-xs font-medium text-muted-foreground">Carga rápida</span>
    <Input type="date" value={soldOn} onChange={(event) => setSoldOn(event.target.value)} aria-label="Fecha" className="h-8 w-36" required />
    <Dropdown aria-label="Canal" value={channelId} onChange={(event) => setChannelId(event.target.value)}>{channels.map((item) => <DropdownOption key={item.id} value={item.id}>{item.name}</DropdownOption>)}<DropdownOption value={DIRECT_CHANNEL.id}>{DIRECT_CHANNEL.name}</DropdownOption></Dropdown>
    <Dropdown aria-label="Producto" value={productId} onChange={(event) => setProductId(event.target.value)}>{state.products.map((item) => <DropdownOption key={item.id} value={item.id}>{item.name}</DropdownOption>)}</Dropdown>
    <Input type="number" min="0.001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} aria-label="Cantidad" className="h-8 w-20 text-right" required />
    <div className="w-44"><SuggestInput value={customer} onValueChange={(value) => setCustomer(value)} suggestions={suggestions} placeholder="Cliente (opcional)" aria-label="Cliente" /></div>
    <Button type="submit" size="sm" disabled={busy}>{busy ? "Guardando…" : "Agregar"}</Button>
    <span className="text-[11px] text-muted-foreground">Al precio del canal; para varios productos o entrega con dirección usa «Registrar venta».</span>
  </form>;
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
        <Input aria-label="Precio por unidad" type="number" min="0" step="1" value={line.price} placeholder="De lista" onChange={(event) => update(line.key, { price: event.target.value })} />
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

export function ChannelDialog({ channel, demo, onClose, onSaved }: { channel: SalesChannel | null; demo: boolean; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = React.useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const number = (name: string) => Number(data.get(name) || 0);
    setBusy(true);
    try {
      await businessAction({ action: "save-channel", channel: {
        id: channel?.id, name: String(data.get("name") ?? "").trim(), deliveryMethod: String(data.get("deliveryMethod") ?? "").trim(),
        commissionPercent: number("commission"), feePerOrder: number("fee"), deliveryCostPerOrder: number("delivery"),
        unitsPerOrder: number("units") || 1, priceAdjustmentPercent: number("adjustment"),
      } }, demo);
      notifySaved(channel ? "Canal actualizado" : "Canal creado");
      onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar"); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>{channel ? `Editar ${channel.name}` : "Nuevo canal de venta"}</DialogTitle><DialogDescription>Un canal es una forma de vender: el local, una feria, Instagram, una plataforma o un mayorista.</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={submit}><FieldGroup>
      <Field><FieldLabel htmlFor="channel-name">Nombre</FieldLabel><Input id="channel-name" name="name" required minLength={2} defaultValue={channel?.name} placeholder="Ej. Instagram" /></Field>
      <Field><FieldLabel htmlFor="channel-delivery">Cómo llega al cliente</FieldLabel><Input id="channel-delivery" name="deliveryMethod" defaultValue={channel?.deliveryMethod} placeholder="Ej. Moto propia, correo, retiro" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="channel-commission">Comisión (%)</FieldLabel><Input id="channel-commission" name="commission" type="number" min="0" max="100" step="0.01" defaultValue={channel ? channel.commissionBps / 100 : 0} /><FieldDescription>Lo que se queda la plataforma o la tarjeta.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="channel-fee">Cargo fijo por venta</FieldLabel><Input id="channel-fee" name="fee" type="number" min="0" step="1" defaultValue={channel?.feePerOrderMinor ?? 0} /></Field>
        <Field><FieldLabel htmlFor="channel-delivery-cost">Te cuesta entregar un pedido</FieldLabel><Input id="channel-delivery-cost" name="delivery" type="number" min="0" step="1" defaultValue={channel?.deliveryCostPerOrderMinor ?? 0} /><FieldDescription>Combustible, correo o repartidor.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="channel-units">Unidades por pedido</FieldLabel><Input id="channel-units" name="units" type="number" min="0.001" step="0.001" defaultValue={channel ? channel.unitsPerOrderMilli / 1000 : 1} /><FieldDescription>En promedio; reparte el envío entre las unidades.</FieldDescription></Field>
      </div>
      <Field><FieldLabel htmlFor="channel-adjustment">Precio frente al de lista (%)</FieldLabel><Input id="channel-adjustment" name="adjustment" type="number" min="-90" max="100" step="0.5" defaultValue={channel ? channel.priceAdjustmentBps / 100 : 0} /><FieldDescription>0 si cobras el precio de lista; -30 si al mayorista le vendes 30 % más barato.</FieldDescription></Field>
    </FieldGroup>
    <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar canal"}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}

type Line = { key: number; productId: string; quantity: string; price: string };

function SaleDialog({ directory, state, channels, demo, month, onClose, onSaved }: { directory: CustomerDirectory; state: DomainState; channels: SalesChannel[]; demo: boolean; month: string; onClose: () => void; onSaved: () => void }) {
  const [customer, setCustomer] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [recipient, setRecipient] = React.useState("");
  const [contact, setContact] = React.useState("");
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
        <Field><FieldLabel htmlFor="sale-date">Fecha</FieldLabel><Input id="sale-date" name="date" type="date" required defaultValue={defaultDate} /></Field>
        <Field><FieldLabel htmlFor="sale-channel">Canal</FieldLabel><Dropdown id="sale-channel" className="w-full" value={channelId} onChange={(event) => setChannelId(event.target.value)}>{channels.map((item) => <DropdownOption key={item.id} value={item.id}>{item.name}</DropdownOption>)}<DropdownOption value={DIRECT_CHANNEL.id}>{DIRECT_CHANNEL.name}</DropdownOption></Dropdown></Field>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Productos</span>
        {lines.map((line) => {
          const product = state.products.find((item) => item.id === line.productId);
          const listPrice = product ? channelPrice(product, channel) : null;
          return <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_6rem_8rem_auto] items-center gap-2">
            <Dropdown aria-label="Producto" className="w-full" value={line.productId} onChange={(event) => update(line.key, { productId: event.target.value })}>{state.products.map((item) => <DropdownOption key={item.id} value={item.id}>{item.name}</DropdownOption>)}</Dropdown>
            <Input aria-label="Cantidad" type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(event) => update(line.key, { quantity: event.target.value })} />
            <Input aria-label="Precio por unidad" type="number" min="0" step="1" value={line.price} placeholder={listPrice === null ? "Precio" : money(listPrice)} onChange={(event) => update(line.key, { price: event.target.value })} />
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Quitar producto" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}><AnimatedIcon name="close" /></Button>
          </div>;
        })}
        <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setLines((current) => [...current, { key: Date.now(), productId: state.products[0]?.id ?? "", quantity: "1", price: "" }])}><AnimatedIcon name="plus" data-icon="inline-start" />Otro producto</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="sale-delivery">Costo de entrega</FieldLabel><Input id="sale-delivery" name="delivery" type="number" min="0" step="1" placeholder={money(channel.deliveryCostPerOrderMinor)} /><FieldDescription>Déjalo vacío para usar el habitual del canal.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="sale-customer">Cliente</FieldLabel><SuggestInput id="sale-customer" value={customer} placeholder="Opcional" suggestions={directory.customers.map((item) => ({ value: item.name, hint: item.address || undefined }))} onValueChange={(value, picked) => { setCustomer(value); if (picked) pickCustomer(value); }} /></Field>
      </div>
      {delivers ? <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Entrega</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="sale-delivery-date">Fecha de entrega</FieldLabel><Input id="sale-delivery-date" name="deliveryDate" type="date" defaultValue={defaultDate} /><FieldDescription>Si ya pasó, queda como entregada.</FieldDescription></Field>
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
