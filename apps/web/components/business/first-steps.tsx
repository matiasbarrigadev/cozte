"use client";

import * as React from "react";
import { needsDelivery } from "@/lib/business";
import type { DomainState } from "@/lib/domain";
import type { AppView } from "@/lib/app-routes";
import { AnimatedIcon } from "@/components/animated-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { todayFor, useBusinessView } from "./business-ui";
import { usePersistentState } from "./data-table";
import { useDeliveries } from "./deliveries-section";

type Step = { id: string; title: string; hint: string; done: boolean; view: AppView; prompt: string; open?: () => void };

/**
 * The whole path from zero to a business that knows its numbers, with progress: each step opens its section or
 * starts it with Cozte. It disappears when everything is done, or when the person hides it.
 */
export function FirstSteps({ state, demo, onGo, onAsk, onOpenCompany }: { state: DomainState; demo: boolean; onGo: (view: AppView) => void; onAsk: (text: string) => void; onOpenCompany?: () => void }) {
  const month = todayFor(demo).slice(0, 7);
  const { view } = useBusinessView(month, demo, state);
  const { data } = useDeliveries(month, demo, state.revision);
  const [hidden, setHidden] = usePersistentState<string>(`primeros-pasos:${state.organization.id}`, "visible");
  if (!view || hidden === "hidden") return null;
  const delivers = view.channels.some((channel) => needsDelivery(channel));
  const steps: Step[] = [
    { id: "location", title: "Dónde está tu empresa", hint: "Para usar tu día y tu hora, hablarte como se habla allá y sugerirte la moneda.", done: Boolean(state.organization.country), view: "dashboard", prompt: "Te cuento dónde está mi empresa.", open: onOpenCompany },
    { id: "products", title: "Tus productos", hint: "Qué fabricas y cuántas unidades salen de cada lote.", done: state.products.length > 0, view: "planilla", prompt: "Quiero empezar: te cuento qué productos fabrico." },
    { id: "materials", title: "Insumos con precio", hint: "Lo que compras para producir y cuánto pagas.", done: state.materials.some((item) => item.priceMinor !== null), view: "planilla", prompt: "Te paso los insumos que uso y lo que pago por cada uno." },
    { id: "recipes", title: "La receta de cada producto", hint: "Cuánto de cada insumo lleva.", done: state.products.length > 0 && state.products.every((product) => state.components.some((item) => item.productId === product.id)), view: "planilla", prompt: "Armemos la receta de mis productos: cuánto insumo lleva cada uno." },
    { id: "expenses", title: "Gastos del mes", hint: "Luz, alquiler, sueldos y lo que pagas cada mes.", done: state.expenses.some((item) => item.period === state.activePeriod), view: "gastos", prompt: "Te cuento mis gastos fijos del mes: luz, alquiler, sueldos y otros." },
    { id: "channels", title: "Cómo vendes", hint: "Tus canales, con sus comisiones y lo que cuesta entregar.", done: view.channels.length > 0, view: "ventas", prompt: "Te cuento por dónde vendo: los canales, sus comisiones y cuánto me cuesta entregar." },
    { id: "sale", title: "Tu primera venta", hint: "Para ver cuánto te deja cada venta y cómo va el mes.", done: view.sales.length > 0, view: "ventas", prompt: "Quiero registrar una venta." },
    ...(delivers ? [{ id: "delivery", title: "Seguir una entrega", hint: "Fecha, dirección y estado de lo que tienes que entregar.", done: Boolean(data?.deliveries.length), view: "entregas" as AppView, prompt: "Tengo que entregar un pedido: te paso fecha, dirección y a quién." }] : []),
  ];
  const done = steps.filter((step) => step.done).length;
  if (done === steps.length) return null;
  const next = steps.find((step) => !step.done)!;
  return <Card>
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1.5">
        <CardTitle>Primeros pasos</CardTitle>
        <CardDescription>{done} de {steps.length} listos. Con esto Cozte conoce tu costo real, cuánto te deja cada venta y cómo va tu mes.</CardDescription>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={() => setHidden("hidden")}>Ocultar</Button>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Avance de los primeros pasos">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${done / steps.length * 100}%` }} />
      </div>
      <ol className="grid gap-2 md:grid-cols-2">
        {steps.map((step, index) => <li key={step.id} className={cn("flex items-start gap-3 rounded-lg border p-3", step.id === next.id && "border-primary/40 bg-accent/30", step.done && "opacity-70")}>
          <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", step.done ? "bg-primary text-primary-foreground" : "border")} aria-hidden="true">
            {step.done ? <AnimatedIcon name="check" size={14} /> : index + 1}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className={cn("text-sm font-medium", step.done && "line-through decoration-1")}>{step.title}<span className="sr-only">{step.done ? " (listo)" : " (pendiente)"}</span></p>
            <p className="text-xs text-muted-foreground">{step.hint}</p>
            {!step.done ? <div className="mt-1 flex flex-wrap gap-2">
              <Button type="button" size="sm" className="h-7 px-2 text-xs" variant={step.id === next.id ? "default" : "outline"} disabled={demo} onClick={() => onAsk(step.prompt)}><AnimatedIcon name="sparkles" data-icon="inline-start" size={12} />Hacerlo con Cozte</Button>
              <Button type="button" size="sm" className="h-7 px-2 text-xs" variant="ghost" onClick={() => step.open ? step.open() : onGo(step.view)}>{step.open ? "Completar →" : "Ir →"}</Button>
            </div> : null}
          </div>
        </li>)}
      </ol>
    </CardContent>
  </Card>;
}
