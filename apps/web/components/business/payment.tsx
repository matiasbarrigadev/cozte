"use client";

import * as React from "react";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, salePayment, type PaymentMethod, type Sale, type SalePatch } from "@/lib/business";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** How a sale was paid, or that the customer still owes it: the choice when a sale is registered. */
export type PaymentChoice = PaymentMethod | "owed";

export const PAYMENT_CHOICE_LABELS: Record<PaymentChoice, string> = { ...PAYMENT_METHOD_LABELS, owed: "Queda debiendo" };

/** What a choice records on a new sale: paid in full with its method, or nothing collected. */
export const paymentFields = (choice: PaymentChoice): { paidAmount?: number; paymentMethod: PaymentMethod | null } => choice === "owed" ? { paidAmount: 0, paymentMethod: null } : { paymentMethod: choice };

/** Pill buttons to pick how a sale is paid. */
export function PaymentPicker({ value, onChange, choices = [...PAYMENT_METHODS, "owed"], label = "Pago" }: { value: PaymentChoice; onChange: (value: PaymentChoice) => void; choices?: PaymentChoice[]; label?: string }) {
  return <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
    {choices.map((choice) => <button key={choice} type="button" role="radio" aria-checked={value === choice} onClick={() => onChange(choice)}
      className={cn("rounded-full border px-3 py-1 text-xs transition-colors", value === choice ? choice === "owed" ? "border-amber-500 bg-amber-500 text-white" : "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>{PAYMENT_CHOICE_LABELS[choice]}</button>)}
  </div>;
}

/** Whether a sale is collected: green when paid, amber with what is owed. Opens the collection when clickable. */
export function PaymentBadge({ sale, money, onClick, className }: { sale: Pick<Sale, "totalMinor" | "paidMinor" | "paymentMethod">; money: (value: number) => string; onClick?: () => void; className?: string }) {
  const { status, owedMinor } = salePayment(sale);
  const label = status === "paid" ? sale.paymentMethod ? PAYMENT_METHOD_LABELS[sale.paymentMethod] : "Cobrada" : status === "partial" ? `Debe ${money(owedMinor)}` : `Por cobrar ${money(owedMinor)}`;
  const tone = status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300"
    : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200";
  const content = <><span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", status === "paid" ? "bg-emerald-500" : "bg-amber-500")} />{label}</>;
  const classes = cn("inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums", tone, className);
  return onClick
    ? <button type="button" onClick={onClick} className={cn(classes, "hover:opacity-80")} aria-label={`${status === "paid" ? `Cobrada${sale.paymentMethod ? ` en ${PAYMENT_METHOD_LABELS[sale.paymentMethod].toLowerCase()}` : ""}` : label}: ${status === "paid" ? "cambiar el cobro" : "registrar el cobro"}`} title={status === "paid" ? "Cobrada: tocá para cambiarla" : "Registrar el cobro"}>{content}</button>
    : <span className={classes}>{content}</span>;
}

/** Registers what a customer paid of a sale: all of it, a part, or that it is not collected after all. */
export function PaymentDialog({ sale, money, onClose, onSave }: { sale: Sale; money: (value: number) => string; onClose: () => void; onSave: (patch: SalePatch, message: string) => Promise<boolean> }) {
  const { status, owedMinor } = salePayment(sale);
  const [method, setMethod] = React.useState<PaymentMethod>(sale.paymentMethod ?? "cash");
  const [part, setPart] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const save = async (patch: SalePatch, message: string) => {
    setBusy(true);
    try { if (await onSave(patch, message)) onClose(); } finally { setBusy(false); }
  };
  const amount = Number(part);
  const validPart = part.trim() !== "" && amount > 0 && amount < owedMinor;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>Cobro de la venta</DialogTitle>
      <DialogDescription>Venta del {sale.soldOn.slice(8, 10)}/{sale.soldOn.slice(5, 7)}{sale.customer ? ` a ${sale.customer}` : ""} por {sale.channelName}.</DialogDescription>
    </DialogHeader>
    <dl className="grid grid-cols-3 gap-2 text-sm">
      <div className="rounded-lg bg-muted/60 px-3 py-2"><dt className="text-xs text-muted-foreground">Total</dt><dd className="font-semibold tabular-nums">{money(sale.totalMinor)}</dd></div>
      <div className="rounded-lg bg-muted/60 px-3 py-2"><dt className="text-xs text-muted-foreground">Cobrado</dt><dd className="font-semibold tabular-nums">{money(sale.paidMinor)}</dd></div>
      <div className={cn("rounded-lg px-3 py-2", owedMinor ? "bg-amber-50 dark:bg-amber-500/10" : "bg-muted/60")}><dt className="text-xs text-muted-foreground">Debe</dt><dd className="font-semibold tabular-nums">{money(owedMinor)}</dd></div>
    </dl>
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Cómo pagó</span>
      <PaymentPicker value={method} onChange={(value) => { if (value !== "owed") setMethod(value); }} choices={[...PAYMENT_METHODS]} label="Cómo pagó" />
    </div>
    {status !== "paid" ? <div className="flex flex-col gap-2">
      <Button type="button" disabled={busy} onClick={() => void save({ markPaid: true, paymentMethod: method }, "Venta cobrada")}>Cobró todo · {money(owedMinor)}</Button>
      <div className="flex items-center gap-2">
        <Input type="number" min="0" step="any" inputMode="decimal" value={part} onChange={(event) => setPart(event.target.value)} placeholder="Pagó una parte" aria-label="Monto que pagó ahora" className="h-9" />
        <Button type="button" variant="outline" disabled={busy || !validPart} onClick={() => void save({ paidAmount: sale.paidMinor + amount, paymentMethod: method }, `Pago de ${money(amount)} registrado`)}>Registrar pago</Button>
      </div>
      {part.trim() !== "" && amount >= owedMinor ? <p className="text-xs text-muted-foreground">Si pagó {money(owedMinor)} o más, usá «Cobró todo».</p> : null}
    </div> : <p className="text-sm text-muted-foreground">Esta venta está cobrada{sale.paidOn ? ` desde el ${sale.paidOn.slice(8, 10)}/${sale.paidOn.slice(5, 7)}` : ""}.</p>}
    <DialogFooter className="flex-row flex-wrap justify-between gap-2 sm:justify-between">
      {sale.paidMinor > 0 ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void save({ paidAmount: 0 }, "La venta quedó por cobrar")}>No está cobrada</Button> : <span />}
      <div className="flex gap-2">
        {status === "paid" && method !== sale.paymentMethod ? <Button type="button" variant="outline" disabled={busy} onClick={() => void save({ paymentMethod: method }, "Medio de pago actualizado")}>Guardar medio de pago</Button> : null}
        <Button type="button" variant="outline" onClick={onClose}>Cerrar</Button>
      </div>
    </DialogFooter>
  </DialogContent></Dialog>;
}
