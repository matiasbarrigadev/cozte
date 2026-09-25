"use client";

import * as React from "react";
import { toast } from "sonner";
import { DIRECT_CHANNEL, channelPrice, type ChannelEconomics, type SalesChannel } from "@/lib/business";
import type { DomainState } from "@/lib/domain";
import { AnimatedIcon } from "@/components/animated-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";
import { MonthPicker, ReceiptLink, SectionHeader, Tip, businessAction, formatDate, todayIso, uploadDocument, useBusinessView, useMoney } from "./business-ui";

const percent = (bps: number) => `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(bps / 100)} %`;

export function SalesSection({ state, demo, month, onMonthChange, onOpenCozte }: { state: DomainState; demo: boolean; month: string; onMonthChange: (month: string) => void; onOpenCozte: () => void }) {
  const { view, loading, reload } = useBusinessView(month, demo, state);
  const money = useMoney(state.organization.currency);
  const [channelDialog, setChannelDialog] = React.useState<SalesChannel | "new" | null>(null);
  const [saleOpen, setSaleOpen] = React.useState(false);

  async function archive(kind: "channel" | "sale", id: string) {
    if (demo) { toast.info("Demostración: los cambios no se guardan"); return; }
    try { await businessAction({ action: "archive", kind, id }); toast.success(kind === "channel" ? "Canal quitado" : "Venta anulada"); reload(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo quitar"); }
  }

  const byProduct = new Map<string, ChannelEconomics[]>();
  for (const row of view?.economics ?? []) byProduct.set(row.productId, [...byProduct.get(row.productId) ?? [], row]);
  const sales = view?.sales ?? [];
  const totals = sales.reduce((sum, sale) => ({ total: sum.total + sale.totalMinor, costs: sum.costs + sale.sellingCostMinor + sale.deliveryCostMinor, left: sum.left + (sale.variableCostMinor === null ? 0 : sale.totalMinor - sale.variableCostMinor - sale.sellingCostMinor - sale.deliveryCostMinor) }), { total: 0, costs: 0, left: 0 });

  return <>
    <SectionHeader eyebrow="Vender y entregar" title="Ventas y entregas" description="Cada forma de vender tiene sus propios costos: comisiones, cargos y lo que cuesta entregar. Acá ves cuánto te queda de cada unidad en cada canal y las ventas del mes.">
      <Button variant="outline" onClick={() => setChannelDialog("new")}><AnimatedIcon name="plus" data-icon="inline-start" />Agregar canal</Button>
      <Button onClick={() => setSaleOpen(true)}><AnimatedIcon name="plus" data-icon="inline-start" />Registrar venta</Button>
    </SectionHeader>
    {!view ? <TextShimmer className="text-sm">Cargando ventas…</TextShimmer> : <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
      <Card>
        <CardHeader><CardTitle>Tus canales de venta</CardTitle><CardDescription>Dónde y cómo vendes. Si no cargas ninguno, las ventas se toman como venta directa, sin comisión ni envío.</CardDescription></CardHeader>
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

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5"><CardTitle>Ventas del mes</CardTitle><CardDescription>Cada venta guarda su precio y sus costos del momento, con su remito o factura.</CardDescription></div>
          <MonthPicker month={month} onChange={onMonthChange} />
        </CardHeader>
        <CardContent>{sales.length ? <div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Canal</TableHead><TableHead>Productos</TableHead><TableHead className="text-right">Cobrado</TableHead><TableHead className="text-right">Vender y entregar</TableHead><TableHead className="text-right">Te dejó</TableHead><TableHead>Remito</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
          <TableBody>{sales.map((sale) => {
            const left = sale.variableCostMinor === null ? null : sale.totalMinor - sale.variableCostMinor - sale.sellingCostMinor - sale.deliveryCostMinor;
            return <TableRow key={sale.id}>
              <TableCell className="whitespace-nowrap">{formatDate(sale.soldOn)}</TableCell>
              <TableCell>{sale.channelName}{sale.customer ? <div className="text-xs text-muted-foreground">{sale.customer}</div> : null}</TableCell>
              <TableCell className="text-sm">{sale.items.map((item) => `${new Intl.NumberFormat("es-AR").format(item.quantityMilli / 1000)} × ${item.productName}`).join(", ")}</TableCell>
              <TableCell className="text-right tabular-nums">{money(sale.totalMinor)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{money(sale.sellingCostMinor + sale.deliveryCostMinor)}</TableCell>
              <TableCell className={cn("text-right font-medium tabular-nums", left !== null && left < 0 && "text-destructive")}>{left === null ? <span className="text-xs text-muted-foreground">Costo incompleto</span> : money(left)}</TableCell>
              <TableCell><ReceiptLink documentId={sale.documentId} demo={demo} /></TableCell>
              <TableCell><Button size="icon-sm" variant="ghost" aria-label="Anular venta" onClick={() => void archive("sale", sale.id)}><AnimatedIcon name="delete" /></Button></TableCell>
            </TableRow>;
          })}</TableBody>
          <TableFooter><TableRow><TableCell colSpan={3}>Total del mes · {sales.length} venta{sales.length === 1 ? "" : "s"}</TableCell><TableCell className="text-right tabular-nums">{money(totals.total)}</TableCell><TableCell className="text-right tabular-nums">{money(totals.costs)}</TableCell><TableCell className="text-right tabular-nums">{money(totals.left)}</TableCell><TableCell colSpan={2} /></TableRow></TableFooter>
        </Table></div> : <Empty className="py-6"><EmptyHeader><EmptyTitle>No hay ventas registradas este mes</EmptyTitle><EmptyDescription>Regístralas acá o mándale a Cozte la foto del remito o factura.</EmptyDescription></EmptyHeader><Button variant="outline" onClick={onOpenCozte}>Enviar un remito a Cozte</Button></Empty>}
          {sales.length ? <p className="mt-3 text-xs text-muted-foreground">&quot;Te dejó&quot; es lo cobrado menos insumos, mano de obra, comisiones y envío: lo que cada venta aporta para pagar los gastos fijos del mes.</p> : null}
        </CardContent>
      </Card>
    </div>}
    {channelDialog ? <ChannelDialog channel={channelDialog === "new" ? null : channelDialog} demo={demo} onClose={() => setChannelDialog(null)} onSaved={() => { setChannelDialog(null); reload(); }} /> : null}
    {saleOpen && view ? <SaleDialog state={state} channels={view.channels} demo={demo} month={month} onClose={() => setSaleOpen(false)} onSaved={() => { setSaleOpen(false); reload(); }} /> : null}
  </>;
}

function ChannelDialog({ channel, demo, onClose, onSaved }: { channel: SalesChannel | null; demo: boolean; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = React.useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo) { toast.info("Demostración: los cambios no se guardan"); return; }
    const data = new FormData(event.currentTarget);
    const number = (name: string) => Number(data.get(name) || 0);
    setBusy(true);
    try {
      await businessAction({ action: "save-channel", channel: {
        id: channel?.id, name: String(data.get("name") ?? "").trim(), deliveryMethod: String(data.get("deliveryMethod") ?? "").trim(),
        commissionPercent: number("commission"), feePerOrder: number("fee"), deliveryCostPerOrder: number("delivery"),
        unitsPerOrder: number("units") || 1, priceAdjustmentPercent: number("adjustment"),
      } });
      toast.success(channel ? "Canal actualizado" : "Canal creado");
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

function SaleDialog({ state, channels, demo, month, onClose, onSaved }: { state: DomainState; channels: SalesChannel[]; demo: boolean; month: string; onClose: () => void; onSaved: () => void }) {
  const money = useMoney(state.organization.currency);
  const idempotencyKey = React.useMemo(() => crypto.randomUUID(), []);
  const [channelId, setChannelId] = React.useState(channels[0]?.id ?? DIRECT_CHANNEL.id);
  const [lines, setLines] = React.useState<Line[]>([{ key: 0, productId: state.products[0]?.id ?? "", quantity: "1", price: "" }]);
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const channel = channels.find((item) => item.id === channelId) ?? DIRECT_CHANNEL;
  const defaultDate = todayIso().startsWith(month) ? todayIso() : `${month}-01`;
  const update = (key: number, change: Partial<Line>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...change } : line));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo) { toast.info("Demostración: los cambios no se guardan"); return; }
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const documentId = file ? await uploadDocument(file) : undefined;
      const delivery = String(data.get("delivery") ?? "").trim();
      await businessAction({ action: "record-sale", idempotencyKey, sale: {
        soldOn: String(data.get("date")), channelId: channel.id === DIRECT_CHANNEL.id ? null : channel.id,
        items: lines.filter((line) => line.productId && Number(line.quantity) > 0).map((line) => ({ productId: line.productId, quantity: Number(line.quantity), ...(line.price ? { unitPrice: Number(line.price) } : {}) })),
        ...(delivery ? { deliveryCost: Number(delivery) } : {}), customer: String(data.get("customer") ?? "").trim(), documentId,
      } });
      toast.success("Venta registrada");
      onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo registrar"); }
    finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>Registrar venta</DialogTitle><DialogDescription>Si no escribes el precio se usa el de lista con el ajuste del canal. También puedes mandarle a Cozte la foto del remito.</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={submit}><FieldGroup>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="sale-date">Fecha</FieldLabel><Input id="sale-date" name="date" type="date" required defaultValue={defaultDate} /></Field>
        <Field><FieldLabel htmlFor="sale-channel">Canal</FieldLabel><NativeSelect id="sale-channel" className="w-full" value={channelId} onChange={(event) => setChannelId(event.target.value)}>{channels.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}<NativeSelectOption value={DIRECT_CHANNEL.id}>{DIRECT_CHANNEL.name}</NativeSelectOption></NativeSelect></Field>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Productos</span>
        {lines.map((line) => {
          const product = state.products.find((item) => item.id === line.productId);
          const listPrice = product ? channelPrice(product, channel) : null;
          return <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_6rem_8rem_auto] items-center gap-2">
            <NativeSelect aria-label="Producto" className="w-full" value={line.productId} onChange={(event) => update(line.key, { productId: event.target.value })}>{state.products.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect>
            <Input aria-label="Cantidad" type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(event) => update(line.key, { quantity: event.target.value })} />
            <Input aria-label="Precio por unidad" type="number" min="0" step="1" value={line.price} placeholder={listPrice === null ? "Precio" : money(listPrice)} onChange={(event) => update(line.key, { price: event.target.value })} />
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Quitar producto" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}><AnimatedIcon name="close" /></Button>
          </div>;
        })}
        <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setLines((current) => [...current, { key: Date.now(), productId: state.products[0]?.id ?? "", quantity: "1", price: "" }])}><AnimatedIcon name="plus" data-icon="inline-start" />Otro producto</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="sale-delivery">Costo de entrega</FieldLabel><Input id="sale-delivery" name="delivery" type="number" min="0" step="1" placeholder={money(channel.deliveryCostPerOrderMinor)} /><FieldDescription>Déjalo vacío para usar el habitual del canal.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="sale-customer">Cliente</FieldLabel><Input id="sale-customer" name="customer" placeholder="Opcional" /></Field>
      </div>
      <Field><FieldLabel htmlFor="sale-receipt">Remito o factura</FieldLabel><Input id="sale-receipt" type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><FieldDescription>PDF o imagen de hasta 4 MB. Opcional.</FieldDescription></Field>
    </FieldGroup>
    <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy || !state.products.length}>{busy ? "Guardando…" : "Registrar venta"}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
