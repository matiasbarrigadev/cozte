"use client";

import * as React from "react";
import { MapPin, Phone } from "lucide-react";
import { DELIVERY_STATUSES, DELIVERY_STATUS_HINTS, DELIVERY_STATUS_LABELS, DIRECT_CHANNEL, daysFrom, isOpenDelivery, saleItemsText, type Delivery, type DeliveryStatus, type Sale, type SalePatch, type SalesChannel } from "@/lib/business";
import { AnimatedIcon } from "@/components/animated-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { SuggestInput, type Suggestion } from "@/components/ui/suggest-input";
import { cn } from "@/lib/utils";
import { DELIVERY_TONE, DeliveryStatusBadge, relativeDay } from "./delivery-status";

/**
 * Sales and deliveries as cards for a phone: the fields that matter first, one tap to mark a delivery as done,
 * call the customer or open the address in maps, and an edit dialog instead of a wide sheet.
 */

const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
/** A contact becomes a phone link only when it holds a phone number. */
const phoneOf = (contact: string) => { const digits = contact.replace(/[^\d+]/g, ""); return digits.replace(/\D/g, "").length >= 6 ? digits : null; };

type DeliveryPatch = Partial<Pick<Delivery, "scheduledOn" | "timeWindow" | "status" | "method" | "carrier" | "recipient" | "address" | "contact" | "tracking" | "note">> & { cost?: number };

export function DeliveryCards({ rows, today, money, onSave, onRemove }: { rows: Delivery[]; today: string; money: (value: number) => string; onSave: (delivery: Delivery, patch: DeliveryPatch, message?: string) => Promise<boolean>; onRemove: (delivery: Delivery) => void }) {
  const [editing, setEditing] = React.useState<Delivery | null>(null);
  if (!rows.length) return <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No hay entregas con estos filtros.</p>;
  return <>
    <ul className="flex flex-col gap-3">
      {rows.map((item) => {
        const days = daysFrom(item.scheduledOn, today);
        const open = isOpenDelivery(item.status);
        const late = open && days < 0;
        const phone = phoneOf(item.contact);
        return <li key={item.id} className={cn("flex flex-col gap-2 rounded-xl border bg-card p-3", late && "border-red-300 bg-red-50/60 dark:border-red-400/40 dark:bg-red-500/5", open && days === 0 && "border-amber-300 bg-amber-50/60 dark:border-amber-400/40 dark:bg-amber-500/5")}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={cn("text-sm font-semibold", late && "text-red-800 dark:text-red-200")}>{relativeDay(item.scheduledOn, today)} · {item.scheduledOn.slice(8, 10)}/{item.scheduledOn.slice(5, 7)}{item.timeWindow ? ` · ${item.timeWindow}` : ""}</p>
              <p className="truncate text-xs text-muted-foreground">{item.sale.channelName}{item.carrier ? ` · ${item.carrier}` : ""}</p>
            </div>
            <Dropdown size="sm" aria-label="Estado de la entrega" value={item.status} className={cn("shrink-0 rounded-full font-medium ring-1", DELIVERY_TONE[item.status])} onChange={(event) => { const status = event.target.value as DeliveryStatus; if (status !== item.status) void onSave(item, { status }); }}>
              {DELIVERY_STATUSES.map((status) => <DropdownOption key={status} value={status} hint={DELIVERY_STATUS_HINTS[status]}>{DELIVERY_STATUS_LABELS[status]}</DropdownOption>)}
            </Dropdown>
          </div>
          <p className="text-base font-medium">{item.recipient || item.sale.customer || "Sin nombre"}</p>
          <p className="text-sm text-muted-foreground">{item.sale.items}</p>
          <div className="flex flex-col gap-1 text-sm">
            {item.address ? <a href={mapsUrl(item.address)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"><MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{item.address}</a> : <span className="text-xs text-muted-foreground">Sin dirección</span>}
            {item.contact ? phone ? <a href={`tel:${phone}`} className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"><Phone className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{item.contact}</a> : <span className="text-xs text-muted-foreground">{item.contact}</span> : null}
            {item.tracking ? <span className="text-xs text-muted-foreground">Seguimiento: {item.tracking}</span> : null}
            {item.note ? <span className="text-xs">{item.note}</span> : null}
          </div>
          <div className="flex items-center gap-2 pt-1">
            {open ? <Button type="button" className="h-10 flex-1" onClick={() => void onSave(item, { status: "delivered" }, "Entrega marcada como entregada")}><AnimatedIcon name="check" data-icon="inline-start" />Entregada</Button> : <span className="flex-1 text-xs text-muted-foreground">Costo {money(item.costMinor)}</span>}
            <Button type="button" variant="outline" className="h-10" onClick={() => setEditing(item)}><AnimatedIcon name="edit" data-icon="inline-start" />Editar</Button>
          </div>
        </li>;
      })}
    </ul>
    {editing ? <DeliveryEditDialog delivery={editing} onClose={() => setEditing(null)} onRemove={() => { onRemove(editing); setEditing(null); }} onSave={async (patch) => { if (!Object.keys(patch).length || await onSave(editing, patch)) setEditing(null); }} /> : null}
  </>;
}

function DeliveryEditDialog({ delivery, onClose, onSave, onRemove }: { delivery: Delivery; onClose: () => void; onSave: (patch: DeliveryPatch) => Promise<void>; onRemove: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const fields: { key: keyof DeliveryPatch & keyof Delivery; label: string; type?: string; placeholder?: string }[] = [
    { key: "scheduledOn", label: "Fecha", type: "date" }, { key: "timeWindow", label: "Franja horaria", placeholder: "Ej. 9 a 13" },
    { key: "recipient", label: "Recibe" }, { key: "address", label: "Dirección" }, { key: "contact", label: "Contacto", placeholder: "Teléfono" },
    { key: "carrier", label: "Quién entrega" }, { key: "method", label: "Forma de entrega" }, { key: "tracking", label: "Seguimiento" }, { key: "note", label: "Nota" },
  ];
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const patch: DeliveryPatch = {};
    for (const field of fields) { const value = String(data.get(field.key) ?? "").trim(); if (value !== String(delivery[field.key] ?? "")) (patch as Record<string, string>)[field.key] = value; }
    const cost = Number(data.get("cost"));
    if (Number.isFinite(cost) && cost >= 0 && cost !== delivery.costMinor) patch.cost = cost;
    if (patch.scheduledOn === "") delete patch.scheduledOn;
    setBusy(true);
    try { await onSave(patch); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>Entrega a {delivery.recipient || delivery.sale.customer || "cliente"}</DialogTitle><DialogDescription>{delivery.sale.items} · {delivery.sale.channelName}</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={submit}><FieldGroup>
      {fields.map((field) => <Field key={field.key}><FieldLabel htmlFor={`edit-${field.key}`}>{field.label}</FieldLabel><Input id={`edit-${field.key}`} name={field.key} type={field.type} defaultValue={String(delivery[field.key] ?? "")} placeholder={field.placeholder} /></Field>)}
      <Field><FieldLabel htmlFor="edit-cost">Costo de la entrega</FieldLabel><Input id="edit-cost" name="cost" type="number" min="0" step="any" inputMode="decimal" defaultValue={delivery.costMinor} /></Field>
    </FieldGroup>
      <DialogFooter className="gap-2 sm:justify-between"><Button type="button" variant="ghost" className="text-destructive" onClick={onRemove}>Quitar entrega</Button><div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button></div></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

export function SaleCards({ rows, today, channels, money, suggestions, onUpdate, onArchive, onEditItems, onOpenDeliveries }: {
  rows: Sale[]; today: string; channels: SalesChannel[]; money: (value: number) => string; suggestions: Suggestion[];
  onUpdate: (sale: Sale, patch: SalePatch, message?: string) => Promise<boolean>; onArchive: (sale: Sale) => void; onEditItems: (sale: Sale) => void; onOpenDeliveries?: () => void;
}) {
  const [editing, setEditing] = React.useState<Sale | null>(null);
  if (!rows.length) return <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No hay ventas con estos filtros.</p>;
  return <>
    <ul className="flex flex-col gap-3">
      {rows.map((sale) => {
        const left = sale.variableCostMinor === null ? null : sale.totalMinor - sale.variableCostMinor - sale.sellingCostMinor - sale.deliveryCostMinor;
        return <li key={sale.id} className="flex flex-col gap-2 rounded-xl border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{relativeDay(sale.soldOn, today)} · {sale.soldOn.slice(8, 10)}/{sale.soldOn.slice(5, 7)}</p>
              <p className="truncate text-xs text-muted-foreground">{sale.channelName}</p>
            </div>
            {sale.delivery ? <button type="button" onClick={onOpenDeliveries}><DeliveryStatusBadge status={sale.delivery.status} /></button> : null}
          </div>
          <p className="text-base font-medium">{sale.customer || "Sin cliente"}</p>
          <p className="text-sm text-muted-foreground">{saleItemsText(sale.items)}</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-muted/60 px-2.5 py-1.5"><p className="text-[11px] text-muted-foreground">Cobrado</p><p className="font-semibold tabular-nums">{money(sale.totalMinor)}</p></div>
            <div className="rounded-lg bg-muted/60 px-2.5 py-1.5"><p className="text-[11px] text-muted-foreground">Te dejó</p><p className={cn("font-semibold tabular-nums", left !== null && left < 0 && "text-destructive")}>{left === null ? "Costo incompleto" : money(left)}</p></div>
          </div>
          {sale.note ? <p className="text-xs">{sale.note}</p> : null}
          <div className="flex items-center gap-2 pt-1">
            <Button type="button" variant="outline" className="h-10 flex-1" onClick={() => setEditing(sale)}><AnimatedIcon name="edit" data-icon="inline-start" />Editar</Button>
            <Button type="button" variant="outline" className="h-10" onClick={() => onEditItems(sale)}>Productos</Button>
            <Button type="button" variant="ghost" size="icon" className="size-10" aria-label="Anular venta" onClick={() => onArchive(sale)}><AnimatedIcon name="delete" /></Button>
          </div>
        </li>;
      })}
    </ul>
    {editing ? <SaleEditDialog sale={editing} channels={channels} suggestions={suggestions} onClose={() => setEditing(null)} onSave={async (patch) => { if (!Object.keys(patch).length || await onUpdate(editing, patch)) setEditing(null); }} /> : null}
  </>;
}

function SaleEditDialog({ sale, channels, suggestions, onClose, onSave }: { sale: Sale; channels: SalesChannel[]; suggestions: Suggestion[]; onClose: () => void; onSave: (patch: SalePatch) => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const [customer, setCustomer] = React.useState(sale.customer);
  const [channelId, setChannelId] = React.useState(sale.channelId ?? DIRECT_CHANNEL.id);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const patch: SalePatch = {};
    const soldOn = String(data.get("soldOn") ?? "");
    if (soldOn && soldOn !== sale.soldOn) patch.soldOn = soldOn;
    if (customer.trim() !== sale.customer) patch.customer = customer.trim();
    const note = String(data.get("note") ?? "").trim();
    if (note !== sale.note) patch.note = note;
    const nextChannel = channelId === DIRECT_CHANNEL.id ? null : channelId;
    if (nextChannel !== sale.channelId) patch.channelId = nextChannel;
    const cost = Number(data.get("deliveryCost"));
    if (patch.channelId === undefined && Number.isFinite(cost) && cost >= 0 && cost !== sale.deliveryCostMinor) patch.deliveryCost = cost;
    setBusy(true);
    try { await onSave(patch); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>Editar venta</DialogTitle><DialogDescription>{saleItemsText(sale.items)}. El precio cobrado y el costo de cada producto quedan como estaban.</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={submit}><FieldGroup>
      <Field><FieldLabel htmlFor="edit-sold-on">Fecha</FieldLabel><DatePicker id="edit-sold-on" name="soldOn" defaultValue={sale.soldOn} /></Field>
      <Field><FieldLabel htmlFor="edit-channel">Canal</FieldLabel><Dropdown id="edit-channel" className="w-full" value={channelId} onChange={(event) => setChannelId(event.target.value)}>{channels.map((item) => <DropdownOption key={item.id} value={item.id}>{item.name}</DropdownOption>)}<DropdownOption value={DIRECT_CHANNEL.id}>{DIRECT_CHANNEL.name}</DropdownOption></Dropdown></Field>
      <Field><FieldLabel htmlFor="edit-customer">Cliente</FieldLabel><SuggestInput id="edit-customer" value={customer} suggestions={suggestions} onValueChange={(value) => setCustomer(value)} placeholder="Sin cliente" /></Field>
      <Field><FieldLabel htmlFor="edit-delivery-cost">Costo de entregar</FieldLabel><Input id="edit-delivery-cost" name="deliveryCost" type="number" min="0" step="any" inputMode="decimal" defaultValue={sale.deliveryCostMinor} disabled={channelId !== (sale.channelId ?? DIRECT_CHANNEL.id)} /></Field>
      <Field><FieldLabel htmlFor="edit-note">Nota</FieldLabel><Input id="edit-note" name="note" defaultValue={sale.note} /></Field>
    </FieldGroup>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
