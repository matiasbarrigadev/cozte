"use client";

import * as React from "react";
import { AREA_LABELS, monthLessons } from "@/lib/business";
import type { CostArea, DomainState } from "@/lib/domain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";
import { MonthPicker, SectionHeader, Stat, Tip, useBusinessView, useMoney } from "./business-ui";

const AREAS: CostArea[] = ["production", "delivery", "sales", "admin"];

/** One line of the month's statement: labels for people, not accountants. */
function Line({ label, value, money, tone = "minus", strong, hint }: { label: string; value: number; money: (value: number) => string; tone?: "plus" | "minus" | "total"; strong?: boolean; hint?: string }) {
  return <div className={cn("flex items-baseline justify-between gap-4 py-1.5", tone === "total" && "border-t pt-2.5", strong && "text-base font-semibold")}>
    <span className={cn(tone === "minus" && "pl-4 text-muted-foreground")}>{tone === "minus" ? "− " : tone === "plus" ? "+ " : "= "}{label}{hint ? <span className="block pl-4 text-xs text-muted-foreground">{hint}</span> : null}</span>
    <span className={cn("tabular-nums", tone === "minus" && "text-muted-foreground", tone === "total" && value < 0 && "text-destructive")}>{money(value)}</span>
  </div>;
}

export function ResultSection({ state, demo, month, onMonthChange, onOpenSales, onOpenCozte }: { state: DomainState; demo: boolean; month: string; onMonthChange: (month: string) => void; onOpenSales: () => void; onOpenCozte: () => void }) {
  const { view, loading } = useBusinessView(month, demo, state);
  const money = useMoney(state.organization.currency);
  const result = view?.result;
  const lessons = result ? monthLessons(result, money) : [];
  const progress = result?.breakEvenRevenue ? Math.min(100, Math.round(result.revenue / result.breakEvenRevenue * 100)) : null;

  return <>
    <SectionHeader eyebrow="Resultados" title="Resultado del mes" description="Lo que vendiste, lo que costó cada venta, los gastos fijos y lo que quedó. Sale de tus ventas y compras registradas.">
      <MonthPicker month={month} onChange={onMonthChange} />
    </SectionHeader>
    {!result ? <TextShimmer className="text-sm">Calculando el mes…</TextShimmer> : <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={result.result >= 0 ? "Ganancia del mes" : "Pérdida del mes"} value={money(result.result)} tone={result.sales ? result.result >= 0 ? "positive" : "negative" : undefined} note={result.sales ? `Con ${result.sales} venta${result.sales === 1 ? "" : "s"} registrada${result.sales === 1 ? "" : "s"}` : "Todavía sin ventas este mes"} />
        <Stat label="Vendiste" value={money(result.revenue)} />
        <Stat label="Te dejaron las ventas" value={money(result.contribution)} note={result.revenue ? `${Math.round(result.contribution / result.revenue * 100)} % de lo vendido` : undefined} />
        <Stat label="Gastos fijos del mes" value={money(result.fixedTotal + result.investmentsShare)} note="Incluye la parte de tus inversiones" />
      </div>

      {!result.sales ? <Alert><AlertTitle>Registra tus ventas para ver el resultado</AlertTitle><AlertDescription><div className="flex flex-wrap items-center gap-2"><span>Sin ventas, el mes muestra solo los gastos. Cárgalas en Ventas o mándale los remitos a Cozte.</span><Button size="sm" variant="outline" onClick={onOpenSales}>Ir a ventas</Button><Button size="sm" variant="ghost" onClick={onOpenCozte}>Hablar con Cozte</Button></div></AlertDescription></Alert> : null}
      {result.salesWithoutCost ? <Alert><AlertTitle>{result.salesWithoutCost} venta{result.salesWithoutCost === 1 ? "" : "s"} sin costo completo</AlertTitle><AlertDescription>Algún producto vendido no tenía su costo completo al registrar la venta, así que su costo no se descuenta. Completa sus datos en Costos de producción.</AlertDescription></Alert> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>Cómo se llega al resultado</CardTitle><CardDescription>De arriba hacia abajo: lo que entró y lo que se fue.</CardDescription></CardHeader>
          <CardContent className="text-sm">
            <Line label="Lo que vendiste" value={result.revenue} money={money} tone="plus" strong />
            <Line label="Insumos y mano de obra de lo vendido" value={result.variableProductionCost} money={money} />
            <Line label="Comisiones y cargos por vender" value={result.sellingCost} money={money} />
            <Line label="Entregas de esas ventas" value={result.deliveryCost} money={money} />
            <Line label="Lo que dejaron las ventas" value={result.contribution} money={money} tone="total" strong hint="Con esto se pagan los gastos fijos" />
            {AREAS.map((area) => result.fixedByArea[area] ? <Line key={area} label={`Gastos fijos de ${AREA_LABELS[area].toLocaleLowerCase("es")}`} value={result.fixedByArea[area]} money={money} /> : null)}
            {result.oneOffTotal ? <Line label="Compras que se usaron este mes" value={result.oneOffTotal} money={money} hint={AREAS.filter((area) => result.oneOffByArea[area]).map((area) => `${AREA_LABELS[area]}: ${money(result.oneOffByArea[area])}`).join(" · ")} /> : null}
            {result.investmentsShare ? <Line label="Parte del mes de tus inversiones" value={result.investmentsShare} money={money} /> : null}
            <Line label={result.result >= 0 ? "Ganancia del mes" : "Pérdida del mes"} value={result.result} money={money} tone="total" strong />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle>Punto de equilibrio</CardTitle><CardDescription>Cuánto necesitas vender al mes para no perder.</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {result.breakEvenRevenue !== null ? <>
                <p className="text-2xl font-semibold tabular-nums">{money(result.breakEvenRevenue)}</p>
                {progress !== null ? <div className="flex flex-col gap-1">
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Llevas ${progress} % del punto de equilibrio`}><div className="h-full rounded-full" style={{ width: `${progress}%`, background: progress >= 100 ? "var(--chart-decrease)" : "var(--chart-series-1)" }} /></div>
                  <span className="text-xs text-muted-foreground">Llevas {money(result.revenue)} · {progress} %</span>
                </div> : null}
              </> : <p className="text-muted-foreground">Falta saber cuánto deja cada venta: carga precios de venta y costos completos de tus productos.</p>}
            </CardContent>
          </Card>
          {result.purchasedMaterials || result.fixedPayments.length ? <Card>
            <CardHeader><CardTitle>Plata que salió y no es gasto del mes</CardTitle><CardDescription>Ya está contada en otro lado; se muestra para que cuadre con tu caja.</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              {result.purchasedMaterials ? <div className="flex justify-between gap-3"><span>Insumos comprados</span><span className="tabular-nums">{money(result.purchasedMaterials)}</span></div> : null}
              {result.fixedPayments.map((item, index) => <div key={index} className="flex justify-between gap-3"><span>Pago de {item.expenseName}{item.estimated !== null ? <span className="text-xs text-muted-foreground"> (estimado {money(item.estimated)})</span> : null}</span><span className="tabular-nums">{money(item.paid)}</span></div>)}
            </CardContent>
          </Card> : null}
        </div>
      </div>

      {lessons.length ? <div className="grid gap-3 md:grid-cols-2">{lessons.map((lesson) => <Tip key={lesson.id} title={lesson.title}>{lesson.text}</Tip>)}</div> : null}
    </div>}
  </>;
}
