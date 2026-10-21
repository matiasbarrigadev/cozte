"use client";

import * as React from "react";
import { toast } from "sonner";
import { DIRECT_CHANNEL, saleVariableCost, type ChannelEconomics, type SalesChannel } from "@/lib/business";
import { calculateCosts, type DomainState } from "@/lib/domain";
import { AnimatedIcon } from "@/components/animated-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";
import { MonthPicker, SectionHeader, Tip, businessAction, notifySaved, todayFor, useBusinessView, useMoney } from "./business-ui";
import { monthName } from "./data-table";

const percent = (bps: number) => `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(bps / 100)} %`;

/**
 * Where and to whom the business sells: each channel's rules (commission, fees, delivery, price), how each one sold
 * in the month and what each product leaves in each channel. Kept apart from Ventas, which is for the day's work.
 */
export function ChannelsSection({ state, demo, month, onMonthChange, onOpenCozte, onDataChanged }: { state: DomainState; demo: boolean; month: string; onMonthChange: (month: string) => void; onOpenCozte: () => void; onDataChanged?: () => void }) {
  const { view, loading, reload } = useBusinessView(month, demo, state);
  const money = useMoney(state.organization.currency);
  const [dialog, setDialog] = React.useState<SalesChannel | "new" | null>(null);
  const costs = React.useMemo(() => calculateCosts(state), [state]);

  async function archive(channel: SalesChannel) {
    try { await businessAction({ action: "archive", kind: "channel", id: channel.id }, demo); notifySaved("Canal quitado"); reload(); onDataChanged?.(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo quitar"); }
  }

  const byProduct = new Map<string, ChannelEconomics[]>();
  for (const row of view?.economics ?? []) byProduct.set(row.productId, [...byProduct.get(row.productId) ?? [], row]);
  // How each channel sold in the month: sales, revenue and what they left after their own costs.
  const performance = React.useMemo(() => {
    const rows = new Map<string, { id: string; name: string; sales: number; revenue: number; left: number }>();
    for (const sale of view?.sales ?? []) {
      const id = sale.channelId ?? DIRECT_CHANNEL.id;
      const row = rows.get(id) ?? { id, name: sale.channelName || DIRECT_CHANNEL.name, sales: 0, revenue: 0, left: 0 };
      row.sales += 1;
      row.revenue += sale.totalMinor;
      row.left += sale.totalMinor - saleVariableCost(sale, costs, state.organization.currency).amount - sale.sellingCostMinor - sale.deliveryCostMinor;
      rows.set(id, row);
    }
    return [...rows.values()].sort((a, b) => b.revenue - a.revenue);
  }, [view?.sales, costs, state.organization.currency]);
  const revenue = performance.reduce((sum, row) => sum + row.revenue, 0);

  return <>
    <SectionHeader eyebrow="Vender" title="Canales" description="Dónde y a quién vendés: el local, ferias, redes, plataformas o mayoristas. Cada canal tiene su comisión, su costo de entrega y su precio, y eso cambia cuánto te deja cada venta.">
      <Button onClick={() => setDialog("new")}><AnimatedIcon name="plus" data-icon="inline-start" />Agregar canal</Button>
    </SectionHeader>
    {!view ? <TextShimmer className="text-sm">Cargando canales…</TextShimmer> : <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
      <Card>
        <CardHeader><CardTitle>Tus canales de venta</CardTitle><CardDescription>Si no cargas ninguno, las ventas se toman como venta directa, sin comisión ni envío. La forma y el costo de entregar de cada canal se ajustan también en Entregas.</CardDescription></CardHeader>
        <CardContent>{view.channels.length ? <><ul className="flex flex-col divide-y md:hidden" aria-label="Canales de venta">{view.channels.map((channel) => <li key={channel.id} className="flex flex-col gap-1.5 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><p className="font-medium">{channel.name}</p><p className="text-xs text-muted-foreground">{channel.deliveryMethod || "Sin entrega"}{channel.priceAdjustmentBps ? ` · precio ${channel.priceAdjustmentBps > 0 ? "+" : ""}${percent(channel.priceAdjustmentBps)}` : " · precio de lista"}</p></div>
            <div className="flex shrink-0 gap-1"><Button size="icon-sm" variant="ghost" aria-label={`Editar ${channel.name}`} onClick={() => setDialog(channel)}><AnimatedIcon name="edit" /></Button><Button size="icon-sm" variant="ghost" aria-label={`Quitar ${channel.name}`} onClick={() => void archive(channel)}><AnimatedIcon name="delete" /></Button></div>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div><dt className="text-muted-foreground">Comisión</dt><dd className="tabular-nums">{percent(channel.commissionBps)}</dd></div>
            <div><dt className="text-muted-foreground">Cargo por venta</dt><dd className="tabular-nums">{money(channel.feePerOrderMinor)}</dd></div>
            <div><dt className="text-muted-foreground">Entregar</dt><dd className="tabular-nums">{money(channel.deliveryCostPerOrderMinor)}</dd></div>
          </dl>
        </li>)}</ul><div className="hidden overflow-x-auto md:block"><Table>
          <TableHeader><TableRow><TableHead>Canal</TableHead><TableHead>Cómo entrega</TableHead><TableHead className="text-right">Comisión</TableHead><TableHead className="text-right">Cargo por venta</TableHead><TableHead className="text-right">Entregar un pedido</TableHead><TableHead className="text-right">Unidades por pedido</TableHead><TableHead className="text-right">Precio</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
          <TableBody>{view.channels.map((channel) => <TableRow key={channel.id}>
            <TableCell className="font-medium">{channel.name}</TableCell>
            <TableCell className="text-muted-foreground">{channel.deliveryMethod || "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{percent(channel.commissionBps)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(channel.feePerOrderMinor)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(channel.deliveryCostPerOrderMinor)}</TableCell>
            <TableCell className="text-right tabular-nums">{new Intl.NumberFormat("es-AR").format(channel.unitsPerOrderMilli / 1000)}</TableCell>
            <TableCell className="text-right">{channel.priceAdjustmentBps ? <Badge variant="outline">{channel.priceAdjustmentBps > 0 ? "+" : ""}{percent(channel.priceAdjustmentBps)}</Badge> : <span className="text-muted-foreground">De lista</span>}</TableCell>
            <TableCell className="text-right"><div className="flex justify-end gap-1"><Button size="icon-sm" variant="ghost" aria-label={`Editar ${channel.name}`} onClick={() => setDialog(channel)}><AnimatedIcon name="edit" /></Button><Button size="icon-sm" variant="ghost" aria-label={`Quitar ${channel.name}`} onClick={() => void archive(channel)}><AnimatedIcon name="delete" /></Button></div></TableCell>
          </TableRow>)}</TableBody>
        </Table></div></> : <Empty className="py-6"><EmptyHeader><EmptyTitle>Todavía no hay canales</EmptyTitle><EmptyDescription>Agrega los lugares donde vendes (local, ferias, Instagram, Mercado Libre, mayoristas) o cuéntaselos a Cozte.</EmptyDescription></EmptyHeader><Button variant="outline" onClick={onOpenCozte}>Contarle a Cozte por dónde vendo</Button></Empty>}</CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5"><CardTitle>Cómo vendió cada canal</CardTitle><CardDescription>Lo vendido en {monthName(month)} por cada canal y lo que te dejó después de producir, vender y entregar.</CardDescription></div>
          <MonthPicker month={month} today={todayFor(demo)} onChange={onMonthChange} />
        </CardHeader>
        <CardContent>{performance.length ? <div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Canal</TableHead><TableHead className="text-right">Ventas</TableHead><TableHead className="text-right">Vendido</TableHead><TableHead className="text-right">Parte de lo vendido</TableHead><TableHead className="text-right">Te dejó</TableHead></TableRow></TableHeader>
          <TableBody>{performance.map((row) => <TableRow key={row.id}>
            <TableCell className="font-medium">{row.name}</TableCell>
            <TableCell className="text-right tabular-nums">{row.sales}</TableCell>
            <TableCell className="text-right tabular-nums">{money(row.revenue)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{revenue ? `${Math.round(row.revenue / revenue * 100)} %` : "—"}</TableCell>
            <TableCell className={cn("text-right font-semibold tabular-nums", row.left < 0 && "text-destructive")}>{money(row.left)}</TableCell>
          </TableRow>)}</TableBody>
          <TableFooter><TableRow><TableCell>Total</TableCell><TableCell className="text-right tabular-nums">{performance.reduce((sum, row) => sum + row.sales, 0)}</TableCell><TableCell className="text-right tabular-nums">{money(revenue)}</TableCell><TableCell /><TableCell className="text-right tabular-nums">{money(performance.reduce((sum, row) => sum + row.left, 0))}</TableCell></TableRow></TableFooter>
        </Table></div> : <p className="text-sm text-muted-foreground">No hay ventas registradas en {monthName(month)}.</p>}</CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cuánto te queda por unidad</CardTitle><CardDescription>Precio de cada producto en cada canal, menos lo que cuesta producirlo, venderlo y entregarlo.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state.products.length ? [...byProduct.values()].map((rows) => <div key={rows[0].productId} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{rows[0].productName}</h3>
            <ul className="flex flex-col divide-y rounded-lg border md:hidden">{rows.map((row) => <li key={row.channelId} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0"><p className="text-sm">{row.channelName}</p><p className="text-xs text-muted-foreground tabular-nums">{row.price === null ? "Sin precio" : money(row.price)} − producir {row.productionCost === null ? "incompleto" : money(row.productionCost)}{row.sellingCost ? ` − vender ${money(row.sellingCost)}` : ""}{row.deliveryCost ? ` − entregar ${money(row.deliveryCost)}` : ""}</p></div>
              <p className={cn("shrink-0 text-right text-sm font-semibold tabular-nums", row.left !== null && row.left < 0 && "text-destructive")}>{row.left === null ? "—" : money(row.left)}<span className="block text-[11px] font-normal text-muted-foreground">{row.leftPercent !== null ? `te queda ${Math.round(row.leftPercent)} %` : "te queda"}</span></p>
            </li>)}</ul>
            <div className="hidden overflow-x-auto md:block"><Table>
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
    {dialog ? <ChannelDialog channel={dialog === "new" ? null : dialog} demo={demo} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); reload(); onDataChanged?.(); }} /> : null}
  </>;
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
        <Field><FieldLabel htmlFor="channel-fee">Cargo fijo por venta</FieldLabel><Input id="channel-fee" name="fee" type="number" min="0" step="any" inputMode="decimal" defaultValue={channel?.feePerOrderMinor ?? 0} /></Field>
        <Field><FieldLabel htmlFor="channel-delivery-cost">Te cuesta entregar un pedido</FieldLabel><Input id="channel-delivery-cost" name="delivery" type="number" min="0" step="any" inputMode="decimal" defaultValue={channel?.deliveryCostPerOrderMinor ?? 0} /><FieldDescription>Combustible, correo o repartidor.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="channel-units">Unidades por pedido</FieldLabel><Input id="channel-units" name="units" type="number" min="0.001" step="0.001" defaultValue={channel ? channel.unitsPerOrderMilli / 1000 : 1} /><FieldDescription>En promedio; reparte el envío entre las unidades.</FieldDescription></Field>
      </div>
      <Field><FieldLabel htmlFor="channel-adjustment">Precio frente al de lista (%)</FieldLabel><Input id="channel-adjustment" name="adjustment" type="number" min="-90" max="100" step="0.5" defaultValue={channel ? channel.priceAdjustmentBps / 100 : 0} /><FieldDescription>0 si cobras el precio de lista; -30 si al mayorista le vendes 30 % más barato.</FieldDescription></Field>
    </FieldGroup>
    <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar canal"}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
