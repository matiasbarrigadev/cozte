"use client";

import type { DomainState } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat, useBusinessView, useMoney } from "./business-ui";

type Section = "ventas" | "compras" | "resultado";

/** The month at a glance on the dashboard: sales, result and how close the business is to breaking even. */
export function MonthCard({ state, demo, month, onOpen }: { state: DomainState; demo: boolean; month: string; onOpen: (section: Section) => void }) {
  const { view } = useBusinessView(month, demo, state);
  const money = useMoney(state.organization.currency);
  if (!view) return null;
  const result = view.result;
  const progress = result.breakEvenRevenue ? Math.min(100, Math.round(result.revenue / result.breakEvenRevenue * 100)) : null;
  const monthName = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
  return <Card>
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1.5"><CardTitle>Tu mes</CardTitle><CardDescription>Cómo va {monthName} con las ventas y compras que registraste.</CardDescription></div>
      <Button size="sm" variant="outline" onClick={() => onOpen("resultado")}>Ver el resultado</Button>
    </CardHeader>
    <CardContent className="grid gap-3 sm:grid-cols-3">
      <Stat label="Vendiste" value={money(result.revenue)} note={`${result.sales} venta${result.sales === 1 ? "" : "s"} registrada${result.sales === 1 ? "" : "s"}`} />
      <Stat label={result.result >= 0 ? "Ganancia del mes" : "Pérdida del mes"} value={money(result.result)} tone={result.sales ? result.result >= 0 ? "positive" : "negative" : undefined} note="Ventas menos costos y gastos del mes" />
      <Stat label="Para no perder necesitas vender" value={result.breakEvenRevenue !== null ? money(result.breakEvenRevenue) : "Por calcular"} note={progress !== null ? `Llevas ${progress} %` : "Falta el precio o el costo de algún producto"} />
    </CardContent>
    <CardFooter className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => onOpen("ventas")}>Registrar una venta</Button>
      <Button size="sm" variant="outline" onClick={() => onOpen("compras")}>Registrar una compra</Button>
    </CardFooter>
  </Card>;
}
