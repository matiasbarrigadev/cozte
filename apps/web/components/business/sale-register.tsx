"use client";

import * as React from "react";
import { toast } from "sonner";
import { DIRECT_CHANNEL, PAYMENT_METHODS, customerPrice, needsDelivery, type CustomerEntry, type PaymentMethod, type SalesChannel } from "@/lib/business";
import { customerKey } from "@/lib/customers";
import type { DomainState } from "@/lib/domain";
import { AnimatedIcon } from "@/components/animated-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { businessAction, notifySaved, useMoney } from "./business-ui";
import { matches, usePersistentState } from "./data-table";
import { PAYMENT_CHOICE_LABELS, PaymentPicker, paymentFields, type PaymentChoice } from "./payment";
import { CustomerPicker, QuickCustomerDialog } from "./customer-picker";

/** A sale to start from: the one being repeated. */
export type SalePreset = { key: number; channelId: string | null; customer: string; items: { productId: string; quantity: number }[] };

type Line = { quantity: number; price: string };

const PAYMENT_CHOICES: PaymentChoice[] = ["cash", "transfer", "debit", "credit", "owed"];

/**
 * The register: tap products (or type and press Enter) to build the ticket, pick the channel, the customer and how it
 * was paid, and register it in one step. Prices come from each channel; a price typed on a line replaces it.
 */
export const SaleRegister = React.forwardRef<HTMLInputElement, { state: DomainState; channels: SalesChannel[]; demo: boolean; today: string; customers: CustomerEntry[]; onCustomerCreated?: () => void; preset: SalePreset | null; onSaved: () => void; onOpenDialog: () => void; onOpenChannels?: () => void }>(function SaleRegister({ state, channels, demo, today, customers: known, onCustomerCreated, preset, onSaved, onOpenDialog, onOpenChannels }, searchRef) {
  const money = useMoney(state.organization.currency);
  const channelIds = React.useMemo(() => [...channels.map((channel) => channel.id), DIRECT_CHANNEL.id], [channels]);
  const [channelId, setChannelId] = usePersistentState<string>("ventas:caja:canal", channels[0]?.id ?? DIRECT_CHANNEL.id, channelIds);
  // The usual way of paying is remembered; "owes it" is for one sale and goes back to it after registering.
  const [method, setMethod] = usePersistentState<PaymentMethod>("ventas:caja:pago", "cash", PAYMENT_METHODS);
  const [owes, setOwes] = React.useState(false);
  const payment: PaymentChoice = owes ? "owed" : method;
  const setPayment = (choice: PaymentChoice) => { if (choice === "owed") setOwes(true); else { setOwes(false); setMethod(choice); } };
  const [lines, setLines] = React.useState<Map<string, Line>>(new Map());
  const [search, setSearch] = React.useState("");
  const [customer, setCustomer] = React.useState<CustomerEntry | null>(null);
  const [creating, setCreating] = React.useState<string | null>(null);
  // Customers created here are usable at once, before the list comes back from the server.
  const [created, setCreated] = React.useState<CustomerEntry[]>([]);
  const customers = React.useMemo(() => [...created.filter((entry) => !known.some((item) => customerKey(item.name) === customerKey(entry.name))), ...known], [created, known]);
  const chooseCustomer = (entry: CustomerEntry | null) => {
    setCustomer(entry);
    // Their usual channel comes with them; their prices follow from it.
    if (entry?.defaultChannelId && channelIds.includes(entry.defaultChannelId)) setChannelId(entry.defaultChannelId);
  };
  const [soldOn, setSoldOn] = React.useState(today);
  const [busy, setBusy] = React.useState(false);
  const [idempotencyKey, setIdempotencyKey] = React.useState(() => crypto.randomUUID());
  const submitRef = React.useRef<HTMLButtonElement>(null);
  const channel = channels.find((item) => item.id === channelId) ?? DIRECT_CHANNEL;

  // Repeating a sale loads its channel, customer and products, ready to register again today.
  const [appliedPreset, setAppliedPreset] = React.useState<number | null>(null);
  if (preset && preset.key !== appliedPreset) {
    setAppliedPreset(preset.key);
    setLines(new Map(preset.items.filter((item) => state.products.some((product) => product.id === item.productId)).map((item) => [item.productId, { quantity: item.quantity, price: "" }])));
    setChannelId(preset.channelId && channelIds.includes(preset.channelId) ? preset.channelId : DIRECT_CHANNEL.id);
    setCustomer(preset.customer ? customers.find((entry) => customerKey(entry.name) === customerKey(preset.customer)) ?? null : null);
    setSoldOn(today);
  }

  const products = state.products.filter((product) => matches(search, [product.name]));
  const quoteOf = (productId: string) => {
    const product = state.products.find((item) => item.id === productId);
    return product ? customerPrice(product, channel, customer, state.organization.currency) : { price: null, source: "channel" as const };
  };
  const priceOf = (productId: string) => quoteOf(productId).price;
  const add = (productId: string, delta = 1) => setLines((current) => {
    const next = new Map(current);
    const line = next.get(productId) ?? { quantity: 0, price: "" };
    const quantity = Math.max(0, Math.round((line.quantity + delta) * 1000) / 1000);
    if (quantity === 0) next.delete(productId); else next.set(productId, { ...line, quantity });
    return next;
  });
  const setLine = (productId: string, change: Partial<Line>) => setLines((current) => {
    const next = new Map(current);
    const line = next.get(productId);
    if (line) next.set(productId, { ...line, ...change });
    return next;
  });
  const ticket = [...lines.entries()].map(([productId, line]) => {
    const product = state.products.find((item) => item.id === productId);
    const unit = line.price.trim() !== "" ? Number(line.price) : priceOf(productId);
    return { productId, name: product?.name ?? "Producto", line, unit, total: unit === null ? null : unit * line.quantity };
  });
  const total = ticket.every((item) => item.total !== null) ? ticket.reduce((sum, item) => sum + (item.total ?? 0), 0) : null;
  const units = ticket.reduce((sum, item) => sum + item.line.quantity, 0);

  async function register() {
    if (!ticket.length || busy) return;
    setBusy(true);
    try {
      const recorded = await businessAction<{ id: string; sale: { totalMinor: number } }>({ action: "record-sale", idempotencyKey, sale: {
        soldOn, channelId: channel.id === DIRECT_CHANNEL.id ? null : channel.id, customer: customer?.name ?? "",
        items: ticket.map((item) => ({ productId: item.productId, quantity: item.line.quantity, ...(item.line.price.trim() !== "" ? { unitPrice: Number(item.line.price) } : {}) })),
        ...paymentFields(payment),
      } }, demo);
      notifySaved(`Venta registrada · ${money(recorded.sale.totalMinor)}${payment === "owed" ? " · por cobrar" : ""}`, async () => {
        try { await businessAction({ action: "archive", kind: "sale", id: recorded.id }, demo); notifySaved("Venta anulada"); onSaved(); }
        catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo anular"); }
      });
      setLines(new Map());
      setCustomer(null);
      setSearch("");
      setOwes(false);
      setIdempotencyKey(crypto.randomUUID());
      onSaved();
      (searchRef as React.RefObject<HTMLInputElement | null> | null)?.current?.focus();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo registrar"); }
    finally { setBusy(false); }
  }

  return <Card className="gap-4" onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void register(); } }}>
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1.5"><CardTitle>Caja</CardTitle><CardDescription>Tocá los productos para armar la venta, elegí el canal, el cliente y cómo pagó. <span className="hidden md:inline">Atajos: N busca un producto, Enter lo suma, Ctrl+Enter registra.</span></CardDescription></div>
      <Button type="button" variant="outline" size="sm" onClick={onOpenDialog}><AnimatedIcon name="truck" data-icon="inline-start" size={14} />Con entrega o remito</Button>
    </CardHeader>
    <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <Input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto y Enter para sumarlo" aria-label="Buscar producto"
          onKeyDown={(event) => { if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && products[0]) { event.preventDefault(); add(products[0].id); setSearch(""); } }} />
        <div className="grid max-h-80 grid-cols-2 gap-2 overflow-x-hidden overflow-y-auto sm:grid-cols-3 xl:grid-cols-4" role="group" aria-label="Productos">
          {products.map((product) => {
            const { price, source } = quoteOf(product.id);
            const count = lines.get(product.id)?.quantity ?? 0;
            return <button key={product.id} type="button" onClick={() => add(product.id)} aria-label={`Sumar ${product.name}`}
              className={cn("relative flex min-h-16 min-w-0 flex-col items-start justify-between gap-1 rounded-lg border bg-background p-2.5 text-left transition-colors hover:border-foreground/40 hover:bg-muted/50", count > 0 && "border-primary bg-primary/5")}>
              <span className="line-clamp-2 text-sm font-medium leading-snug">{product.name}</span>
              <span className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground tabular-nums">{price === null ? "Sin precio" : money(price)}{source !== "channel" ? <span className="rounded bg-primary/10 px-1 text-[10px] font-medium text-primary">{source === "agreed" ? "acordado" : "del cliente"}</span> : null}</span>
              {count > 0 ? <span className="absolute top-1.5 right-1.5 rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">{count}</span> : null}
            </button>;
          })}
          {!products.length ? <p className="col-span-full py-4 text-center text-sm text-muted-foreground">Ningún producto coincide con «{search}».</p> : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-muted/30 p-3">
        <div className="flex items-baseline justify-between"><span className="text-sm font-semibold">Venta</span>{units ? <span className="text-xs text-muted-foreground tabular-nums">{units} u.</span> : null}</div>
        {ticket.length ? <ul className="flex flex-col gap-2" aria-label="Productos de la venta">{ticket.map((item) => <li key={item.productId} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0 truncate">{item.name}</span><span className="shrink-0 font-medium tabular-nums">{item.total === null ? "—" : money(item.total)}</span></div>
          <div className="flex items-center gap-1.5">
            <Button type="button" size="icon-sm" variant="outline" aria-label={`Restar ${item.name}`} onClick={() => add(item.productId, -1)}>−</Button>
            <Input type="number" min="0.001" step="any" value={item.line.quantity} onChange={(event) => { const value = Number(event.target.value); if (value > 0) setLine(item.productId, { quantity: value }); }} aria-label={`Cantidad de ${item.name}`} className="h-8 w-16 text-center tabular-nums" />
            <Button type="button" size="icon-sm" variant="outline" aria-label={`Sumar ${item.name}`} onClick={() => add(item.productId)}>+</Button>
            <Input type="number" min="0" step="any" inputMode="decimal" value={item.line.price} onChange={(event) => setLine(item.productId, { price: event.target.value })} placeholder={priceOf(item.productId) === null ? "Precio" : money(priceOf(item.productId)!)} aria-label={`Precio por unidad de ${item.name}`} className="h-8 min-w-0 flex-1 text-right tabular-nums" />
          </div>
        </li>)}</ul> : <p className="rounded-lg border border-dashed bg-background/60 px-3 py-4 text-center text-sm text-muted-foreground">Tocá un producto para empezar.</p>}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Canal</span>
          <div role="radiogroup" aria-label="Canal" className="flex flex-wrap gap-1.5">
            {[...channels, DIRECT_CHANNEL].map((item) => <button key={item.id} type="button" role="radio" aria-checked={channel.id === item.id} onClick={() => setChannelId(item.id)}
              className={cn("rounded-full border px-3 py-1 text-xs transition-colors", channel.id === item.id ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>{item.name}</button>)}
            {!channels.length && onOpenChannels ? <button type="button" onClick={onOpenChannels} className="rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground hover:bg-muted">+ Agregar canales</button> : null}
          </div>
          {needsDelivery(channel) ? <p className="text-[11px] text-muted-foreground">Este canal entrega: la entrega se crea con la dirección del cliente.</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Cliente</span>
          <CustomerPicker customers={customers} channels={channels} value={customer} onChange={chooseCustomer} onCreate={setCreating} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Pago</span>
          <PaymentPicker value={payment} onChange={setPayment} choices={PAYMENT_CHOICES} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Fecha</span>
          <DatePicker value={soldOn} onChange={setSoldOn} today={today} aria-label="Fecha de la venta" className="h-8 flex-1" required />
        </div>
        <Button ref={submitRef} type="button" size="lg" disabled={!ticket.length || busy} onClick={() => void register()} className="w-full">
          {busy ? "Registrando…" : ticket.length ? <>Registrar · {total === null ? "sin precio" : money(total)}{payment === "owed" ? ` · ${PAYMENT_CHOICE_LABELS.owed.toLowerCase()}` : ""}</> : "Registrar venta"}
        </Button>
        {ticket.length ? <button type="button" className="self-center text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => { setLines(new Map()); setCustomer(null); }}>Vaciar</button> : null}
      </div>
    </CardContent>
    {creating !== null ? <QuickCustomerDialog name={creating} products={state.products} channels={channels} currency={state.organization.currency} demo={demo} onClose={() => setCreating(null)}
      onCreated={(entry) => { setCreating(null); setCreated((current) => [entry, ...current]); chooseCustomer(entry); onCustomerCreated?.(); }} /> : null}
  </Card>;
});
