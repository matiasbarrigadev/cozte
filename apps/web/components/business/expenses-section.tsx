"use client";

import * as React from "react";
import { toast } from "sonner";
import { AREA_HINTS, AREA_LABELS } from "@/lib/business";
import { behaviorTag } from "@/lib/break-even";
import type { CostArea, DomainState, SharedExpense } from "@/lib/domain";
import { AnimatedIcon } from "@/components/animated-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";
import { ReceiptLink, SectionHeader, Stat, Tip, todayIso, useBusinessView, useMoney } from "./business-ui";

type Save = (action: Record<string, unknown>, quiet?: boolean) => Promise<boolean>;
const COMPANY_AREAS: CostArea[] = ["delivery", "sales", "admin"];

export function ExpensesSection({ state, demo, month, onSave, onOpenProduction, onOpenPurchases }: { state: DomainState; demo: boolean; month: string; onSave: Save; onOpenProduction: () => void; onOpenPurchases: () => void }) {
  const { view, loading } = useBusinessView(month, demo, state);
  const money = useMoney(state.organization.currency);
  const [dialog, setDialog] = React.useState<{ area: CostArea; expense?: SharedExpense } | null>(null);
  const structure = view?.structure;
  const expenseById = new Map(state.expenses.map((item) => [item.id, item]));
  const companyTotal = structure ? structure.areas.filter((area) => area.area !== "production").reduce((sum, area) => sum + area.monthlyTotal, 0) : 0;

  return <>
    <SectionHeader eyebrow="Estructura" title="Gastos de la empresa" description="Lo que cuesta sostener la empresa cada mes, además de producir: entregas, ventas y administración. No se carga a cada producto: es lo que tus ventas tienen que cubrir.">
      <Button onClick={() => setDialog({ area: "admin" })}><AnimatedIcon name="plus" data-icon="inline-start" />Agregar gasto</Button>
    </SectionHeader>
    {!structure ? <TextShimmer className="text-sm">Cargando gastos…</TextShimmer> : <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Todos los gastos fijos del mes" value={money(structure.monthlyFixedTotal)} note="Taller, entregas, ventas y administración" />
        {COMPANY_AREAS.map((area) => <Stat key={area} label={AREA_LABELS[area]} value={money(structure.areas.find((item) => item.area === area)?.monthlyTotal ?? 0)} note="por mes" />)}
      </div>
      {structure.period !== state.activePeriod ? <p className="text-sm text-muted-foreground">{structure.period ? `Estos son los gastos que estaban vigentes en ese mes (período ${structure.period}). Los gastos se editan en el período activo, ${state.activePeriod}.` : "En ese mes todavía no había gastos mensuales registrados."}</p> : null}

      {COMPANY_AREAS.map((areaKey) => {
        const area = structure.areas.find((item) => item.area === areaKey)!;
        return <Card key={areaKey}>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5"><CardTitle>{area.label}</CardTitle><CardDescription>{area.hint}</CardDescription></div>
            <Button size="sm" variant="outline" onClick={() => setDialog({ area: areaKey })}><AnimatedIcon name="plus" data-icon="inline-start" />Gasto de {area.label.toLocaleLowerCase("es")}</Button>
          </CardHeader>
          <CardContent>{area.expenses.length || area.investments.length ? <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Concepto</TableHead><TableHead className="hidden sm:table-cell">Tipo</TableHead><TableHead className="text-right">Por mes</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
            <TableBody>
              {area.expenses.map((expense) => <TableRow key={expense.id}>
                <TableCell className="font-medium whitespace-normal">{expense.name}<div className="text-xs font-normal text-muted-foreground"><span className="sm:hidden">{behaviorTag(expenseById.get(expense.id))} · </span>{expense.category}</div></TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell" title={expenseById.get(expense.id)?.behaviorNote || undefined}>{behaviorTag(expenseById.get(expense.id))}</TableCell>
                <TableCell className="text-right tabular-nums">{money(expense.monthlyAmount)}</TableCell>
                <TableCell>{expenseById.get(expense.id)?.period === state.activePeriod ? <Button size="icon-sm" variant="ghost" aria-label={`Editar ${expense.name}`} onClick={() => setDialog({ area: areaKey, expense: expenseById.get(expense.id) })}><AnimatedIcon name="edit" /></Button> : null}</TableCell>
              </TableRow>)}
              {area.investments.map((asset) => <TableRow key={asset.id}>
                <TableCell className="font-medium whitespace-normal">{asset.description}<div className="text-xs font-normal text-muted-foreground"><span className="sm:hidden">Inversión · </span>Costó {money(asset.amount)} · faltan {asset.monthsLeft} de {asset.usefulLifeMonths} meses</div></TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">Inversión</TableCell>
                <TableCell className="text-right tabular-nums">{money(asset.monthlyShare)}</TableCell>
                <TableCell><ReceiptLink documentId={asset.documentId} demo={demo} /></TableCell>
              </TableRow>)}
            </TableBody>
            <TableFooter><TableRow><TableCell className="whitespace-normal">Total de {area.label.toLocaleLowerCase("es")}</TableCell><TableCell className="hidden sm:table-cell" /><TableCell className="text-right tabular-nums">{money(area.monthlyTotal)}</TableCell><TableCell /></TableRow></TableFooter>
          </Table></div> : <p className="text-sm text-muted-foreground">Sin gastos cargados en esta área.</p>}</CardContent>
        </Card>;
      })}

      {(() => {
        const workshop = structure.areas.find((item) => item.area === "production")!;
        return <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5"><CardTitle>Taller (producción)</CardTitle><CardDescription>Sus gastos fijos ya están dentro del costo de cada producto: se reparten según cuánto produces. Sus inversiones cuentan en el resultado del mes y, si lo eliges, también en el costo de cada producto.</CardDescription></div>
            <Button size="sm" variant="outline" onClick={onOpenProduction}>Ver costos de producción</Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {workshop.expenses.map((expense) => <div key={expense.id} className="flex justify-between gap-3"><span>{expense.name}</span><span className="tabular-nums">{money(expense.monthlyAmount)}</span></div>)}
            {workshop.investments.map((asset) => <div key={asset.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span>{asset.description} <span className="text-xs text-muted-foreground">(inversión, faltan {asset.monthsLeft} meses)</span></span>
              <span className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" className="size-3.5" checked={asset.includeInUnitCost} onChange={async (event) => {
                  const include = event.target.checked;
                  if (await onSave({ action: "set-investment-cost", id: asset.id, include }, true)) toast.success(include ? "Ahora su parte se suma al costo de cada producto" : "Ahora cuenta solo en el resultado del mes");
                }} />Sumar al costo de cada producto</label>
                <span className="tabular-nums">{money(asset.monthlyShare)}</span>
              </span>
            </div>)}
            <div className="mt-1 flex justify-between gap-3 border-t pt-2 font-medium"><span>Total del taller</span><span className="tabular-nums">{money(workshop.monthlyTotal)}</span></div>
            {workshop.investments.length ? <Tip title="¿Sumar una inversión al costo de cada producto?" className="mt-3">Si la máquina o herramienta se usa para producir y algún día habrá que reemplazarla, sumar su parte mensual al costo hace que tu precio pague su desgaste. Si es chica o se usa poco, puede quedar solo en el resultado del mes. Lo decides tú; Cozte te puede ayudar a elegir con tus números.</Tip> : null}
          </CardContent>
        </Card>;
      })()}

      <div className="grid gap-3 md:grid-cols-2">
        <Tip title="Gasto fijo o inversión">Un gasto fijo se paga todos los meses (contador, publicidad). Una inversión se compra una vez y dura años (una computadora, una herramienta): no se carga entera en un mes, se reparte en los meses que se usa. Las inversiones se registran en <button type="button" className="font-medium text-foreground underline underline-offset-2" onClick={onOpenPurchases}>Compras</button>.</Tip>
        <Tip title="Por qué importa">Tus gastos de la empresa suman {money(companyTotal)} al mes. Cada venta deja una parte para cubrirlos; mientras no alcanza, la empresa pierde aunque cada producto tenga buen margen.</Tip>
      </div>
    </div>}
    {dialog ? <ExpenseDialog area={dialog.area} expense={dialog.expense} state={state} demo={demo} onSave={onSave} onClose={() => setDialog(null)} /> : null}
  </>;
}

function ExpenseDialog({ area, expense, state, demo, onSave, onClose }: { area: CostArea; expense?: SharedExpense; state: DomainState; demo: boolean; onSave: Save; onClose: () => void }) {
  const currency = state.organization.currency;
  const [selectedArea, setSelectedArea] = React.useState<CostArea>(expense?.area ?? area);
  const [busy, setBusy] = React.useState(false);
  const categories = [...new Set([...(state.categories ?? []).map((item) => item.name), "Servicios", "Publicidad", "Envíos", "Servicios profesionales"])];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo) { toast.info("Demostración: los cambios no se guardan"); return; }
    const data = new FormData(event.currentTarget);
    const amount = Number(data.get("amount"));
    setBusy(true);
    try {
      let saved = true;
      if (!expense) {
        saved = await onSave({ action: "create-expense", name: String(data.get("name") ?? "").trim(), period: state.activePeriod, amount, currency, allocationBasis: "units", shares: {}, category: String(data.get("category") ?? "Gastos generales").trim() || "Gastos generales", source: String(data.get("source") ?? "").trim() || "Carga manual", area: selectedArea });
      } else {
        const current = expense.nativeAmountMilli == null ? expense.amountMinor : expense.nativeAmountMilli / 1000;
        if (amount !== current) saved = await onSave({ action: "bulk-prices", materials: [], expenses: [{ id: expense.id, amount, currency: expense.currency ?? currency }], expectedFxRates: {}, source: String(data.get("source") ?? "").trim() || "Carga manual", effectiveDate: todayIso() }, true);
        if (saved && selectedArea !== (expense.area ?? "production")) saved = await onSave({ action: "update-expense-meta", id: expense.id, field: "area", value: selectedArea, acknowledgeImpact: true }, true);
      }
      if (saved) { toast.success(expense ? "Gasto actualizado" : "Gasto agregado"); onClose(); }
    } finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>{expense ? `Editar ${expense.name}` : "Nuevo gasto de la empresa"}</DialogTitle><DialogDescription>{AREA_HINTS[selectedArea]}</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={submit}><FieldGroup>
      {!expense ? <Field><FieldLabel htmlFor="company-expense-name">Gasto</FieldLabel><Input id="company-expense-name" name="name" required minLength={2} placeholder="Ej. Contador" /></Field> : null}
      <Field><FieldLabel htmlFor="company-expense-area">Área</FieldLabel><Dropdown id="company-expense-area" className="w-full" value={selectedArea} onChange={(event) => setSelectedArea(event.target.value as CostArea)}>{COMPANY_AREAS.map((item) => <DropdownOption key={item} value={item}>{AREA_LABELS[item]}</DropdownOption>)}{expense ? <DropdownOption value="production">{AREA_LABELS.production} (se reparte en los productos)</DropdownOption> : null}</Dropdown></Field>
      <Field><FieldLabel htmlFor="company-expense-amount">Monto por mes ({expense?.currency ?? currency})</FieldLabel><Input id="company-expense-amount" name="amount" type="number" min="0" step="0.01" required defaultValue={expense ? (expense.nativeAmountMilli == null ? expense.amountMinor : expense.nativeAmountMilli / 1000) : undefined} /><FieldDescription>{expense ? "Si ya no lo pagas, ponlo en 0." : "Si lo pagas cada año o trimestre, divídelo por 12 o por 3."}</FieldDescription></Field>
      {!expense ? <Field><FieldLabel htmlFor="company-expense-category">Categoría</FieldLabel><Input id="company-expense-category" name="category" list="company-expense-categories" defaultValue="Servicios" /><datalist id="company-expense-categories">{categories.map((item) => <option key={item} value={item} />)}</datalist></Field> : null}
      <Field><FieldLabel htmlFor="company-expense-source">De dónde sale el monto</FieldLabel><Input id="company-expense-source" name="source" placeholder="Ej. Factura de septiembre" /></Field>
    </FieldGroup>
    <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : expense ? "Guardar" : "Agregar gasto"}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
