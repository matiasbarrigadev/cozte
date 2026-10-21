"use client";

import * as React from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { toast } from "sonner";
import { DIRECT_CHANNEL, customerPrice, hasPriceAgreement, type CustomerEntry, type CustomerPricing, type SalesChannel } from "@/lib/business";
import { customerKey } from "@/lib/customers";
import type { Product } from "@/lib/domain";
import { AnimatedIcon } from "@/components/animated-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { businessAction, notifySaved, useMoney } from "./business-ui";

type Option = { kind: "customer"; entry: CustomerEntry } | { kind: "create"; name: string } | { kind: "clear" };

const optionText = (option: Option) => option.kind === "customer" ? option.entry.name : option.kind === "create" ? option.name : "";

const MAX_SHOWN = 8;

/** What a customer's agreement says, in a few words: "Mayorista · −10 % · 2 precios acordados". */
export function pricingSummary(pricing: CustomerPricing | null | undefined, channels: SalesChannel[]): string {
  if (!pricing) return "";
  const channel = channels.find((item) => item.id === pricing.defaultChannelId)?.name;
  const adjustment = pricing.priceAdjustmentBps ? `${pricing.priceAdjustmentBps > 0 ? "+" : "−"}${Math.abs(pricing.priceAdjustmentBps) / 100} %` : "";
  const prices = pricing.prices?.length ? `${pricing.prices.length} precio${pricing.prices.length === 1 ? "" : "s"} acordado${pricing.prices.length === 1 ? "" : "s"}` : "";
  return [channel, adjustment, prices].filter(Boolean).join(" · ");
}

/**
 * The customer of a sale, always one of the company's customers: search and pick, or create a new one right there.
 * A name that is not picked is not used, so typos never become customers.
 */
export function CustomerPicker({ customers, channels, value, onChange, onCreate, id, label = "Cliente", variant = "default", autoFocus, onCancel, onClear }: {
  customers: CustomerEntry[]; channels: SalesChannel[]; value: CustomerEntry | null; onChange: (customer: CustomerEntry | null) => void; onCreate: (name: string) => void; id?: string; label?: string;
  /** A borderless field that fills a table cell, for correcting a sale in place. */
  variant?: "default" | "cell"; autoFocus?: boolean;
  /** Leaving the field without picking (Escape or clicking away). */
  onCancel?: () => void;
  /** Offers "Sin cliente" to take the customer out of the sale. */
  onClear?: () => void;
}) {
  const [text, setText] = React.useState("");
  const [open, setOpen] = React.useState(Boolean(autoFocus));
  const inputRef = React.useRef<HTMLInputElement>(null);
  const picked = React.useRef(false);
  const query = customerKey(text);
  const exact = query ? customers.find((customer) => customerKey(customer.name) === query) : undefined;
  const options = React.useMemo<Option[]>(() => {
    const found = customers.filter((customer) => !query || customerKey(customer.name).includes(query)).slice(0, MAX_SHOWN).map((entry): Option => ({ kind: "customer", entry }));
    return [...found, ...(text.trim() && !exact ? [{ kind: "create", name: text.trim() } as const] : []), ...(onClear && !text.trim() ? [{ kind: "clear" } as const] : [])];
  }, [customers, query, text, exact, onClear]);
  const pick = (option: Option) => {
    picked.current = true;
    setOpen(false);
    setText("");
    if (option.kind === "customer") onChange(option.entry);
    else if (option.kind === "create") onCreate(option.name);
    else onClear?.();
  };

  if (value) {
    const summary = pricingSummary(value, channels);
    return <div className="flex min-h-9 items-center justify-between gap-2 rounded-lg border bg-background px-2.5 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{value.name}</p>
        {summary ? <p className="truncate text-[11px] text-muted-foreground">{summary}</p> : null}
      </div>
      <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={() => { onChange(null); requestAnimationFrame(() => inputRef.current?.focus()); }} aria-label={`Cambiar el cliente ${value.name}`}>Cambiar</Button>
    </div>;
  }
  return <div className="flex flex-col gap-1">
    <Autocomplete.Root items={options} filteredItems={options} value={text} itemToStringValue={optionText}
      open={open && options.length > 0} onOpenChange={(next) => setOpen(next)}
      onValueChange={(next, details) => {
        if (details.reason === "escape-key") return;
        if (details.reason === "item-press") {
          const option = options.find((item) => optionText(item) === next);
          if (option) pick(option);
          return;
        }
        setText(next);
      }}>
      <Autocomplete.Input ref={inputRef} id={id} aria-label={label} autoComplete="off" autoFocus={autoFocus} placeholder={variant === "cell" ? "Buscar o crear cliente" : "Buscar o crear cliente (opcional)"}
        onBlur={() => {
          setOpen(false);
          if (exact) { pick({ kind: "customer", entry: exact }); return; }
          // A pick from the list lands right after the field loses focus: give it a moment before leaving.
          if (onCancel) window.setTimeout(() => { if (!picked.current) onCancel(); }, 200);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onCancel) { event.preventDefault(); picked.current = true; onCancel(); return; }
          if (event.key === "Enter" && exact && !open) { event.preventDefault(); pick({ kind: "customer", entry: exact }); }
        }}
        className={variant === "cell"
          ? "h-11 w-full min-w-0 rounded-none border-0 bg-background px-3 text-sm shadow-none outline-none ring-2 ring-ring/50 placeholder:text-muted-foreground"
          : "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"} />
      {options.length ? <Autocomplete.Portal>
        <Autocomplete.Positioner sideOffset={4} align="start" className="isolate z-50 outline-none">
          <Autocomplete.Popup className="max-h-[min(20rem,var(--available-height))] min-w-(--anchor-width) max-w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/5 outline-none">
            <Autocomplete.List>
              {(option: Option) => option.kind === "customer"
                ? <Autocomplete.Item key={option.entry.id ?? option.entry.name} value={option} className="flex cursor-default flex-col rounded-lg px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground">
                  <span className="truncate">{option.entry.name}</span>
                  {pricingSummary(option.entry, channels) || option.entry.address ? <span className="truncate text-xs text-muted-foreground">{pricingSummary(option.entry, channels) || option.entry.address}</span> : null}
                </Autocomplete.Item>
                : option.kind === "create" ? <Autocomplete.Item key="create" value={option} className="flex cursor-default items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-primary outline-none select-none data-highlighted:bg-accent">
                  <AnimatedIcon name="plus" size={14} />Crear cliente «{option.name}»
                </Autocomplete.Item>
                : <Autocomplete.Item key="clear" value={option} className="flex cursor-default items-center rounded-lg px-2 py-1.5 text-sm text-muted-foreground outline-none select-none data-highlighted:bg-accent">Sin cliente</Autocomplete.Item>}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal> : null}
    </Autocomplete.Root>
    {variant === "default" && text.trim() && !exact && !open ? <p className="text-[11px] text-muted-foreground">«{text.trim()}» no es un cliente todavía. <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => pick({ kind: "create", name: text.trim() })}>Crearlo</button></p> : null}
  </div>;
}

/**
 * The customer cell of the sales table: shows the customer and, on click, the picker in place. Picking another
 * customer, creating one or leaving the sale without one saves at once; prices already charged stay as they were.
 */
export function CustomerCell({ value, customers, channels, products, currency, demo, onCommit, onCustomerCreated }: { value: string; customers: CustomerEntry[]; channels: SalesChannel[]; products: Product[]; currency: string; demo: boolean; onCommit: (name: string) => void; onCustomerCreated?: (customer: CustomerEntry) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [creating, setCreating] = React.useState<string | null>(null);
  return <>
    {editing ? <CustomerPicker variant="cell" autoFocus customers={customers} channels={channels} value={null} label="Cliente de la venta"
      onChange={(entry) => { setEditing(false); if (entry && entry.name !== value) onCommit(entry.name); }}
      onCreate={(name) => { setEditing(false); setCreating(name); }}
      onClear={value ? () => { setEditing(false); onCommit(""); } : undefined}
      onCancel={() => setEditing(false)} />
      : <button type="button" onClick={() => setEditing(true)} className="flex h-11 w-full items-center px-3 text-left text-sm hover:bg-accent/30" title="Cambiar el cliente" aria-label={`${value || "Sin cliente"}: cambiar el cliente`}>
        {value ? <span className="truncate">{value}</span> : <span className="text-muted-foreground">Sin cliente</span>}
      </button>}
    {creating !== null ? <QuickCustomerDialog name={creating} products={products} channels={channels} currency={currency} demo={demo} onClose={() => setCreating(null)}
      onCreated={(entry) => { setCreating(null); onCustomerCreated?.(entry); onCommit(entry.name); }} /> : null}
  </>;
}

export type PricingDraft = { defaultChannelId: string; adjustment: string; prices: Record<string, string> };

export const pricingDraftOf = (pricing: CustomerPricing | null | undefined): PricingDraft => ({
  defaultChannelId: pricing?.defaultChannelId ?? "",
  adjustment: pricing?.priceAdjustmentBps ? String(pricing.priceAdjustmentBps / 100) : "",
  prices: Object.fromEntries((pricing?.prices ?? []).map((item) => [item.productId, String(item.unitPriceMinor)])),
});

/** What a draft saves: the channel, the adjustment and every product price (empty ones remove an earlier agreement). */
export function pricingInput(draft: PricingDraft, before: CustomerPricing | null | undefined) {
  const prices = [...new Set([...Object.keys(draft.prices), ...(before?.prices ?? []).map((item) => item.productId)])]
    .map((productId) => ({ productId, unitPrice: draft.prices[productId]?.trim() ? Number(draft.prices[productId]) : null }))
    .filter((item) => item.unitPrice !== null || before?.prices?.some((entry) => entry.productId === item.productId));
  return { defaultChannelId: draft.defaultChannelId || null, priceAdjustmentPercent: draft.adjustment.trim() ? Number(draft.adjustment) : 0, prices };
}

/** A customer's channel and price agreement: the channel they buy through, a share above or below it, and fixed prices. */
export function CustomerPricingFields({ draft, onChange, products, channels, currency, idPrefix }: { draft: PricingDraft; onChange: (draft: PricingDraft) => void; products: Product[]; channels: SalesChannel[]; currency: string; idPrefix: string }) {
  const money = useMoney(currency);
  const channel = channels.find((item) => item.id === draft.defaultChannelId) ?? DIRECT_CHANNEL;
  const adjustment = draft.adjustment.trim() ? Math.round(Number(draft.adjustment) * 100) : 0;
  return <div className="flex flex-col gap-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <Field><FieldLabel htmlFor={`${idPrefix}-channel`}>Canal habitual</FieldLabel>
        <Dropdown id={`${idPrefix}-channel`} className="w-full" value={draft.defaultChannelId} onChange={(event) => onChange({ ...draft, defaultChannelId: event.target.value })}>
          <DropdownOption value="">Sin canal fijo</DropdownOption>
          {channels.map((item) => <DropdownOption key={item.id} value={item.id}>{item.name}</DropdownOption>)}
        </Dropdown>
        <FieldDescription>Minorista, mayorista, con envío: se elige solo al venderle.</FieldDescription></Field>
      <Field><FieldLabel htmlFor={`${idPrefix}-adjustment`}>Descuento o recargo (%)</FieldLabel>
        <Input id={`${idPrefix}-adjustment`} type="number" min="-90" max="100" step="0.5" value={draft.adjustment} placeholder="0" onChange={(event) => onChange({ ...draft, adjustment: event.target.value })} />
        <FieldDescription>Sobre el precio del canal: -10 es 10 % de descuento.</FieldDescription></Field>
    </div>
    {products.length ? <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">Precios acordados <span className="font-normal text-muted-foreground">(opcional, por unidad)</span></span>
      <ul className="flex flex-col divide-y rounded-lg border">{products.map((product) => {
        const usual = customerPrice(product, channel, { priceAdjustmentBps: adjustment }, currency).price;
        return <li key={product.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
          <span className="min-w-0 truncate text-sm">{product.name}</span>
          <Input type="number" min="0" step="any" inputMode="decimal" value={draft.prices[product.id] ?? ""} placeholder={usual === null ? "Precio" : money(usual)} aria-label={`Precio acordado de ${product.name}`}
            onChange={(event) => onChange({ ...draft, prices: { ...draft.prices, [product.id]: event.target.value } })} className={cn("h-8 w-32 text-right tabular-nums", draft.prices[product.id]?.trim() && "border-primary")} />
        </li>;
      })}</ul>
      <p className="text-[11px] text-muted-foreground">Vacío: paga el precio del canal{adjustment ? " con su descuento o recargo" : ""}. Un precio acordado manda sobre todo lo demás.</p>
    </div> : null}
  </div>;
}

/** Creates a customer from the sale being made, with their channel and prices, and hands it back to link it. */
export function QuickCustomerDialog({ name, products, channels, currency, demo, onClose, onCreated }: { name: string; products: Product[]; channels: SalesChannel[]; currency: string; demo: boolean; onClose: () => void; onCreated: (customer: CustomerEntry) => void }) {
  const [customerName, setCustomerName] = React.useState(name);
  const [phone, setPhone] = React.useState("");
  const [draft, setDraft] = React.useState<PricingDraft>(pricingDraftOf(null));
  const [busy, setBusy] = React.useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!customerName.trim()) return;
    setBusy(true);
    try {
      const pricing = pricingInput(draft, null);
      const saved = await businessAction<{ id: string }>({ action: "save-customer", customer: { name: customerName.trim(), phone: phone.trim(), ...pricing, prices: pricing.prices.filter((item) => item.unitPrice !== null) } }, demo);
      notifySaved(`Cliente creado: ${customerName.trim()}`);
      onCreated({
        id: saved.id, name: customerName.trim(), address: "", contact: phone.trim(), recipient: "", lastOn: "", sales: 0,
        defaultChannelId: pricing.defaultChannelId, priceAdjustmentBps: Math.round(pricing.priceAdjustmentPercent * 100),
        prices: pricing.prices.filter((item): item is { productId: string; unitPrice: number } => item.unitPrice !== null).map((item) => ({ productId: item.productId, unitPriceMinor: item.unitPrice })),
      });
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo crear el cliente"); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
    <DialogHeader><DialogTitle>Cliente nuevo</DialogTitle><DialogDescription>Queda en tus clientes y ligado a esta venta. Si tiene un precio especial, cargalo ahora y se usa solo cada vez que le vendas.</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={submit}><FieldGroup>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="quick-customer-name">Nombre</FieldLabel><Input id="quick-customer-name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} required maxLength={120} autoFocus /></Field>
        <Field><FieldLabel htmlFor="quick-customer-phone">Teléfono</FieldLabel><Input id="quick-customer-phone" value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" maxLength={60} placeholder="Opcional" /></Field>
      </div>
      <CustomerPricingFields draft={draft} onChange={setDraft} products={products} channels={channels} currency={currency} idPrefix="quick-customer" />
    </FieldGroup>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy || !customerName.trim()}>{busy ? "Creando…" : "Crear cliente"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

/** The agreement on a customer's record, editable and saved in one step. */
export function CustomerPricingEditor({ customerId, pricing, products, channels, currency, demo, onSaved }: { customerId: string; pricing: CustomerPricing; products: Product[]; channels: SalesChannel[]; currency: string; demo: boolean; onSaved: () => void }) {
  const [draft, setDraft] = React.useState<PricingDraft>(() => pricingDraftOf(pricing));
  const [busy, setBusy] = React.useState(false);
  const before = JSON.stringify(pricingDraftOf(pricing));
  const dirty = JSON.stringify(draft) !== before;
  return <section className="flex flex-col gap-3 rounded-xl border p-3" aria-label="Canal y precios del cliente">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-semibold">Canal y precios</h3><p className="text-xs text-muted-foreground">{hasPriceAgreement(pricing) || pricing.defaultChannelId ? pricingSummary(pricing, channels) : "Paga el precio del canal por el que compra."}</p></div>
      {dirty ? <div className="flex gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(pricingDraftOf(pricing))}>Descartar</Button>
        <Button type="button" size="sm" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await businessAction({ action: "save-customer", customer: { id: customerId, ...pricingInput(draft, pricing) } }, demo); notifySaved("Canal y precios del cliente guardados"); onSaved(); }
          catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar"); }
          finally { setBusy(false); }
        }}>{busy ? "Guardando…" : "Guardar"}</Button>
      </div> : null}
    </div>
    <CustomerPricingFields draft={draft} onChange={setDraft} products={products} channels={channels} currency={currency} idPrefix={`pricing-${customerId}`} />
  </section>;
}
