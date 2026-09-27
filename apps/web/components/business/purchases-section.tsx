"use client";

import * as React from "react";
import { toast } from "sonner";
import { AREA_LABELS, PURCHASE_KIND_HINTS, PURCHASE_KIND_LABELS, type Purchase, type PurchaseKind } from "@/lib/business";
import type { CostArea, DomainState } from "@/lib/domain";
import { AnimatedIcon } from "@/components/animated-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";
import { MonthPicker, ReceiptLink, SectionHeader, Stat, Tip, businessAction, notifySaved, todayFor, todayIso, uploadDocument, useBusinessView, useMoney } from "./business-ui";
import { EditableDate, EditableNumber, EditableSuggest, EditableText, SortableHead, TableToolbar, downloadCsv, matches, monthName, sheetCell, sheetHead, usePersistentState, type SortState } from "./data-table";
import { RecordHistory } from "./record-history";
import { SuggestInput, type Suggestion } from "@/components/ui/suggest-input";
import { useIsMobile } from "@/hooks/use-mobile";
import { relativeDay } from "./delivery-status";

type PurchasePatch = Partial<{ purchasedOn: string; description: string; supplier: string; amount: number; area: CostArea; usefulLifeMonths: number }>;

/** The change that puts a purchase back as it was before an edit. */
function inversePurchasePatch(purchase: Purchase, patch: PurchasePatch): PurchasePatch {
  const back: PurchasePatch = {};
  if (patch.purchasedOn !== undefined) back.purchasedOn = purchase.purchasedOn;
  if (patch.description !== undefined) back.description = purchase.description;
  if (patch.supplier !== undefined) back.supplier = purchase.supplier;
  if (patch.amount !== undefined) back.amount = purchase.amountMinor;
  if (patch.area !== undefined) back.area = purchase.area;
  if (patch.usefulLifeMonths !== undefined && purchase.usefulLifeMonths) back.usefulLifeMonths = purchase.usefulLifeMonths;
  return back;
}

const KINDS: PurchaseKind[] = ["material", "expense", "fixed_payment", "investment"];
const AREAS: CostArea[] = ["production", "delivery", "sales", "admin"];

export function PurchasesSection({ state, demo, month, onMonthChange, onOpenCozte, onDataChanged }: { state: DomainState; demo: boolean; month: string; onMonthChange: (month: string) => void; onOpenCozte: () => void; onDataChanged: () => Promise<void> }) {
  const { view, loading, reload } = useBusinessView(month, demo, state);
  const money = useMoney(state.organization.currency);
  const [open, setOpen] = React.useState(false);
  const purchases = view?.purchases ?? [];
  const byKind = (kind: PurchaseKind) => purchases.filter((item) => item.kind === kind).reduce((sum, item) => sum + item.amountMinor, 0);

  async function archive(id: string) {
    try { await businessAction({ action: "archive", kind: "purchase", id }, demo); notifySaved("Compra anulada"); reload(); await onDataChanged().catch(() => {}); }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo anular"); }
  }
  async function update(purchase: Purchase, patch: PurchasePatch, message = "Compra corregida", undoable = true) {
    try {
      await businessAction({ action: "update-purchase", id: purchase.id, patch }, demo);
      notifySaved(message, undoable ? () => void update(purchase, inversePurchasePatch(purchase, patch), "Cambio deshecho", false) : undefined);
      reload(); await onDataChanged().catch(() => {});
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar el cambio"); }
  }

  return <>
    <SectionHeader eyebrow="Día a día" title="Compras" description="Todo lo que compras, con su comprobante. Mándale a Cozte la foto del ticket o factura y la registra y clasifica por ti.">
      <Button variant="outline" onClick={onOpenCozte}><AnimatedIcon name="assistant" data-icon="inline-start" />Enviar ticket a Cozte</Button>
      <Button onClick={() => setOpen(true)}><AnimatedIcon name="plus" data-icon="inline-start" />Registrar compra</Button>
    </SectionHeader>
    <div className="flex justify-end"><MonthPicker month={month} today={todayFor(demo)} onChange={onMonthChange} /></div>
    {!view ? <TextShimmer className="text-sm">Cargando compras…</TextShimmer> : <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Total comprado" value={money(purchases.reduce((sum, item) => sum + item.amountMinor, 0))} note={`${purchases.length} compra${purchases.length === 1 ? "" : "s"}`} />
        {KINDS.map((kind) => <Stat key={kind} label={PURCHASE_KIND_LABELS[kind]} value={money(byKind(kind))} />)}
      </div>
      <Card>
        <CardHeader><CardTitle>Compras del mes</CardTitle><CardDescription>La más reciente primero. <span className="hidden md:inline">Haz clic en una celda para corregirla;</span><span className="md:hidden">Toca «Editar» para corregirla;</span> el tipo define si es costo del producto, gasto del mes o una inversión.</CardDescription></CardHeader>
        <CardContent>{purchases.length ? <PurchasesTable purchases={purchases} month={month} today={todayFor(demo)} demo={demo} money={money} onUpdate={update} onArchive={(purchase) => void archive(purchase.id)} />
          : <Empty className="py-6"><EmptyHeader><EmptyTitle>No hay compras en {monthName(month)}</EmptyTitle><EmptyDescription>Regístralas acá o mándale a Cozte la foto del ticket.</EmptyDescription></EmptyHeader></Empty>}</CardContent>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        {KINDS.map((kind) => <Tip key={kind} title={PURCHASE_KIND_LABELS[kind]}>{PURCHASE_KIND_HINTS[kind]}</Tip>)}
      </div>
    </div>}
    {open ? <PurchaseDialog state={state} demo={demo} month={month} onClose={() => setOpen(false)} onSaved={async () => { setOpen(false); reload(); await onDataChanged().catch(() => {}); }} /> : null}
  </>;
}

type SortKey = "date" | "amount" | "description";

/** The month's purchases as an editable sheet with search and filters, most recent first. */
function PurchasesTable({ purchases, month, today, demo, money, onUpdate, onArchive }: { purchases: Purchase[]; month: string; today: string; demo: boolean; money: (value: number) => string; onUpdate: (purchase: Purchase, patch: PurchasePatch, message?: string) => Promise<void>; onArchive: (purchase: Purchase) => void }) {
  const [search, setSearch] = React.useState("");
  const [kind, setKind] = usePersistentState<string>("compras:tipo", "all");
  const [area, setArea] = usePersistentState<string>("compras:area", "all");
  const [sort, setSort] = React.useState<SortState<SortKey>>(null);
  const suppliers = React.useMemo(() => [...new Set(purchases.map((item) => item.supplier).filter(Boolean))].map((value) => ({ value })), [purchases]);
  const rows = React.useMemo(() => {
    const filtered = purchases.filter((item) => (kind === "all" || item.kind === kind) && (area === "all" || item.area === area) && matches(search, [item.description, item.supplier, item.materialName, item.expenseName, PURCHASE_KIND_LABELS[item.kind], AREA_LABELS[item.area]]));
    const direction = sort?.direction === "asc" ? 1 : -1;
    const value = (item: Purchase): string | number => !sort || sort.key === "date" ? item.purchasedOn : sort.key === "amount" ? item.amountMinor : item.description.toLowerCase();
    return [...filtered].sort((x, y) => { const a = value(x), b = value(y); return (a < b ? -1 : a > b ? 1 : 0) * (sort ? direction : -1); });
  }, [purchases, kind, area, search, sort]);
  const locked = (item: Purchase) => item.kind === "investment" && Boolean(item.includeInUnitCost);
  const [history, setHistory] = React.useState<Purchase | null>(null);
  const isMobile = useIsMobile();
  const exportRows = () => downloadCsv(`compras-${month}`, ["Fecha", "Qué se compró", "Proveedor", "Tipo", "Área", "Monto", "Vida útil (meses)", "Insumo", "Cantidad", "Gasto que paga", "Registrada por"],
    rows.map((item) => [item.purchasedOn, item.description, item.supplier, PURCHASE_KIND_LABELS[item.kind], AREA_LABELS[item.area], item.amountMinor, item.usefulLifeMonths ?? null, item.materialName ?? "", item.quantityMilli ? item.quantityMilli / 1000 : null, item.expenseName ?? "", item.source === "cozte" ? "Cozte" : "Persona"]));
  return <div className="flex flex-col gap-3">
    <TableToolbar search={search} onSearch={setSearch} placeholder="Buscar compra, proveedor o insumo" shown={rows.length} total={purchases.length} filters={[
      { id: "kind", label: "Tipo", value: kind, onChange: setKind, options: [{ value: "all", label: "Todos los tipos" }, ...KINDS.map((item) => ({ value: item, label: PURCHASE_KIND_LABELS[item], hint: PURCHASE_KIND_HINTS[item] }))] },
      { id: "area", label: "Área", value: area, onChange: setArea, options: [{ value: "all", label: "Todas las áreas" }, ...AREAS.map((item) => ({ value: item, label: AREA_LABELS[item] }))] },
    ]}><Button type="button" size="sm" variant="outline" className="h-8" onClick={exportRows} title="Descarga lo que ves (con los filtros aplicados)"><AnimatedIcon name="cloud" data-icon="inline-start" size={14} />Descargar Excel</Button></TableToolbar>
    {history ? <RecordHistory kind="purchase" id={history.id} title={history.description} demo={demo} onClose={() => setHistory(null)} /> : null}
    {isMobile ? <PurchaseCards rows={rows} today={today} demo={demo} money={money} suppliers={suppliers} locked={locked} onUpdate={onUpdate} onArchive={onArchive} onHistory={setHistory} /> : <div className="max-h-[min(70vh,48rem)] overflow-auto rounded-lg border">
      <Table className="border-separate border-spacing-0">
        <TableHeader className="sticky top-0 z-20 bg-card"><TableRow className="hover:bg-transparent">
          <SortableHead column="date" label="Fecha" sort={sort} onSort={setSort} className="sticky left-0 z-30 min-w-48 bg-muted" />
          <SortableHead column="description" label="Qué se compró" sort={sort} onSort={setSort} className="min-w-56" defaultDirection="asc" />
          <TableHead className={cn(sheetHead, "min-w-40")}>Proveedor</TableHead>
          <TableHead className={cn(sheetHead, "min-w-32")}>Tipo</TableHead>
          <TableHead className={cn(sheetHead, "min-w-40")}>Área</TableHead>
          <SortableHead column="amount" label="Monto" sort={sort} onSort={setSort} className="min-w-32 text-right" />
          <TableHead className={cn(sheetHead, "min-w-28 text-right")} title="Solo inversiones: en cuántos meses se reparte">Vida útil (meses)</TableHead>
          <TableHead className={cn(sheetHead, "min-w-56")}>Detalle</TableHead>
          <TableHead className={cn(sheetHead, "w-24")} />
        </TableRow></TableHeader>
        <TableBody>{rows.map((item) => <TableRow key={item.id} className="hover:bg-muted/30">
          <TableCell className={cn(sheetCell, "sticky left-0 z-10 bg-card")}><div className="flex items-center">
            <EditableDate today={today} value={item.purchasedOn} label={`Fecha de ${item.description}`} disabled={locked(item)} onCommit={(purchasedOn) => void onUpdate(item, { purchasedOn })} className="w-36 shrink-0" />
            <span className="pr-3 text-xs whitespace-nowrap text-muted-foreground">{relativeDay(item.purchasedOn, today)}</span>
          </div></TableCell>
          <TableCell className={sheetCell}><EditableText value={item.description} label="Qué se compró" onCommit={(description) => { if (description.length >= 2) void onUpdate(item, { description }); }} /></TableCell>
          <TableCell className={sheetCell}><EditableSuggest suggestions={suppliers} value={item.supplier} label="Proveedor" placeholder="—" onCommit={(supplier) => void onUpdate(item, { supplier })} /></TableCell>
          <TableCell className={cn(sheetCell, "px-3")}><Badge variant="outline" title={PURCHASE_KIND_HINTS[item.kind]}>{PURCHASE_KIND_LABELS[item.kind]}</Badge></TableCell>
          <TableCell className={sheetCell}><Dropdown variant="cell" aria-label="Área" value={item.area} disabled={item.kind === "material" || locked(item)} onChange={(event) => { if (event.target.value !== item.area) void onUpdate(item, { area: event.target.value as CostArea }); }}>
            {AREAS.map((value) => <DropdownOption key={value} value={value}>{AREA_LABELS[value]}</DropdownOption>)}
          </Dropdown></TableCell>
          <TableCell className={sheetCell} title={locked(item) ? "Se suma al costo de cada producto: quítala del costo en Gastos para cambiarla" : undefined}><EditableNumber value={item.amountMinor} label="Monto" disabled={locked(item)} onCommit={(amount) => void onUpdate(item, { amount })} /></TableCell>
          <TableCell className={sheetCell}>{item.kind === "investment" ? <EditableNumber value={item.usefulLifeMonths ?? null} label="Vida útil en meses" min={1} step="1" disabled={locked(item)} onCommit={(usefulLifeMonths) => void onUpdate(item, { usefulLifeMonths: Math.round(usefulLifeMonths) })} /> : <span className="block px-3 text-right text-xs text-muted-foreground">—</span>}</TableCell>
          <TableCell className={cn(sheetCell, "px-3 text-xs text-muted-foreground")}>{[
            item.kind === "material" && item.materialName ? `${item.materialName}${item.quantityMilli ? ` · ${item.quantityMilli / 1000} u.` : ""}` : null,
            item.kind === "fixed_payment" && item.expenseName ? `Paga: ${item.expenseName}` : null,
            item.kind === "investment" && item.usefulLifeMonths ? `${money(item.amountMinor / item.usefulLifeMonths)} por mes${item.includeInUnitCost ? ", sumado al costo de cada producto" : ""}` : null,
            item.source === "cozte" ? "Registrada por Cozte" : null,
          ].filter(Boolean).join(" · ") || "—"}</TableCell>
          <TableCell className={cn(sheetCell, "px-1")}><div className="flex items-center justify-end gap-0.5">
            <ReceiptLink documentId={item.documentId} demo={demo} label="Ticket" />
            <Button size="icon-sm" variant="ghost" aria-label={`Historial de ${item.description}`} title="Historial" onClick={() => setHistory(item)}><AnimatedIcon name="history" size={14} /></Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Anular ${item.description}`} title="Anular compra" onClick={() => onArchive(item)}><AnimatedIcon name="delete" size={14} /></Button>
          </div></TableCell>
        </TableRow>)}</TableBody>
        <TableFooter><TableRow>
          <TableCell colSpan={5} className="px-3 text-sm">{rows.length === purchases.length ? `Total de ${monthName(month)}` : `Lo filtrado de ${monthName(month)}`} · {rows.length} compra{rows.length === 1 ? "" : "s"}</TableCell>
          <TableCell className="px-3 text-right tabular-nums">{money(rows.reduce((sum, item) => sum + item.amountMinor, 0))}</TableCell>
          <TableCell colSpan={3} />
        </TableRow></TableFooter>
      </Table>
    </div>}
    <p className="text-xs text-muted-foreground">Corregir el monto de una compra de insumo no vuelve a cambiar el precio del insumo; ese precio se ajusta en Costos de producción.</p>
  </div>;
}

/** Purchases as cards for a phone, with an edit dialog instead of the wide sheet. */
function PurchaseCards({ rows, today, demo, money, suppliers, locked, onUpdate, onArchive, onHistory }: {
  rows: Purchase[]; today: string; demo: boolean; money: (value: number) => string; suppliers: Suggestion[]; locked: (purchase: Purchase) => boolean;
  onUpdate: (purchase: Purchase, patch: PurchasePatch, message?: string) => Promise<void>; onArchive: (purchase: Purchase) => void; onHistory: (purchase: Purchase) => void;
}) {
  const [editing, setEditing] = React.useState<Purchase | null>(null);
  if (!rows.length) return <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No hay compras con estos filtros.</p>;
  return <>
    <ul className="flex flex-col gap-3">{rows.map((item) => <li key={item.id} className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{relativeDay(item.purchasedOn, today)} · {item.purchasedOn.slice(8, 10)}/{item.purchasedOn.slice(5, 7)}</p>
          <p className="truncate text-xs text-muted-foreground">{item.supplier || "Sin proveedor"}</p>
        </div>
        <p className="shrink-0 text-base font-semibold tabular-nums">{money(item.amountMinor)}</p>
      </div>
      <p className="font-medium">{item.description}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" title={PURCHASE_KIND_HINTS[item.kind]}>{PURCHASE_KIND_LABELS[item.kind]}</Badge>
        <Badge variant="secondary">{AREA_LABELS[item.area]}</Badge>
        {item.kind === "investment" && item.usefulLifeMonths ? <span className="text-xs text-muted-foreground">{money(item.amountMinor / item.usefulLifeMonths)} por mes en {item.usefulLifeMonths} meses</span> : null}
        {item.kind === "material" && item.materialName ? <span className="text-xs text-muted-foreground">{item.materialName}{item.quantityMilli ? ` · ${item.quantityMilli / 1000} u.` : ""}</span> : null}
        {item.kind === "fixed_payment" && item.expenseName ? <span className="text-xs text-muted-foreground">Paga: {item.expenseName}</span> : null}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button type="button" variant="outline" className="h-10 flex-1" onClick={() => setEditing(item)}><AnimatedIcon name="edit" data-icon="inline-start" />Editar</Button>
        {item.documentId ? <ReceiptLink documentId={item.documentId} demo={demo} label="Ticket" /> : null}
        <Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Historial de ${item.description}`} onClick={() => onHistory(item)}><AnimatedIcon name="history" /></Button>
        <Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Anular ${item.description}`} onClick={() => onArchive(item)}><AnimatedIcon name="delete" /></Button>
      </div>
    </li>)}</ul>
    {editing ? <PurchaseEditDialog purchase={editing} suppliers={suppliers} locked={locked(editing)} onClose={() => setEditing(null)}
      onSave={async (patch) => { if (Object.keys(patch).length) await onUpdate(editing, patch); setEditing(null); }} /> : null}
  </>;
}

function PurchaseEditDialog({ purchase, suppliers, locked, onClose, onSave }: { purchase: Purchase; suppliers: Suggestion[]; locked: boolean; onClose: () => void; onSave: (patch: PurchasePatch) => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const [supplier, setSupplier] = React.useState(purchase.supplier);
  const [area, setArea] = React.useState<CostArea>(purchase.area);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const patch: PurchasePatch = {};
    const purchasedOn = String(data.get("purchasedOn") ?? "");
    if (!locked && purchasedOn && purchasedOn !== purchase.purchasedOn) patch.purchasedOn = purchasedOn;
    const description = String(data.get("description") ?? "").trim();
    if (description.length >= 2 && description !== purchase.description) patch.description = description;
    if (supplier.trim() !== purchase.supplier) patch.supplier = supplier.trim();
    if (!locked && purchase.kind !== "material" && area !== purchase.area) patch.area = area;
    const amount = Number(data.get("amount"));
    if (!locked && data.get("amount") !== null && Number.isFinite(amount) && amount >= 0 && amount !== purchase.amountMinor) patch.amount = amount;
    const life = Math.round(Number(data.get("usefulLifeMonths")));
    if (!locked && purchase.kind === "investment" && life >= 1 && life !== purchase.usefulLifeMonths) patch.usefulLifeMonths = life;
    setBusy(true);
    try { await onSave(patch); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>Editar compra</DialogTitle><DialogDescription>{PURCHASE_KIND_LABELS[purchase.kind]}.{locked ? " Se suma al costo de cada producto: para cambiar monto, fecha, área o vida útil, primero quítala del costo en Gastos de la empresa." : ""}</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={submit}><FieldGroup>
      <Field><FieldLabel htmlFor="edit-purchased-on">Fecha</FieldLabel><DatePicker id="edit-purchased-on" name="purchasedOn" defaultValue={purchase.purchasedOn} disabled={locked} /></Field>
      <Field><FieldLabel htmlFor="edit-purchase-description">Qué se compró</FieldLabel><Input id="edit-purchase-description" name="description" required minLength={2} defaultValue={purchase.description} /></Field>
      <Field><FieldLabel htmlFor="edit-purchase-supplier">Proveedor</FieldLabel><SuggestInput id="edit-purchase-supplier" value={supplier} suggestions={suppliers} onValueChange={(value) => setSupplier(value)} placeholder="Sin proveedor" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field><FieldLabel htmlFor="edit-purchase-amount">Monto</FieldLabel><Input id="edit-purchase-amount" name="amount" type="number" min="0" step="any" inputMode="decimal" defaultValue={purchase.amountMinor} disabled={locked} /></Field>
        <Field><FieldLabel htmlFor="edit-purchase-area">Área</FieldLabel><Dropdown id="edit-purchase-area" className="w-full" value={area} disabled={locked || purchase.kind === "material"} onChange={(event) => setArea(event.target.value as CostArea)}>{AREAS.map((value) => <DropdownOption key={value} value={value}>{AREA_LABELS[value]}</DropdownOption>)}</Dropdown></Field>
      </div>
      {purchase.kind === "investment" ? <Field><FieldLabel htmlFor="edit-purchase-life">Vida útil (meses)</FieldLabel><Input id="edit-purchase-life" name="usefulLifeMonths" type="number" min="1" step="1" inputMode="numeric" defaultValue={purchase.usefulLifeMonths ?? ""} disabled={locked} /></Field> : null}
    </FieldGroup>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

function PurchaseDialog({ state, demo, month, onClose, onSaved }: { state: DomainState; demo: boolean; month: string; onClose: () => void; onSaved: () => void }) {
  const currency = state.organization.currency;
  const idempotencyKey = React.useMemo(() => crypto.randomUUID(), []);
  const [kind, setKind] = React.useState<PurchaseKind>("expense");
  const [area, setArea] = React.useState<CostArea>("admin");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const activeExpenses = state.expenses.filter((item) => item.period === state.activePeriod);
  const defaultDate = todayIso().startsWith(month) ? todayIso() : `${month}-01`;
  const areaLocked = kind === "material" || kind === "fixed_payment";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    setBusy(true);
    try {
      const documentId = file && !demo ? await uploadDocument(file) : undefined;
      await businessAction({ action: "record-purchase", idempotencyKey, purchase: {
        purchasedOn: text("date"), description: text("description"), supplier: text("supplier"), amount: Number(text("amount")), kind,
        ...(areaLocked ? {} : { area }),
        ...(kind === "material" ? { materialId: text("material"), ...(text("quantity") ? { quantity: Number(text("quantity")) } : {}), updateMaterialPrice: data.get("updatePrice") === "on" } : {}),
        ...(kind === "fixed_payment" ? { expenseId: text("expense") } : {}),
        ...(kind === "investment" ? { usefulLifeMonths: Number(text("life")), ...(area === "production" ? { includeInUnitCost: data.get("includeInUnitCost") === "on" } : {}) } : {}),
        documentId,
      } }, demo);
      toast.success("Compra registrada");
      onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo registrar"); }
    finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={(value) => { if (!value) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>Registrar compra</DialogTitle><DialogDescription>Montos en {currency}. Si tienes el ticket, adjúntalo: queda guardado con la compra.</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={submit}><FieldGroup>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="purchase-date">Fecha</FieldLabel><DatePicker id="purchase-date" name="date" required defaultValue={defaultDate} today={defaultDate} /></Field>
        <Field><FieldLabel htmlFor="purchase-amount">Total pagado</FieldLabel><Input id="purchase-amount" name="amount" type="number" min="0" step="0.01" required /></Field>
      </div>
      <Field><FieldLabel htmlFor="purchase-description">Qué compraste</FieldLabel><Input id="purchase-description" name="description" required minLength={2} placeholder="Ej. Cinta de embalaje" /></Field>
      <Field><FieldLabel htmlFor="purchase-supplier">Dónde o a quién</FieldLabel><Input id="purchase-supplier" name="supplier" placeholder="Opcional" /></Field>
      <Field><FieldLabel htmlFor="purchase-kind">¿Qué tipo de compra es?</FieldLabel>
        <Dropdown id="purchase-kind" className="w-full" value={kind} onChange={(event) => setKind(event.target.value as PurchaseKind)}>{KINDS.map((item) => <DropdownOption key={item} value={item} disabled={(item === "material" && !state.materials.length) || (item === "fixed_payment" && !activeExpenses.length)}>{PURCHASE_KIND_LABELS[item]}</DropdownOption>)}</Dropdown>
        <FieldDescription>{PURCHASE_KIND_HINTS[kind]}</FieldDescription>
      </Field>
      {kind === "material" ? <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="purchase-material">Insumo</FieldLabel><Dropdown id="purchase-material" name="material" className="w-full">{state.materials.map((item) => <DropdownOption key={item.id} value={item.id}>{item.name} ({item.purchaseUnit})</DropdownOption>)}</Dropdown></Field>
        <Field><FieldLabel htmlFor="purchase-quantity">Cantidad comprada</FieldLabel><Input id="purchase-quantity" name="quantity" type="number" min="0.001" step="0.001" placeholder="En su unidad de compra" /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="updatePrice" defaultChecked className="size-4" />Actualizar el precio del insumo con esta compra</label>
      </div> : null}
      {kind === "fixed_payment" ? <Field><FieldLabel htmlFor="purchase-expense">Gasto mensual que pagaste</FieldLabel><Dropdown id="purchase-expense" name="expense" className="w-full">{activeExpenses.map((item) => <DropdownOption key={item.id} value={item.id}>{item.name} ({AREA_LABELS[item.area ?? "production"]})</DropdownOption>)}</Dropdown></Field> : null}
      {kind === "investment" ? <Field><FieldLabel htmlFor="purchase-life">¿Cuántos meses la vas a usar?</FieldLabel><Input id="purchase-life" name="life" type="number" min="1" max="600" step="1" required defaultValue={36} /><FieldDescription>Como referencia: 36 meses para tecnología, 60 para máquinas y herramientas.</FieldDescription></Field> : null}
      {!areaLocked ? <Field><FieldLabel htmlFor="purchase-area">Área</FieldLabel><Dropdown id="purchase-area" className="w-full" value={area} onChange={(event) => setArea(event.target.value as CostArea)}>{AREAS.map((item) => <DropdownOption key={item} value={item}>{AREA_LABELS[item]}</DropdownOption>)}</Dropdown></Field> : null}
      {kind === "investment" && area === "production" ? <Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="includeInUnitCost" className="size-4" />Sumar su parte mensual al costo de cada producto</label>
        <FieldDescription>Conviene si se usa para producir y habrá que reemplazarla: así tu precio paga su desgaste. Si no, cuenta solo en el resultado del mes. Puedes cambiarlo después en Gastos de la empresa.</FieldDescription>
      </Field> : null}
      <Field><FieldLabel htmlFor="purchase-receipt">Comprobante</FieldLabel><Input id="purchase-receipt" type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><FieldDescription>Foto o PDF de hasta 4 MB. Opcional.</FieldDescription></Field>
    </FieldGroup>
    <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Registrar compra"}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
