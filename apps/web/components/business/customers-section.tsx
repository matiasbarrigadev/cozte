"use client";

import * as React from "react";
import { toast } from "sonner";
import { MapPin, Phone } from "lucide-react";
import { DELIVERY_STATUS_LABELS, type DeliveryStatus } from "@/lib/business";
import type { DomainState } from "@/lib/domain";
import { CUSTOMER_STATUS_HINTS, CUSTOMER_STATUS_LABELS, customerConcentration, type Customer, type CustomerAddress, type CustomerRow, type CustomerSale, type CustomerStats, type CustomerStatus } from "@/lib/customers";
import { demoCustomerDetail, demoCustomerList } from "@/lib/demo-store";
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
import { ChartCard, DATA_COLORS, MonthBars, Treemap, useCompactMoney } from "@/components/analysis/charts";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { SectionHeader, Stat, businessAction, notifySaved, todayFor, useBusinessView, useCustomerDirectory, useDemoVersion, useMoney } from "./business-ui";
import { SortableHead, TableToolbar, downloadCsv, matches, sheetCell, sheetHead, usePersistentState, type SortState } from "./data-table";
import { relativeDay } from "./delivery-status";
import { SaleDialog } from "./sales-section";

/**
 * Customers: one record per client with their addresses, and what they bought. The list shows who buys, how often
 * and who stopped; each record has their addresses, purchases month by month and their sales with deliveries.
 */

type ListData = { customers: CustomerRow[]; today: string };
type Detail = { customer: Customer; stats: CustomerStats; months: { month: string; revenue: number; sales: number }[]; sales: CustomerSale[]; today: string };

const STATUS_ORDER: CustomerStatus[] = ["frequent", "active", "new", "at-risk", "inactive", "none"];
const STATUS_TONE: Record<CustomerStatus, string> = {
  frequent: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  active: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300",
  new: "border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-300",
  "at-risk": "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  inactive: "border-border bg-muted text-muted-foreground",
  none: "border-border text-muted-foreground",
};

function StatusBadge({ status }: { status: CustomerStatus }) {
  return <Badge variant="outline" className={cn("whitespace-nowrap", STATUS_TONE[status])} title={CUSTOMER_STATUS_HINTS[status]}>{CUSTOMER_STATUS_LABELS[status]}</Badge>;
}

function useCustomerList(demo: boolean, refreshKey: number): { data: ListData | null; reload: () => void } {
  const demoChanges = useDemoVersion(demo);
  const [loaded, setLoaded] = React.useState<ListData | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (demo) return;
    let active = true;
    fetch("/api/customers/list", { cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudieron cargar los clientes"); return body as ListData; })
      .then((data) => { if (active) setLoaded(data); })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "No se pudieron cargar los clientes"));
    return () => { active = false; };
  }, [demo, refreshKey, tick]);
  const demoData = React.useMemo(() => demo ? demoCustomerList() : null, [demo, demoChanges]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data: demoData ?? loaded, reload: () => setTick((value) => value + 1) };
}

export function CustomersSection({ state, demo, onDataChanged }: { state: DomainState; demo: boolean; onDataChanged?: () => void }) {
  const [refreshKey, setRefreshKey] = React.useState(0);
  const { data, reload } = useCustomerList(demo, refreshKey);
  const money = useMoney(state.organization.currency);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const refresh = () => { reload(); setRefreshKey((value) => value + 1); onDataChanged?.(); };
  const customers = data?.customers ?? [];
  const today = data?.today ?? todayFor(demo);
  const buyers = customers.filter((row) => row.stats.sales > 0);
  const recent = buyers.filter((row) => (row.stats.daysSinceLast ?? 999) <= 90).length;
  const newThisMonth = buyers.filter((row) => row.stats.firstOn?.startsWith(today.slice(0, 7))).length;
  const atRisk = customers.filter((row) => row.stats.status === "at-risk").length;
  const revenue = buyers.reduce((sum, row) => sum + row.stats.revenue, 0);

  return <>
    <SectionHeader eyebrow="Día a día" title="Clientes" description="Quién te compra, cada cuánto y quién dejó de comprar. Cada cliente con sus direcciones para las entregas; se arman solos con tus ventas y los mantiene Cozte.">
      <Button onClick={() => setCreating(true)}><AnimatedIcon name="plus" data-icon="inline-start" />Nuevo cliente</Button>
    </SectionHeader>
    {!data ? <TextShimmer className="text-sm">Cargando clientes…</TextShimmer> : <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Compraron en los últimos 90 días" value={String(recent)} note={`De ${customers.length} cliente${customers.length === 1 ? "" : "s"}`} />
        <Stat label="Clientes nuevos este mes" value={String(newThisMonth)} note="Primera compra en el mes" />
        <Stat label="Venta promedio por cliente" value={buyers.length ? money(revenue / buyers.length) : "—"} note="Todo lo que compró cada uno" />
        <Stat label="En riesgo" value={String(atRisk)} note="Tardan más que de costumbre en volver" tone={atRisk ? "negative" : undefined} />
      </div>
      {customers.length ? <>
        <TopCustomers rows={customers} money={money} currency={state.organization.currency} onOpen={setOpenId} />
        <CustomerTable rows={customers} today={today} money={money} onOpen={setOpenId} />
      </> : <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center">
        <p className="font-medium">Todavía no hay clientes</p>
        <p className="max-w-md text-sm text-muted-foreground">Se crean solos cuando registras una venta con el nombre del cliente, o puedes cargarlos acá con sus direcciones.</p>
        <Button variant="outline" onClick={() => setCreating(true)}>Cargar el primero</Button>
      </div>}
    </div>}
    {openId ? <CustomerSheet key={openId} id={openId} state={state} demo={demo} others={customers.filter((row) => row.id !== openId)} onClose={() => setOpenId(null)} onChanged={refresh} /> : null}
    {creating ? <NewCustomerDialog demo={demo} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); refresh(); setOpenId(id); }} /> : null}
  </>;
}

/** Who buys the most, as blocks proportional to what each one bought, with how concentrated the sales are. */
function TopCustomers({ rows, money, currency, onOpen }: { rows: CustomerRow[]; money: (value: number) => string; currency: string; onOpen: (id: string) => void }) {
  const compact = useCompactMoney(currency);
  const buyers = rows.filter((row) => row.stats.revenue > 0).sort((a, b) => b.stats.revenue - a.stats.revenue);
  const top = buyers.slice(0, 7);
  const rest = buyers.slice(7).reduce((sum, row) => sum + row.stats.revenue, 0);
  const concentration = customerConcentration(rows);
  if (!top.length) return null;
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
    <ChartCard title="Quién te compra más" description="Cada bloque es un cliente, del tamaño de todo lo que te compró."
      table={{ columns: ["Cliente", "Compró", "Compras", "Última compra"], rows: buyers.map((row) => [row.name, money(row.stats.revenue), row.stats.sales, row.stats.lastOn ?? "—"]) }}>
      <Treemap items={[...top.map((row, index) => ({ key: row.id, label: row.name, value: row.stats.revenue, color: DATA_COLORS[index % DATA_COLORS.length], detail: `${row.stats.sales} compra${row.stats.sales === 1 ? "" : "s"} · ${CUSTOMER_STATUS_LABELS[row.stats.status]}` })), ...(rest ? [{ key: "rest", label: `Otros ${buyers.length - top.length}`, value: rest, color: "var(--data-muted)" }] : [])]} format={money} height={240} label="Clientes por lo que compraron" />
    </ChartCard>
    <ChartCard title="Lo que conviene mirar" description="Calculado con tus ventas.">
      <ul className="flex flex-col gap-2 text-sm">
        {concentration ? <li className="flex items-start gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5"><span className={cn("mt-1.5 size-2 shrink-0 rounded-full", concentration.share > 0.6 ? "bg-amber-500" : "bg-muted-foreground/60")} aria-hidden="true" /><span>Tus {concentration.top} mejores clientes son el {Math.round(concentration.share * 100)} % de lo vendido.{concentration.share > 0.6 ? " Depender de pocos es un riesgo: si uno deja de comprar, se nota mucho." : ""}</span></li> : null}
        {rows.filter((row) => row.stats.status === "at-risk").slice(0, 3).map((row) => <li key={row.id}>
          <button type="button" onClick={() => onOpen(row.id)} className="flex w-full items-start gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5 text-left hover:bg-muted">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
            <span><span className="font-medium">{row.name}</span> compraba cada {row.stats.everyDays} días y no compra hace {row.stats.daysSinceLast}. Buen momento para escribirle.</span>
          </button>
        </li>)}
        {top[0] ? <li className="flex items-start gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5"><span className="mt-1.5 size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" /><span><span className="font-medium">{top[0].name}</span> es quien más te compró: {compact(top[0].stats.revenue)} en {top[0].stats.sales} compra{top[0].stats.sales === 1 ? "" : "s"}.</span></li> : null}
      </ul>
    </ChartCard>
  </div>;
}

type SortKey = "name" | "sales" | "revenue" | "last";

function CustomerTable({ rows, today, money, onOpen }: { rows: CustomerRow[]; today: string; money: (value: number) => string; onOpen: (id: string) => void }) {
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = usePersistentState<string>("clientes:estado", "all");
  const [sort, setSort] = React.useState<SortState<SortKey>>(null);
  const isMobile = useIsMobile();
  const counts = Object.fromEntries(STATUS_ORDER.map((key) => [key, rows.filter((row) => row.stats.status === key).length])) as Record<CustomerStatus, number>;
  const shown = React.useMemo(() => {
    const filtered = rows.filter((row) => (status === "all" || row.stats.status === status) && matches(search, [row.name, row.phone, row.email, row.notes, ...row.addresses.flatMap((address) => [address.address, address.zone, address.recipient])]));
    if (!sort) return filtered;
    const direction = sort.direction === "asc" ? 1 : -1;
    const value = (row: CustomerRow): string | number => sort.key === "name" ? row.name.toLowerCase() : sort.key === "sales" ? row.stats.sales : sort.key === "revenue" ? row.stats.revenue : row.stats.lastOn ?? "";
    return [...filtered].sort((a, b) => { const x = value(a), y = value(b); return (x < y ? -1 : x > y ? 1 : 0) * direction; });
  }, [rows, status, search, sort]);
  const exportRows = () => downloadCsv(`clientes-${today}`, ["Cliente", "Teléfono", "Email", "Dirección principal", "Zona", "Compras", "Compró", "Te dejó", "Primera compra", "Última compra", "Cada (días)", "Estado"],
    shown.map((row) => { const main = row.addresses.find((address) => address.isDefault) ?? row.addresses[0]; return [row.name, row.phone, row.email, main?.address ?? "", main?.zone ?? "", row.stats.sales, row.stats.revenue, row.stats.left, row.stats.firstOn ?? "", row.stats.lastOn ?? "", row.stats.everyDays, CUSTOMER_STATUS_LABELS[row.stats.status]]; }));
  return <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-xs sm:p-5" aria-label="Lista de clientes">
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado">
      {(["all", ...STATUS_ORDER] as const).map((key) => {
        const count = key === "all" ? rows.length : counts[key];
        if (key !== "all" && !count) return null;
        return <button key={key} type="button" onClick={() => setStatus(key)} aria-pressed={status === key}
          className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition-colors", status === key ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>
          {key === "all" ? "Todos" : CUSTOMER_STATUS_LABELS[key]} <span className="tabular-nums opacity-70">{count}</span>
        </button>;
      })}
    </div>
    <TableToolbar search={search} onSearch={setSearch} placeholder="Buscar nombre, teléfono, dirección o zona" shown={shown.length} total={rows.length}>
      <Button type="button" size="sm" variant="outline" className="h-8" onClick={exportRows} title="Descarga lo que ves (con los filtros aplicados)"><AnimatedIcon name="cloud" data-icon="inline-start" size={14} />Descargar Excel</Button>
    </TableToolbar>
    {!shown.length ? <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No hay clientes con esos filtros.</p>
      : isMobile ? <ul className="flex flex-col gap-3">{shown.map((row) => {
        const main = row.addresses.find((address) => address.isDefault) ?? row.addresses[0];
        return <li key={row.id}><button type="button" onClick={() => onOpen(row.id)} className="flex w-full flex-col gap-2 rounded-xl border bg-background p-3 text-left">
          <span className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="block font-medium">{row.name}</span><span className="block truncate text-xs text-muted-foreground">{main ? `${main.address}${main.zone && !main.address.includes(main.zone) ? ` · ${main.zone}` : ""}` : "Sin dirección"}</span></span><StatusBadge status={row.stats.status} /></span>
          <span className="grid grid-cols-3 gap-2 text-xs">
            <span><span className="block text-muted-foreground">Compras</span><span className="font-semibold tabular-nums">{row.stats.sales}</span></span>
            <span><span className="block text-muted-foreground">Compró</span><span className="font-semibold tabular-nums">{money(row.stats.revenue)}</span></span>
            <span><span className="block text-muted-foreground">Última</span><span className="font-semibold">{row.stats.lastOn ? relativeDay(row.stats.lastOn, today) : "—"}</span></span>
          </span>
        </button></li>;
      })}</ul>
      : <div className="max-h-[min(70vh,48rem)] overflow-auto rounded-lg border">
        <Table className="border-separate border-spacing-0">
          <TableHeader className="sticky top-0 z-20 bg-card"><TableRow className="hover:bg-transparent">
            <SortableHead column="name" label="Cliente" sort={sort} onSort={setSort} className="sticky left-0 z-30 min-w-52 bg-muted" defaultDirection="asc" />
            <th className={cn(sheetHead, "min-w-56 text-left")}>Dirección principal</th>
            <th className={cn(sheetHead, "min-w-28 text-left")}>Zona</th>
            <SortableHead column="sales" label="Compras" sort={sort} onSort={setSort} className="text-right" />
            <SortableHead column="revenue" label="Compró" sort={sort} onSort={setSort} className="min-w-32 text-right" />
            <th className={cn(sheetHead, "min-w-28 text-right")}>Te dejó</th>
            <SortableHead column="last" label="Última compra" sort={sort} onSort={setSort} className="min-w-36" />
            <th className={cn(sheetHead, "min-w-24 text-right")} title="Días entre compras, en promedio">Cada</th>
            <th className={cn(sheetHead, "min-w-28 text-left")}>Estado</th>
          </TableRow></TableHeader>
          <TableBody>{shown.map((row) => {
            const main = row.addresses.find((address) => address.isDefault) ?? row.addresses[0];
            return <TableRow key={row.id} className="cursor-pointer hover:bg-muted/30" onClick={() => onOpen(row.id)}>
              <TableCell className={cn(sheetCell, "sticky left-0 z-10 bg-card px-3 py-2")}><button type="button" className="text-left font-medium hover:underline" onClick={(event) => { event.stopPropagation(); onOpen(row.id); }}>{row.name}</button>{row.phone ? <span className="block text-xs text-muted-foreground">{row.phone}</span> : null}</TableCell>
              <TableCell className={cn(sheetCell, "px-3 text-sm")}>{main ? <span className="line-clamp-1" title={main.address}>{main.address}</span> : <span className="text-muted-foreground">—</span>}{row.addresses.length > 1 ? <span className="text-xs text-muted-foreground">+{row.addresses.length - 1} más</span> : null}</TableCell>
              <TableCell className={cn(sheetCell, "px-3 text-sm text-muted-foreground")}>{main?.zone || "—"}</TableCell>
              <TableCell className={cn(sheetCell, "px-3 text-right tabular-nums")}>{row.stats.sales}</TableCell>
              <TableCell className={cn(sheetCell, "px-3 text-right font-medium tabular-nums")}>{money(row.stats.revenue)}</TableCell>
              <TableCell className={cn(sheetCell, "px-3 text-right tabular-nums text-muted-foreground")}>{row.stats.left === null ? row.stats.sales ? "Incompleto" : "—" : money(row.stats.left)}</TableCell>
              <TableCell className={cn(sheetCell, "px-3 text-sm")}>{row.stats.lastOn ? <><span>{relativeDay(row.stats.lastOn, today)}</span><span className="block text-xs text-muted-foreground tabular-nums">{row.stats.lastOn.slice(8, 10)}/{row.stats.lastOn.slice(5, 7)}/{row.stats.lastOn.slice(2, 4)}</span></> : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className={cn(sheetCell, "px-3 text-right text-sm tabular-nums text-muted-foreground")}>{row.stats.everyDays ? `${row.stats.everyDays} días` : "—"}</TableCell>
              <TableCell className={cn(sheetCell, "px-3")}><StatusBadge status={row.stats.status} /></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </div>}
  </section>;
}

function NewCustomerDialog({ demo, onClose, onCreated }: { demo: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [busy, setBusy] = React.useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    setBusy(true);
    try {
      const created = await businessAction<{ id: string }>({ action: "save-customer", customer: { name: text("name"), phone: text("phone"), email: text("email"), notes: text("notes") } }, demo);
      if (text("address")) await businessAction({ action: "save-customer-address", address: { customerId: created.id, address: text("address"), zone: text("zone") || undefined, recipient: text("recipient"), isDefault: true } }, demo);
      notifySaved(`Cliente creado: ${text("name")}`);
      onCreated(created.id);
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo crear el cliente"); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>Nuevo cliente</DialogTitle><DialogDescription>Con su dirección, sus entregas se completan solas.</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={submit}><FieldGroup>
      <Field><FieldLabel htmlFor="new-customer-name">Nombre</FieldLabel><Input id="new-customer-name" name="name" required maxLength={120} placeholder="Ej. Librería El Ateneo" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="new-customer-phone">Teléfono</FieldLabel><Input id="new-customer-phone" name="phone" inputMode="tel" maxLength={60} /></Field>
        <Field><FieldLabel htmlFor="new-customer-email">Email</FieldLabel><Input id="new-customer-email" name="email" type="email" maxLength={120} /></Field>
      </div>
      <Field><FieldLabel htmlFor="new-customer-address">Dirección de entrega</FieldLabel><Input id="new-customer-address" name="address" maxLength={200} placeholder="Calle, número, ciudad" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="new-customer-zone">Zona</FieldLabel><Input id="new-customer-zone" name="zone" maxLength={60} placeholder="Barrio o ciudad" /></Field>
        <Field><FieldLabel htmlFor="new-customer-recipient">Quién recibe</FieldLabel><Input id="new-customer-recipient" name="recipient" maxLength={120} /></Field>
      </div>
      <Field><FieldLabel htmlFor="new-customer-notes">Notas</FieldLabel><Textarea id="new-customer-notes" name="notes" rows={2} maxLength={1000} placeholder="Horarios, cómo le gusta que le avisen…" /></Field>
    </FieldGroup>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Crear cliente"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/** A customer's record: their data, addresses, purchases month by month and sales with their deliveries. */
function CustomerSheet({ id, state, demo, others, onClose, onChanged }: { id: string; state: DomainState; demo: boolean; others: CustomerRow[]; onClose: () => void; onChanged: () => void }) {
  const demoChanges = useDemoVersion(demo);
  const [loaded, setLoaded] = React.useState<Detail | null>(null);
  const [tick, setTick] = React.useState(0);
  const money = useMoney(state.organization.currency);
  const compact = useCompactMoney(state.organization.currency);
  const month = todayFor(demo).slice(0, 7);
  const { view } = useBusinessView(month, demo, state);
  const directory = useCustomerDirectory(demo, tick);
  const [selling, setSelling] = React.useState(false);
  const [mergeInto, setMergeInto] = React.useState("");
  const [focus, setFocus] = React.useState(11);
  React.useEffect(() => {
    if (demo) return;
    let active = true;
    fetch(`/api/customers/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo abrir el cliente"); return body as Detail; })
      .then((data) => { if (active) setLoaded(data); })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "No se pudo abrir el cliente"));
    return () => { active = false; };
  }, [demo, id, tick]);
  const demoData = React.useMemo(() => { if (!demo) return null; try { return demoCustomerDetail(id); } catch { return null; } }, [demo, id, demoChanges]); // eslint-disable-line react-hooks/exhaustive-deps
  const detail = demoData ?? loaded;
  const changed = () => { setTick((value) => value + 1); onChanged(); };
  async function act(body: Record<string, unknown> & { action: string }, message: string) {
    try { await businessAction(body, demo); notifySaved(message); changed(); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar"); return false; }
  }
  const saveField = (field: "name" | "phone" | "email" | "notes", value: string) => {
    if (!detail || value.trim() === detail.customer[field]) return;
    if (field === "name" && !value.trim()) return;
    void act({ action: "save-customer", customer: { id, [field]: value.trim() } }, field === "name" ? "Cliente renombrado" : "Datos del cliente guardados");
  };

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
      {!detail ? <><DialogHeader><DialogTitle>Cliente</DialogTitle><DialogDescription>Cargando su ficha…</DialogDescription></DialogHeader><TextShimmer className="text-sm">Cargando…</TextShimmer></> : <>
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle className="sr-only">{detail.customer.name}</DialogTitle>
            <Input key={detail.customer.name} defaultValue={detail.customer.name} aria-label="Nombre del cliente" maxLength={120} onBlur={(event) => saveField("name", event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
              className="h-9 max-w-sm border-transparent bg-transparent px-1 text-xl font-semibold shadow-none hover:border-input focus-visible:border-ring" />
            <StatusBadge status={detail.stats.status} />
          </div>
          <DialogDescription>{CUSTOMER_STATUS_HINTS[detail.stats.status]}{detail.stats.firstOn ? ` · Cliente desde el ${detail.stats.firstOn.slice(8, 10)}/${detail.stats.firstOn.slice(5, 7)}/${detail.stats.firstOn.slice(0, 4)}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Mini label="Compras" value={String(detail.stats.sales)} />
          <Mini label="Compró" value={money(detail.stats.revenue)} />
          <Mini label="Te dejó" value={detail.stats.left === null ? detail.stats.sales ? "Incompleto" : "—" : money(detail.stats.left)} />
          <Mini label="Compra cada" value={detail.stats.everyDays ? `${detail.stats.everyDays} días` : "—"} note={detail.stats.lastOn ? `Última: ${relativeDay(detail.stats.lastOn, detail.today).toLowerCase()}` : undefined} />
        </div>
        {detail.stats.sales ? <ChartCard title="Lo que compró cada mes" description="Los últimos doce meses." className="p-3 sm:p-4" table={{ columns: ["Mes", "Compró", "Compras"], rows: detail.months.map((item) => [item.month, money(item.revenue), item.sales]) }}>
          <MonthBars months={detail.months.map((item) => item.month)} values={detail.months.map((item) => item.revenue)} focus={focus} onFocus={setFocus} format={money} compact={compact} height={170} label={`Compras de ${detail.customer.name} por mes`} />
        </ChartCard> : null}
        <section className="grid gap-3 sm:grid-cols-2" aria-label="Datos de contacto">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">Teléfono
            <span className="flex gap-1"><Input key={`p-${detail.customer.phone}`} defaultValue={detail.customer.phone} inputMode="tel" maxLength={60} onBlur={(event) => saveField("phone", event.currentTarget.value)} className="text-sm" />
              {detail.customer.phone ? <Button size="icon" variant="outline" render={<a href={`tel:${detail.customer.phone.replace(/[^\d+]/g, "")}`} aria-label="Llamar" />} nativeButton={false}><Phone /></Button> : null}</span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">Email<Input key={`e-${detail.customer.email}`} defaultValue={detail.customer.email} type="email" maxLength={120} onBlur={(event) => saveField("email", event.currentTarget.value)} className="text-sm" /></label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">Notas<Textarea key={`n-${detail.customer.notes}`} defaultValue={detail.customer.notes} rows={2} maxLength={1000} placeholder="Horarios, cómo le gusta que le avisen, condiciones…" onBlur={(event) => saveField("notes", event.currentTarget.value)} className="text-sm" /></label>
        </section>
        <Addresses customerId={id} addresses={detail.customer.addresses} onAct={act} />
        <section className="flex flex-col gap-2" aria-label="Ventas del cliente">
          <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Sus ventas</h3>{view ? <Button size="sm" onClick={() => setSelling(true)}><AnimatedIcon name="plus" data-icon="inline-start" />Registrar venta</Button> : null}</div>
          {detail.sales.length ? <ul className="flex flex-col divide-y rounded-xl border">{detail.sales.map((sale) => <li key={sale.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0"><span className="font-medium tabular-nums">{sale.soldOn.slice(8, 10)}/{sale.soldOn.slice(5, 7)}/{sale.soldOn.slice(2, 4)}</span><span className="text-muted-foreground"> · {sale.channelName}</span><span className="block text-xs text-muted-foreground">{sale.items || "—"}</span></span>
            <span className="flex items-center gap-2">{sale.deliveryStatus ? <Badge variant="outline" className="text-[11px]">{DELIVERY_STATUS_LABELS[sale.deliveryStatus as DeliveryStatus] ?? sale.deliveryStatus}</Badge> : null}<span className="font-semibold tabular-nums">{money(sale.totalMinor)}</span></span>
          </li>)}</ul> : <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Todavía no tiene ventas registradas.</p>}
        </section>
        <DialogFooter className="flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {others.length ? <><Dropdown aria-label="Unir con otro cliente" value={mergeInto} onChange={(event) => setMergeInto(event.target.value)} size="sm" className="max-w-52">
              <DropdownOption value="" disabled>Unir con…</DropdownOption>
              {others.map((row) => <DropdownOption key={row.id} value={row.id}>{row.name}</DropdownOption>)}
            </Dropdown>
            <Button size="sm" variant="outline" disabled={!mergeInto} onClick={async () => { const target = others.find((row) => row.id === mergeInto); if (target && window.confirm(`¿Unir ${detail.customer.name} con ${target.name}? Sus ventas y direcciones pasan a ${target.name}.`) && await act({ action: "merge-customers", fromId: id, intoId: mergeInto }, `Unido a ${target.name}`)) onClose(); }}>Unir</Button></> : null}
          </div>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { if (window.confirm(`¿Archivar a ${detail.customer.name}? Sus ventas conservan el nombre.`) && await act({ action: "archive-customer", id }, "Cliente archivado")) onClose(); }}>Archivar cliente</Button>
        </DialogFooter>
      </>}
    </DialogContent>
    {selling && view && detail ? <SaleDialog directory={directory} state={state} channels={view.channels} demo={demo} month={month} initialCustomer={detail.customer.name} onClose={() => setSelling(false)} onSaved={() => { setSelling(false); changed(); }} /> : null}
  </Dialog>;
}

function Mini({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="flex flex-col gap-0.5 rounded-xl border bg-card px-3 py-2">
    <span className="text-[11px] text-muted-foreground">{label}</span>
    <span className="text-base font-semibold tabular-nums">{value}</span>
    {note ? <span className="text-[11px] text-muted-foreground">{note}</span> : null}
  </div>;
}

/** A customer's delivery addresses: the default one first; each can be edited, made default or removed. */
function Addresses({ customerId, addresses, onAct }: { customerId: string; addresses: CustomerAddress[]; onAct: (body: Record<string, unknown> & { action: string }, message: string) => Promise<boolean> }) {
  const [editing, setEditing] = React.useState<string | "new" | null>(null);
  const sorted = [...addresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  return <section className="flex flex-col gap-2" aria-label="Direcciones de entrega">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Direcciones de entrega</h3><Button size="sm" variant="outline" onClick={() => setEditing("new")}><AnimatedIcon name="plus" data-icon="inline-start" />Agregar</Button></div>
    {editing === "new" ? <AddressForm customerId={customerId} onDone={() => setEditing(null)} onAct={onAct} /> : null}
    {sorted.length ? <ul className="flex flex-col gap-2">{sorted.map((address) => editing === address.id
      ? <li key={address.id}><AddressForm customerId={customerId} address={address} onDone={() => setEditing(null)} onAct={onAct} /></li>
      : <li key={address.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border px-3 py-2.5">
        <span className="min-w-0 text-sm">
          <span className="flex flex-wrap items-center gap-1.5"><MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="font-medium">{address.address}</span>{address.isDefault ? <Badge variant="secondary" className="text-[10px]">Principal</Badge> : null}{address.label ? <Badge variant="outline" className="text-[10px]">{address.label}</Badge> : null}</span>
          <span className="block text-xs text-muted-foreground">{[address.zone && `Zona: ${address.zone}`, address.recipient && `Recibe: ${address.recipient}`, address.contact, address.notes].filter(Boolean).join(" · ") || "Sin más datos"}</span>
        </span>
        <span className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" render={<a href={mapsUrl(address.address)} target="_blank" rel="noreferrer" />} nativeButton={false}>Mapa</Button>
          {!address.isDefault ? <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void onAct({ action: "save-customer-address", address: { id: address.id, customerId, isDefault: true } }, "Dirección principal cambiada")}>Hacer principal</Button> : null}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(address.id)}>Editar</Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => { if (window.confirm("¿Quitar esta dirección? Las entregas que ya la usaron la conservan.")) void onAct({ action: "archive-customer-address", customerId, id: address.id }, "Dirección quitada"); }}>Quitar</Button>
        </span>
      </li>)}</ul> : editing !== "new" ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Sin direcciones: se guardan solas cuando una entrega de este cliente tiene dirección.</p> : null}
  </section>;
}

function AddressForm({ customerId, address, onDone, onAct }: { customerId: string; address?: CustomerAddress; onDone: () => void; onAct: (body: Record<string, unknown> & { action: string }, message: string) => Promise<boolean> }) {
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    const ok = await onAct({ action: "save-customer-address", address: { ...(address ? { id: address.id } : {}), customerId, address: text("address"), zone: text("zone") || (address ? "" : undefined), recipient: text("recipient"), contact: text("contact"), label: text("label"), notes: text("notes"), ...(data.get("isDefault") ? { isDefault: true } : {}) } }, address ? "Dirección actualizada" : "Dirección agregada");
    if (ok) onDone();
  }
  return <form onSubmit={submit} className="grid gap-2 rounded-xl border bg-muted/30 p-3 sm:grid-cols-2">
    <Input name="address" required minLength={3} maxLength={200} defaultValue={address?.address} placeholder="Calle, número, ciudad" aria-label="Dirección" className="sm:col-span-2" />
    <Input name="zone" maxLength={60} defaultValue={address?.zone} placeholder="Zona (barrio o ciudad)" aria-label="Zona" />
    <Input name="label" maxLength={60} defaultValue={address?.label} placeholder="Nombre (Local, Depósito…)" aria-label="Nombre de la dirección" />
    <Input name="recipient" maxLength={120} defaultValue={address?.recipient} placeholder="Quién recibe" aria-label="Quién recibe" />
    <Input name="contact" maxLength={120} defaultValue={address?.contact} placeholder="Teléfono o contacto" aria-label="Contacto" />
    <Input name="notes" maxLength={500} defaultValue={address?.notes} placeholder="Notas (timbre, horario…)" aria-label="Notas" className="sm:col-span-2" />
    <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
      {!address?.isDefault ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="isDefault" /> Usar como principal</label> : <span />}
      <span className="flex gap-2"><Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancelar</Button><Button type="submit" size="sm">Guardar</Button></span>
    </div>
  </form>;
}
