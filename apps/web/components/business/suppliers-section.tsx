"use client";

import * as React from "react";
import { toast } from "sonner";
import { Phone } from "lucide-react";
import { PURCHASE_KIND_LABELS } from "@/lib/business";
import type { DomainState } from "@/lib/domain";
import { SUPPLIER_KINDS, SUPPLIER_KIND_HINTS, SUPPLIER_KIND_LABELS, supplierInsights, type MaterialPrice, type SupplierKind, type SupplierPurchase, type SupplierRow } from "@/lib/suppliers";
import { demoSupplierDetail, demoSupplierList } from "@/lib/demo-store";
import { AnimatedIcon } from "@/components/animated-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { ChartCard, DATA_COLORS, MonthBars, Sparkline, Treemap, useCompactMoney } from "@/components/analysis/charts";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { SectionHeader, Stat, businessAction, notifySaved, todayFor, useDemoVersion, useMoney } from "./business-ui";
import { SortableHead, TableToolbar, downloadCsv, matches, sheetCell, sheetHead, usePersistentState, type SortState } from "./data-table";
import { relativeDay } from "./delivery-status";

/**
 * Suppliers: one record per supplier with what the business buys from each and how their prices moved. The list shows
 * where the money goes and which supplies got more expensive; each record has its prices, purchases and contact.
 */

type ListData = { suppliers: SupplierRow[]; today: string };
type Detail = { supplier: SupplierRow; months: { month: string; amount: number; purchases: number }[]; purchases: SupplierPurchase[]; today: string };

const KIND_COLOR: Record<SupplierKind, string> = { materials: DATA_COLORS[0], logistics: DATA_COLORS[1], services: DATA_COLORS[3], other: DATA_COLORS[4] };
const KIND_TONE: Record<SupplierKind, string> = {
  materials: "border-[color-mix(in_oklab,var(--data-1)_45%,transparent)] bg-[color-mix(in_oklab,var(--data-1)_10%,transparent)]",
  logistics: "border-[color-mix(in_oklab,var(--data-2)_45%,transparent)] bg-[color-mix(in_oklab,var(--data-2)_10%,transparent)]",
  services: "border-[color-mix(in_oklab,var(--data-4)_45%,transparent)] bg-[color-mix(in_oklab,var(--data-4)_10%,transparent)]",
  other: "border-border bg-muted",
};

function KindBadge({ kind }: { kind: SupplierKind }) {
  return <Badge variant="outline" className={cn("whitespace-nowrap text-foreground", KIND_TONE[kind])} title={SUPPLIER_KIND_HINTS[kind]}>{SUPPLIER_KIND_LABELS[kind]}</Badge>;
}

/** A price change as a chip: rises in the warm tone, drops in green, with its percent. */
function ChangeChip({ change }: { change: number | null }) {
  if (change === null) return <span className="text-xs text-muted-foreground">—</span>;
  const percent = Math.round(change * 100);
  if (!percent) return <span className="text-xs text-muted-foreground">igual</span>;
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums", percent > 0 ? "bg-[color-mix(in_oklab,var(--data-6)_14%,transparent)] text-[var(--data-6)]" : "bg-[color-mix(in_oklab,var(--data-1)_14%,transparent)] text-[var(--data-1)]")}>
    {percent > 0 ? "▲" : "▼"} {Math.abs(percent)} %
  </span>;
}

/** The biggest move among a supplier's prices. */
const biggestMove = (row: SupplierRow) => row.prices.filter((price) => price.change !== null).sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!))[0] ?? null;

export function useSupplierList(demo: boolean, refreshKey: number): { data: ListData | null; reload: () => void } {
  const demoChanges = useDemoVersion(demo);
  const [loaded, setLoaded] = React.useState<ListData | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (demo) return;
    let active = true;
    fetch("/api/suppliers/list", { cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudieron cargar los proveedores"); return body as ListData; })
      .then((data) => { if (active) setLoaded(data); })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "No se pudieron cargar los proveedores"));
    return () => { active = false; };
  }, [demo, refreshKey, tick]);
  const demoData = React.useMemo(() => demo ? demoSupplierList() : null, [demo, demoChanges]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data: demoData ?? loaded, reload: () => setTick((value) => value + 1) };
}

export function SuppliersSection({ state, demo, onDataChanged, onOpenPurchases }: { state: DomainState; demo: boolean; onDataChanged?: () => void; onOpenPurchases?: () => void }) {
  const [refreshKey, setRefreshKey] = React.useState(0);
  const { data, reload } = useSupplierList(demo, refreshKey);
  const money = useMoney(state.organization.currency);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const refresh = () => { reload(); setRefreshKey((value) => value + 1); onDataChanged?.(); };
  const suppliers = data?.suppliers ?? [];
  const today = data?.today ?? todayFor(demo);
  const spent = suppliers.reduce((sum, row) => sum + row.stats.spent, 0);
  const active = suppliers.filter((row) => (row.stats.daysSinceLast ?? 999) <= 90).length;
  const rising = suppliers.flatMap((row) => row.prices).filter((price) => (price.change ?? 0) >= 0.05).length;
  const insights = React.useMemo(() => supplierInsights(suppliers, money), [suppliers, money]);

  return <>
    <SectionHeader eyebrow="Día a día" title="Proveedores" description="A quién le compras, qué te vende cada uno y cómo cambiaron sus precios. Se arman solos con tus compras y tus zonas de entrega; también puedes cargarlos acá.">
      <Button onClick={() => setCreating(true)}><AnimatedIcon name="plus" data-icon="inline-start" />Nuevo proveedor</Button>
    </SectionHeader>
    {!data ? <TextShimmer className="text-sm">Cargando proveedores…</TextShimmer> : <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Compraste en el año" value={money(spent)} note="Últimos 12 meses, a todos" />
        <Stat label="Compraste en los últimos 90 días" value={`${active} proveedor${active === 1 ? "" : "es"}`} note={`De ${suppliers.length} en total`} />
        <Stat label="Insumos que subieron" value={String(rising)} note="5 % o más desde la primera compra" tone={rising ? "negative" : undefined} />
        <Stat label="Envíos" value={String(suppliers.filter((row) => row.kind === "logistics").length)} note="Transportistas y correos" />
      </div>
      {suppliers.length ? <>
        <TopSuppliers rows={suppliers} money={money} currency={state.organization.currency} insights={insights} onOpen={setOpenId} />
        <PricesCard rows={suppliers} money={money} onOpen={setOpenId} />
        <SupplierTable rows={suppliers} today={today} money={money} onOpen={setOpenId} />
      </> : <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center">
        <p className="font-medium">Todavía no hay proveedores</p>
        <p className="max-w-md text-sm text-muted-foreground">Se crean solos cuando registras una compra con el nombre del proveedor o una zona de entrega con transportista. También puedes cargarlos acá.</p>
        <div className="flex gap-2"><Button variant="outline" onClick={() => setCreating(true)}>Cargar el primero</Button>{onOpenPurchases ? <Button variant="ghost" onClick={onOpenPurchases}>Ir a Compras</Button> : null}</div>
      </div>}
    </div>}
    {openId ? <SupplierSheet key={openId} id={openId} state={state} demo={demo} others={suppliers.filter((row) => row.id !== openId)} onClose={() => setOpenId(null)} onChanged={refresh} /> : null}
    {creating ? <NewSupplierDialog demo={demo} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); refresh(); setOpenId(id); }} /> : null}
  </>;
}

/** Where the money goes: a block per supplier, colored by kind, and what stands out. */
function TopSuppliers({ rows, money, currency, insights, onOpen }: { rows: SupplierRow[]; money: (value: number) => string; currency: string; insights: { tone: "good" | "bad" | "info"; text: string }[]; onOpen: (id: string) => void }) {
  const compact = useCompactMoney(currency);
  const buyers = rows.filter((row) => row.stats.spent > 0);
  const top = buyers.slice(0, 8);
  const rest = buyers.slice(8).reduce((sum, row) => sum + row.stats.spent, 0);
  const risingRow = rows.find((row) => (biggestMove(row)?.change ?? 0) >= 0.05);
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
    {top.length ? <ChartCard title="A quién le compras más" description="Cada bloque es un proveedor, del tamaño de lo que le compraste en el año; el color dice qué te vende."
      legend={<ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">{SUPPLIER_KINDS.filter((kind) => top.some((row) => row.kind === kind)).map((kind) => <li key={kind} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: KIND_COLOR[kind] }} aria-hidden="true" />{SUPPLIER_KIND_LABELS[kind]}</li>)}</ul>}
      table={{ columns: ["Proveedor", "Tipo", "Compraste", "Compras", "Última compra"], rows: buyers.map((row) => [row.name, SUPPLIER_KIND_LABELS[row.kind], money(row.stats.spent), row.stats.purchases, row.stats.lastOn ?? "—"]) }}>
      <Treemap items={[...top.map((row) => ({ key: row.id, label: row.name, value: row.stats.spent, color: KIND_COLOR[row.kind], detail: `${SUPPLIER_KIND_LABELS[row.kind]} · ${row.stats.purchases} compra${row.stats.purchases === 1 ? "" : "s"}` })), ...(rest ? [{ key: "rest", label: `Otros ${buyers.length - top.length}`, value: rest, color: "var(--data-muted)" }] : [])]} format={money} height={240} label="Proveedores por lo que les compraste" />
    </ChartCard> : null}
    <ChartCard title="Lo que conviene mirar" description="Calculado con tus compras." className={top.length ? undefined : "lg:col-span-2"}>
      <ul className="flex flex-col gap-2 text-sm">
        {insights.map((insight, index) => <li key={index} className="flex items-start gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5">
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", insight.tone === "bad" ? "bg-amber-500" : insight.tone === "good" ? "bg-emerald-500" : "bg-muted-foreground/60")} aria-hidden="true" />
          <span>{insight.text}</span>
        </li>)}
        {risingRow ? <li><button type="button" onClick={() => onOpen(risingRow.id)} className="w-full rounded-xl border border-dashed px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted">Ver los precios de {risingRow.name} →</button></li> : null}
        {!insights.length ? <li className="rounded-xl bg-muted/50 px-3 py-2.5 text-muted-foreground">Cuando registres compras de insumos con cantidad, acá vas a ver cómo cambian sus precios{top[0] ? ` (el que más te vende hoy es ${top[0].name}: ${compact(top[0].stats.spent)})` : ""}.</li> : null}
      </ul>
    </ChartCard>
  </div>;
}

/** Every supply with its price per purchase unit each time it was bought, as a small line, by supplier. */
function PricesCard({ rows, money, onOpen }: { rows: SupplierRow[]; money: (value: number) => string; onOpen: (id: string) => void }) {
  const items = rows.flatMap((row) => row.prices.map((price) => ({ supplier: row, price })))
    .sort((a, b) => Math.abs(b.price.change ?? 0) - Math.abs(a.price.change ?? 0) || b.price.lastOn.localeCompare(a.price.lastOn));
  if (!items.length) return null;
  return <ChartCard title="Cómo cambiaron los precios de tus insumos" description="Lo que pagaste por unidad de compra cada vez, con cada proveedor. Los que más cambiaron, primero."
    table={{ columns: ["Insumo", "Proveedor", "Primera compra", "Última compra", "Cambio", "Compras"], rows: items.map(({ supplier, price }) => [price.name, supplier.name, money(price.first), money(price.last), price.change === null ? "—" : `${Math.round(price.change * 100)} %`, price.points.length]) }}>
    <ul className="grid gap-x-6 gap-y-1 md:grid-cols-2">
      {items.slice(0, 12).map(({ supplier, price }) => <li key={`${supplier.id}-${price.materialId}`}>
        <button type="button" onClick={() => onOpen(supplier.id)} className="grid w-full grid-cols-[minmax(0,1fr)_6rem_auto] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/50">
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{price.name}</span><span className="block truncate text-xs text-muted-foreground">{supplier.name} · {money(price.last)}{price.unit ? ` por ${price.unit}` : ""}</span></span>
          <Sparkline values={price.points.map((point) => point.unitPrice)} focus={price.points.length - 1} color={(price.change ?? 0) > 0 ? "var(--data-6)" : "var(--data-1)"} height={32} label={`Precio de ${price.name} con ${supplier.name}`} />
          <ChangeChip change={price.change} />
        </button>
      </li>)}
    </ul>
  </ChartCard>;
}

type SortKey = "name" | "spent" | "last";

function SupplierTable({ rows, today, money, onOpen }: { rows: SupplierRow[]; today: string; money: (value: number) => string; onOpen: (id: string) => void }) {
  const [search, setSearch] = React.useState("");
  const [kind, setKind] = usePersistentState<string>("proveedores:tipo", "all");
  const [sort, setSort] = React.useState<SortState<SortKey>>(null);
  const isMobile = useIsMobile();
  const shown = React.useMemo(() => {
    const filtered = rows.filter((row) => (kind === "all" || row.kind === kind) && matches(search, [row.name, row.contactName, row.phone, row.email, row.notes, ...row.materials, ...row.zones]));
    if (!sort) return filtered;
    const direction = sort.direction === "asc" ? 1 : -1;
    const value = (row: SupplierRow): string | number => sort.key === "name" ? row.name.toLowerCase() : sort.key === "spent" ? row.stats.spent : row.stats.lastOn ?? "";
    return [...filtered].sort((a, b) => { const x = value(a), y = value(b); return (x < y ? -1 : x > y ? 1 : 0) * direction; });
  }, [rows, kind, search, sort]);
  const sells = (row: SupplierRow) => row.kind === "logistics" && row.zones.length ? `Zonas: ${row.zones.join(", ")}` : row.materials.join(", ");
  const exportRows = () => downloadCsv(`proveedores-${today}`, ["Proveedor", "Tipo", "Contacto", "Teléfono", "Email", "Qué te vende", "Compraste (12 meses)", "Compras", "Primera compra", "Última compra", "Cada (días)"],
    shown.map((row) => [row.name, SUPPLIER_KIND_LABELS[row.kind], row.contactName, row.phone, row.email, sells(row), row.stats.spent, row.stats.purchases, row.stats.firstOn ?? "", row.stats.lastOn ?? "", row.stats.everyDays]));
  return <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-xs sm:p-5" aria-label="Lista de proveedores">
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tipo">
      {(["all", ...SUPPLIER_KINDS] as const).map((key) => {
        const count = key === "all" ? rows.length : rows.filter((row) => row.kind === key).length;
        if (key !== "all" && !count) return null;
        return <button key={key} type="button" onClick={() => setKind(key)} aria-pressed={kind === key}
          className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition-colors", kind === key ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>
          {key === "all" ? "Todos" : SUPPLIER_KIND_LABELS[key]} <span className="tabular-nums opacity-70">{count}</span>
        </button>;
      })}
    </div>
    <TableToolbar search={search} onSearch={setSearch} placeholder="Buscar proveedor, insumo, zona o teléfono" shown={shown.length} total={rows.length}>
      <Button type="button" size="sm" variant="outline" className="h-8" onClick={exportRows} title="Descarga lo que ves (con los filtros aplicados)"><AnimatedIcon name="cloud" data-icon="inline-start" size={14} />Descargar Excel</Button>
    </TableToolbar>
    {!shown.length ? <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No hay proveedores con esos filtros.</p>
      : isMobile ? <ul className="flex flex-col gap-3">{shown.map((row) => {
        const move = biggestMove(row);
        return <li key={row.id}><button type="button" onClick={() => onOpen(row.id)} className="flex w-full flex-col gap-2 rounded-xl border bg-background p-3 text-left">
          <span className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="block font-medium">{row.name}</span><span className="block truncate text-xs text-muted-foreground">{sells(row) || "Sin insumos registrados"}</span></span><KindBadge kind={row.kind} /></span>
          <span className="grid grid-cols-3 gap-2 text-xs">
            <span><span className="block text-muted-foreground">Compraste</span><span className="font-semibold tabular-nums">{money(row.stats.spent)}</span></span>
            <span><span className="block text-muted-foreground">Última</span><span className="font-semibold">{row.stats.lastOn ? relativeDay(row.stats.lastOn, today) : "—"}</span></span>
            <span><span className="block text-muted-foreground">Precio</span>{move ? <ChangeChip change={move.change} /> : <span className="font-semibold">—</span>}</span>
          </span>
        </button></li>;
      })}</ul>
      : <div className="max-h-[min(70vh,48rem)] overflow-auto rounded-lg border">
        <Table className="border-separate border-spacing-0">
          <TableHeader className="sticky top-0 z-20 bg-card"><TableRow className="hover:bg-transparent">
            <SortableHead column="name" label="Proveedor" sort={sort} onSort={setSort} className="sticky left-0 z-30 min-w-52 bg-muted" defaultDirection="asc" />
            <th className={cn(sheetHead, "min-w-24 text-left")}>Tipo</th>
            <th className={cn(sheetHead, "min-w-64 text-left")}>Qué te vende</th>
            <SortableHead column="spent" label="Compraste" sort={sort} onSort={setSort} className="min-w-32 text-right" />
            <th className={cn(sheetHead, "min-w-20 text-right")}>Compras</th>
            <SortableHead column="last" label="Última compra" sort={sort} onSort={setSort} className="min-w-36" />
            <th className={cn(sheetHead, "min-w-40 text-left")} title="El cambio de precio más grande entre sus insumos">Precios</th>
          </TableRow></TableHeader>
          <TableBody>{shown.map((row) => {
            const move = biggestMove(row);
            return <TableRow key={row.id} className="cursor-pointer hover:bg-muted/30" onClick={() => onOpen(row.id)}>
              <TableCell className={cn(sheetCell, "sticky left-0 z-10 bg-card px-3 py-2")}><button type="button" className="text-left font-medium hover:underline" onClick={(event) => { event.stopPropagation(); onOpen(row.id); }}>{row.name}</button>{row.phone || row.contactName ? <span className="block text-xs text-muted-foreground">{[row.contactName, row.phone].filter(Boolean).join(" · ")}</span> : null}</TableCell>
              <TableCell className={cn(sheetCell, "px-3")}><KindBadge kind={row.kind} /></TableCell>
              <TableCell className={cn(sheetCell, "px-3 text-sm")}>{sells(row) ? <span className="line-clamp-1" title={sells(row)}>{sells(row)}</span> : <span className="text-muted-foreground">—</span>}{row.deliveries ? <span className="block text-xs text-muted-foreground">{row.deliveries.total} entrega{row.deliveries.total === 1 ? "" : "s"} en 6 meses{row.deliveries.delivered ? ` · ${Math.round((row.deliveries.onTime / row.deliveries.delivered) * 100)} % a tiempo` : ""}</span> : null}</TableCell>
              <TableCell className={cn(sheetCell, "px-3 text-right font-medium tabular-nums")}>{row.stats.spent ? money(row.stats.spent) : "—"}</TableCell>
              <TableCell className={cn(sheetCell, "px-3 text-right tabular-nums")}>{row.stats.purchases || "—"}</TableCell>
              <TableCell className={cn(sheetCell, "px-3 text-sm")}>{row.stats.lastOn ? <><span>{relativeDay(row.stats.lastOn, today)}</span><span className="block text-xs text-muted-foreground tabular-nums">{row.stats.lastOn.slice(8, 10)}/{row.stats.lastOn.slice(5, 7)}/{row.stats.lastOn.slice(2, 4)}</span></> : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className={cn(sheetCell, "px-3 text-sm")}>{move ? <span className="flex items-center gap-2"><ChangeChip change={move.change} /><span className="truncate text-xs text-muted-foreground">{move.name}</span></span> : <span className="text-muted-foreground">—</span>}</TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </div>}
  </section>;
}

function KindPicker({ value, onChange }: { value: SupplierKind; onChange: (kind: SupplierKind) => void }) {
  return <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Qué te vende">
    {SUPPLIER_KINDS.map((kind) => <button key={kind} type="button" role="radio" aria-checked={value === kind} onClick={() => onChange(kind)}
      className={cn("flex items-start gap-2 rounded-lg border p-2.5 text-left transition-colors", value === kind ? "border-foreground bg-muted/60 ring-1 ring-foreground" : "hover:bg-muted/40")}>
      <span className="mt-1 size-2.5 shrink-0 rounded-[3px]" style={{ background: KIND_COLOR[kind] }} aria-hidden="true" />
      <span><span className="block text-sm font-medium">{SUPPLIER_KIND_LABELS[kind]}</span><span className="block text-xs text-muted-foreground">{SUPPLIER_KIND_HINTS[kind]}</span></span>
    </button>)}
  </div>;
}

function NewSupplierDialog({ demo, onClose, onCreated }: { demo: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [busy, setBusy] = React.useState(false);
  const [kind, setKind] = React.useState<SupplierKind>("materials");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    setBusy(true);
    try {
      const created = await businessAction<{ id: string }>({ action: "save-supplier", supplier: { name: text("name"), kind, contactName: text("contact"), phone: text("phone"), email: text("email"), notes: text("notes") } }, demo);
      notifySaved(`Proveedor creado: ${text("name")}`);
      onCreated(created.id);
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo crear el proveedor"); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>Nuevo proveedor</DialogTitle><DialogDescription>Las compras con su nombre quedan en su ficha, con los precios de lo que te vende.</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={submit}><FieldGroup>
      <Field><FieldLabel htmlFor="new-supplier-name">Nombre</FieldLabel><Input id="new-supplier-name" name="name" required maxLength={120} placeholder="Ej. Papelera del Sur" /></Field>
      <Field><FieldLabel>Qué te vende</FieldLabel><KindPicker value={kind} onChange={setKind} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="new-supplier-contact">Contacto</FieldLabel><Input id="new-supplier-contact" name="contact" maxLength={120} placeholder="Con quién hablas" /></Field>
        <Field><FieldLabel htmlFor="new-supplier-phone">Teléfono</FieldLabel><Input id="new-supplier-phone" name="phone" inputMode="tel" maxLength={60} /></Field>
      </div>
      <Field><FieldLabel htmlFor="new-supplier-email">Email</FieldLabel><Input id="new-supplier-email" name="email" type="email" maxLength={120} /></Field>
      <Field><FieldLabel htmlFor="new-supplier-notes">Notas</FieldLabel><Textarea id="new-supplier-notes" name="notes" rows={2} maxLength={1000} placeholder="Días de pedido, forma de pago, mínimo de compra…" /></Field>
    </FieldGroup>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Crear proveedor"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

/** A supplier's record: its data, what it sells with its prices, purchases month by month and the latest ones. */
function SupplierSheet({ id, state, demo, others, onClose, onChanged }: { id: string; state: DomainState; demo: boolean; others: SupplierRow[]; onClose: () => void; onChanged: () => void }) {
  const demoChanges = useDemoVersion(demo);
  const [loaded, setLoaded] = React.useState<Detail | null>(null);
  const [tick, setTick] = React.useState(0);
  const money = useMoney(state.organization.currency);
  const compact = useCompactMoney(state.organization.currency);
  const [mergeInto, setMergeInto] = React.useState("");
  const [focus, setFocus] = React.useState(11);
  React.useEffect(() => {
    if (demo) return;
    let active = true;
    fetch(`/api/suppliers/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo abrir el proveedor"); return body as Detail; })
      .then((data) => { if (active) setLoaded(data); })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "No se pudo abrir el proveedor"));
    return () => { active = false; };
  }, [demo, id, tick]);
  const demoData = React.useMemo(() => { if (!demo) return null; try { return demoSupplierDetail(id); } catch { return null; } }, [demo, id, demoChanges]); // eslint-disable-line react-hooks/exhaustive-deps
  const detail = demoData ?? loaded;
  const changed = () => { setTick((value) => value + 1); onChanged(); };
  async function act(body: Record<string, unknown> & { action: string }, message: string) {
    try { await businessAction(body, demo); notifySaved(message); changed(); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar"); return false; }
  }
  const saveField = (field: "name" | "contactName" | "phone" | "email" | "notes", value: string) => {
    if (!detail || value.trim() === detail.supplier[field]) return;
    if (field === "name" && !value.trim()) return;
    void act({ action: "save-supplier", supplier: { id, [field]: value.trim() } }, field === "name" ? "Proveedor renombrado" : "Datos del proveedor guardados");
  };
  const supplier = detail?.supplier;

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
      {!detail || !supplier ? <><DialogHeader><DialogTitle>Proveedor</DialogTitle><DialogDescription>Cargando su ficha…</DialogDescription></DialogHeader><TextShimmer className="text-sm">Cargando…</TextShimmer></> : <>
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle className="sr-only">{supplier.name}</DialogTitle>
            <Input key={supplier.name} defaultValue={supplier.name} aria-label="Nombre del proveedor" maxLength={120} onBlur={(event) => saveField("name", event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
              className="h-9 max-w-sm border-transparent bg-transparent px-1 text-xl font-semibold shadow-none hover:border-input focus-visible:border-ring" />
            <Dropdown aria-label="Qué te vende" size="sm" value={supplier.kind} onChange={(event) => { const kind = event.target.value as SupplierKind; if (kind !== supplier.kind) void act({ action: "save-supplier", supplier: { id, kind } }, `Ahora es de ${SUPPLIER_KIND_LABELS[kind].toLowerCase()}`); }}>
              {SUPPLIER_KINDS.map((kind) => <DropdownOption key={kind} value={kind} hint={SUPPLIER_KIND_HINTS[kind]}>{SUPPLIER_KIND_LABELS[kind]}</DropdownOption>)}
            </Dropdown>
          </div>
          <DialogDescription>{SUPPLIER_KIND_HINTS[supplier.kind]}{supplier.stats.firstOn ? ` · Le compras desde el ${supplier.stats.firstOn.slice(8, 10)}/${supplier.stats.firstOn.slice(5, 7)}/${supplier.stats.firstOn.slice(0, 4)}` : ""}</DialogDescription>
        </DialogHeader>
        {supplier.stats.purchases || !supplier.deliveries ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Mini label="Compraste en el año" value={money(supplier.stats.spent)} />
          <Mini label="Compras" value={String(supplier.stats.purchases)} />
          <Mini label="Le compras cada" value={supplier.stats.everyDays ? `${supplier.stats.everyDays} días` : "—"} />
          <Mini label="Última compra" value={supplier.stats.lastOn ? relativeDay(supplier.stats.lastOn, detail.today) : "—"} />
        </div> : null}
        {supplier.deliveries ? <section className="grid grid-cols-2 gap-2 rounded-xl border bg-muted/30 p-3 sm:grid-cols-4" aria-label="Entregas que llevó">
          <Mini label="Entregas (6 meses)" value={String(supplier.deliveries.total)} note={supplier.zones.length ? `Zonas: ${supplier.zones.join(", ")}` : undefined} />
          <Mini label="A tiempo" value={supplier.deliveries.delivered ? `${Math.round((supplier.deliveries.onTime / supplier.deliveries.delivered) * 100)} %` : "—"} note={`${supplier.deliveries.onTime} de ${supplier.deliveries.delivered} entregadas`} />
          <Mini label="Costo de envíos" value={money(supplier.deliveries.cost)} />
          <Mini label="Por entrega" value={money(supplier.deliveries.cost / Math.max(supplier.deliveries.total, 1))} note={supplier.deliveries.failed ? `${supplier.deliveries.failed} con problema` : undefined} />
        </section> : null}
        {supplier.stats.purchases ? <ChartCard title="Lo que le compraste cada mes" description="Los últimos doce meses." className="p-3 sm:p-4" table={{ columns: ["Mes", "Compraste", "Compras"], rows: detail.months.map((item) => [item.month, money(item.amount), item.purchases]) }}>
          <MonthBars months={detail.months.map((item) => item.month)} values={detail.months.map((item) => item.amount)} focus={focus} onFocus={setFocus} format={money} compact={compact} height={170} color={KIND_COLOR[supplier.kind]} label={`Compras a ${supplier.name} por mes`} />
        </ChartCard> : null}
        <SupplierPrices prices={supplier.prices} usual={supplier.materials.filter((name) => !supplier.prices.some((price) => price.name === name))} money={money} />
        <section className="grid gap-3 sm:grid-cols-2" aria-label="Datos de contacto">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">Contacto<Input key={`c-${supplier.contactName}`} defaultValue={supplier.contactName} maxLength={120} placeholder="Con quién hablas" onBlur={(event) => saveField("contactName", event.currentTarget.value)} className="text-sm" /></label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">Teléfono
            <span className="flex gap-1"><Input key={`p-${supplier.phone}`} defaultValue={supplier.phone} inputMode="tel" maxLength={60} onBlur={(event) => saveField("phone", event.currentTarget.value)} className="text-sm" />
              {supplier.phone ? <Button size="icon" variant="outline" render={<a href={`tel:${supplier.phone.replace(/[^\d+]/g, "")}`} aria-label="Llamar" />} nativeButton={false}><Phone /></Button> : null}</span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">Email<Input key={`e-${supplier.email}`} defaultValue={supplier.email} type="email" maxLength={120} onBlur={(event) => saveField("email", event.currentTarget.value)} className="text-sm" /></label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">Notas<Textarea key={`n-${supplier.notes}`} defaultValue={supplier.notes} rows={2} maxLength={1000} placeholder="Días de pedido, forma de pago, mínimo de compra…" onBlur={(event) => saveField("notes", event.currentTarget.value)} className="text-sm" /></label>
        </section>
        <section className="flex flex-col gap-2" aria-label="Compras al proveedor">
          <h3 className="text-sm font-semibold">Sus compras</h3>
          {detail.purchases.length ? <ul className="flex flex-col divide-y rounded-xl border">{detail.purchases.map((purchase) => <li key={purchase.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0"><span className="font-medium tabular-nums">{purchase.purchasedOn.slice(8, 10)}/{purchase.purchasedOn.slice(5, 7)}/{purchase.purchasedOn.slice(2, 4)}</span><span className="text-muted-foreground"> · {purchase.description}</span>
              <span className="block text-xs text-muted-foreground">{PURCHASE_KIND_LABELS[purchase.kind]}{purchase.quantityMilli && purchase.materialName ? ` · ${new Intl.NumberFormat("es-AR").format(purchase.quantityMilli / 1000)} × ${purchase.materialName} a ${money(purchase.amountMinor / (purchase.quantityMilli / 1000))}${purchase.purchaseUnit ? ` por ${purchase.purchaseUnit}` : " c/u"}` : ""}</span></span>
            <span className="font-semibold tabular-nums">{money(purchase.amountMinor)}</span>
          </li>)}</ul> : <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{supplier.deliveries ? "Sin compras registradas: lo que cuesta cada envío queda en la venta que lleva." : "Todavía no tiene compras registradas. Cuando registres una compra con su nombre, aparece acá."}</p>}
        </section>
        <DialogFooter className="flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {others.length ? <><Dropdown aria-label="Unir con otro proveedor" value={mergeInto} onChange={(event) => setMergeInto(event.target.value)} size="sm" className="max-w-52">
              <DropdownOption value="" disabled>Unir con…</DropdownOption>
              {others.map((row) => <DropdownOption key={row.id} value={row.id}>{row.name}</DropdownOption>)}
            </Dropdown>
            <Button size="sm" variant="outline" disabled={!mergeInto} onClick={async () => { const target = others.find((row) => row.id === mergeInto); if (target && window.confirm(`¿Unir ${supplier.name} con ${target.name}? Sus compras pasan a ${target.name}.`) && await act({ action: "merge-suppliers", fromId: id, intoId: mergeInto }, `Unido a ${target.name}`)) onClose(); }}>Unir</Button></> : null}
          </div>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { if (window.confirm(`¿Archivar a ${supplier.name}? Sus compras conservan el nombre.`) && await act({ action: "archive-supplier", id }, "Proveedor archivado")) onClose(); }}>Archivar proveedor</Button>
        </DialogFooter>
      </>}
    </DialogContent>
  </Dialog>;
}

/** What a supplier sells: each supply with its price line, first and last price and the change. */
function SupplierPrices({ prices, usual, money }: { prices: MaterialPrice[]; usual: string[]; money: (value: number) => string }) {
  if (!prices.length && !usual.length) return null;
  return <section className="flex flex-col gap-2" aria-label="Qué te vende">
    <h3 className="text-sm font-semibold">Qué te vende</h3>
    {prices.length ? <ul className="flex flex-col divide-y rounded-xl border">{prices.map((price) => <li key={price.materialId} className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] items-center gap-3 px-3 py-2">
      <span className="min-w-0"><span className="block truncate text-sm font-medium">{price.name}</span>
        <span className="block text-xs text-muted-foreground tabular-nums">{price.points.length > 1 ? `${money(price.first)} → ` : ""}{money(price.last)}{price.unit ? ` por ${price.unit}` : ""} · {price.points.length} compra{price.points.length === 1 ? "" : "s"}</span></span>
      <Sparkline values={price.points.map((point) => point.unitPrice)} focus={price.points.length - 1} color={(price.change ?? 0) > 0 ? "var(--data-6)" : "var(--data-1)"} height={30} label={`Precio de ${price.name}`} />
      <ChangeChip change={price.change} />
    </li>)}</ul> : null}
    {usual.length ? <p className="text-xs text-muted-foreground">También figura como proveedor de: {usual.join(", ")}. Sus precios aparecen cuando registras una compra con cantidad.</p> : null}
  </section>;
}

function Mini({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border bg-card px-3 py-2">
    <span className="text-[11px] text-muted-foreground">{label}</span>
    <span className="truncate text-base font-semibold tabular-nums">{value}</span>
    {note ? <span className="truncate text-[11px] text-muted-foreground" title={note}>{note}</span> : null}
  </div>;
}
