"use client";

import * as React from "react";
import { toast } from "sonner";
import { AREA_LABELS, PURCHASE_KIND_HINTS, PURCHASE_KIND_LABELS, type PurchaseKind } from "@/lib/business";
import type { CostArea, DomainState } from "@/lib/domain";
import { AnimatedIcon } from "@/components/animated-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";
import { MonthPicker, ReceiptLink, SectionHeader, Stat, Tip, businessAction, formatDate, todayIso, uploadDocument, useBusinessView, useMoney } from "./business-ui";

const KINDS: PurchaseKind[] = ["material", "expense", "fixed_payment", "investment"];
const AREAS: CostArea[] = ["production", "delivery", "sales", "admin"];

export function PurchasesSection({ state, demo, month, onMonthChange, onOpenCozte, onDataChanged }: { state: DomainState; demo: boolean; month: string; onMonthChange: (month: string) => void; onOpenCozte: () => void; onDataChanged: () => Promise<void> }) {
  const { view, loading, reload } = useBusinessView(month, demo, state);
  const money = useMoney(state.organization.currency);
  const [open, setOpen] = React.useState(false);
  const purchases = view?.purchases ?? [];
  const byKind = (kind: PurchaseKind) => purchases.filter((item) => item.kind === kind).reduce((sum, item) => sum + item.amountMinor, 0);

  async function archive(id: string) {
    if (demo) { toast.info("Demostración: los cambios no se guardan"); return; }
    try { await businessAction({ action: "archive", kind: "purchase", id }); toast.success("Compra anulada"); reload(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo anular"); }
  }

  return <>
    <SectionHeader eyebrow="Día a día" title="Compras" description="Todo lo que compras, con su comprobante. Mándale a Cozte la foto del ticket o factura y la registra y clasifica por ti.">
      <Button variant="outline" onClick={onOpenCozte}><AnimatedIcon name="assistant" data-icon="inline-start" />Enviar ticket a Cozte</Button>
      <Button onClick={() => setOpen(true)}><AnimatedIcon name="plus" data-icon="inline-start" />Registrar compra</Button>
    </SectionHeader>
    <div className="flex justify-end"><MonthPicker month={month} onChange={onMonthChange} /></div>
    {!view ? <TextShimmer className="text-sm">Cargando compras…</TextShimmer> : <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Total comprado" value={money(purchases.reduce((sum, item) => sum + item.amountMinor, 0))} note={`${purchases.length} compra${purchases.length === 1 ? "" : "s"}`} />
        {KINDS.map((kind) => <Stat key={kind} label={PURCHASE_KIND_LABELS[kind]} value={money(byKind(kind))} />)}
      </div>
      <Card>
        <CardHeader><CardTitle>Compras del mes</CardTitle><CardDescription>Cada compra tiene un tipo y un área: así se sabe si es costo del producto, gasto del mes o una inversión.</CardDescription></CardHeader>
        <CardContent>{purchases.length ? <div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Qué se compró</TableHead><TableHead>Tipo</TableHead><TableHead>Área</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>Comprobante</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
          <TableBody>{purchases.map((purchase) => <TableRow key={purchase.id}>
            <TableCell className="whitespace-nowrap">{formatDate(purchase.purchasedOn)}</TableCell>
            <TableCell className="font-medium">{purchase.description}<div className="text-xs font-normal text-muted-foreground">{[
              purchase.supplier,
              purchase.kind === "material" && purchase.materialName ? `${purchase.materialName}${purchase.quantityMilli ? ` · ${purchase.quantityMilli / 1000} u.` : ""}` : null,
              purchase.kind === "fixed_payment" && purchase.expenseName ? `Paga: ${purchase.expenseName}` : null,
              purchase.kind === "investment" && purchase.usefulLifeMonths ? `${money(purchase.amountMinor / purchase.usefulLifeMonths)} por mes durante ${purchase.usefulLifeMonths} meses${purchase.includeInUnitCost ? ", sumado al costo de cada producto" : ""}` : null,
              purchase.source === "cozte" ? "Registrada por Cozte" : null,
            ].filter(Boolean).join(" · ")}</div></TableCell>
            <TableCell><Badge variant="outline" title={PURCHASE_KIND_HINTS[purchase.kind]}>{PURCHASE_KIND_LABELS[purchase.kind]}</Badge></TableCell>
            <TableCell className="text-muted-foreground">{AREA_LABELS[purchase.area]}</TableCell>
            <TableCell className="text-right tabular-nums">{money(purchase.amountMinor)}</TableCell>
            <TableCell><ReceiptLink documentId={purchase.documentId} demo={demo} /></TableCell>
            <TableCell><Button size="icon-sm" variant="ghost" aria-label={`Anular ${purchase.description}`} onClick={() => void archive(purchase.id)}><AnimatedIcon name="delete" /></Button></TableCell>
          </TableRow>)}</TableBody>
        </Table></div> : <Empty className="py-6"><EmptyHeader><EmptyTitle>No hay compras este mes</EmptyTitle><EmptyDescription>Regístralas acá o mándale a Cozte la foto del ticket.</EmptyDescription></EmptyHeader></Empty>}</CardContent>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        {KINDS.map((kind) => <Tip key={kind} title={PURCHASE_KIND_LABELS[kind]}>{PURCHASE_KIND_HINTS[kind]}</Tip>)}
      </div>
    </div>}
    {open ? <PurchaseDialog state={state} demo={demo} month={month} onClose={() => setOpen(false)} onSaved={async () => { setOpen(false); reload(); await onDataChanged().catch(() => {}); }} /> : null}
  </>;
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
    if (demo) { toast.info("Demostración: los cambios no se guardan"); return; }
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    setBusy(true);
    try {
      const documentId = file ? await uploadDocument(file) : undefined;
      await businessAction({ action: "record-purchase", idempotencyKey, purchase: {
        purchasedOn: text("date"), description: text("description"), supplier: text("supplier"), amount: Number(text("amount")), kind,
        ...(areaLocked ? {} : { area }),
        ...(kind === "material" ? { materialId: text("material"), ...(text("quantity") ? { quantity: Number(text("quantity")) } : {}), updateMaterialPrice: data.get("updatePrice") === "on" } : {}),
        ...(kind === "fixed_payment" ? { expenseId: text("expense") } : {}),
        ...(kind === "investment" ? { usefulLifeMonths: Number(text("life")), ...(area === "production" ? { includeInUnitCost: data.get("includeInUnitCost") === "on" } : {}) } : {}),
        documentId,
      } });
      toast.success("Compra registrada");
      onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo registrar"); }
    finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={(value) => { if (!value) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>Registrar compra</DialogTitle><DialogDescription>Montos en {currency}. Si tienes el ticket, adjúntalo: queda guardado con la compra.</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={submit}><FieldGroup>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="purchase-date">Fecha</FieldLabel><Input id="purchase-date" name="date" type="date" required defaultValue={defaultDate} /></Field>
        <Field><FieldLabel htmlFor="purchase-amount">Total pagado</FieldLabel><Input id="purchase-amount" name="amount" type="number" min="0" step="0.01" required /></Field>
      </div>
      <Field><FieldLabel htmlFor="purchase-description">Qué compraste</FieldLabel><Input id="purchase-description" name="description" required minLength={2} placeholder="Ej. Cinta de embalaje" /></Field>
      <Field><FieldLabel htmlFor="purchase-supplier">Dónde o a quién</FieldLabel><Input id="purchase-supplier" name="supplier" placeholder="Opcional" /></Field>
      <Field><FieldLabel htmlFor="purchase-kind">¿Qué tipo de compra es?</FieldLabel>
        <NativeSelect id="purchase-kind" className="w-full" value={kind} onChange={(event) => setKind(event.target.value as PurchaseKind)}>{KINDS.map((item) => <NativeSelectOption key={item} value={item} disabled={(item === "material" && !state.materials.length) || (item === "fixed_payment" && !activeExpenses.length)}>{PURCHASE_KIND_LABELS[item]}</NativeSelectOption>)}</NativeSelect>
        <FieldDescription>{PURCHASE_KIND_HINTS[kind]}</FieldDescription>
      </Field>
      {kind === "material" ? <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="purchase-material">Insumo</FieldLabel><NativeSelect id="purchase-material" name="material" className="w-full">{state.materials.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name} ({item.purchaseUnit})</NativeSelectOption>)}</NativeSelect></Field>
        <Field><FieldLabel htmlFor="purchase-quantity">Cantidad comprada</FieldLabel><Input id="purchase-quantity" name="quantity" type="number" min="0.001" step="0.001" placeholder="En su unidad de compra" /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="updatePrice" defaultChecked className="size-4" />Actualizar el precio del insumo con esta compra</label>
      </div> : null}
      {kind === "fixed_payment" ? <Field><FieldLabel htmlFor="purchase-expense">Gasto mensual que pagaste</FieldLabel><NativeSelect id="purchase-expense" name="expense" className="w-full">{activeExpenses.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name} ({AREA_LABELS[item.area ?? "production"]})</NativeSelectOption>)}</NativeSelect></Field> : null}
      {kind === "investment" ? <Field><FieldLabel htmlFor="purchase-life">¿Cuántos meses la vas a usar?</FieldLabel><Input id="purchase-life" name="life" type="number" min="1" max="600" step="1" required defaultValue={36} /><FieldDescription>Como referencia: 36 meses para tecnología, 60 para máquinas y herramientas.</FieldDescription></Field> : null}
      {!areaLocked ? <Field><FieldLabel htmlFor="purchase-area">Área</FieldLabel><NativeSelect id="purchase-area" className="w-full" value={area} onChange={(event) => setArea(event.target.value as CostArea)}>{AREAS.map((item) => <NativeSelectOption key={item} value={item}>{AREA_LABELS[item]}</NativeSelectOption>)}</NativeSelect></Field> : null}
      {kind === "investment" && area === "production" ? <Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="includeInUnitCost" className="size-4" />Sumar su parte mensual al costo de cada producto</label>
        <FieldDescription>Conviene si se usa para producir y habrá que reemplazarla: así tu precio paga su desgaste. Si no, cuenta solo en el resultado del mes. Puedes cambiarlo después en Gastos de la empresa.</FieldDescription>
      </Field> : null}
      <Field><FieldLabel htmlFor="purchase-receipt">Comprobante</FieldLabel><Input id="purchase-receipt" type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><FieldDescription>Foto o PDF de hasta 4 MB. Opcional.</FieldDescription></Field>
    </FieldGroup>
    <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Registrar compra"}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
