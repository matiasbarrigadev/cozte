"use client";

import * as React from "react";
import { AnimatedIcon } from "@/components/animated-icon";
import { ChartCard, MonthBars, useCompactMoney } from "@/components/analysis/charts";
import { Stat } from "@/components/business/business-ui";
import { cn } from "@/lib/utils";
import { landingHeroSale, landingMonths } from "./landing-data";
import { AppFrame, Cursor, WorkingStatus, money, progress, typed, useSceneTime } from "./scene";

const LENGTH = 15000;
const MESSAGE = "Vendí 40 cuadernos tapa blanda a Librería El Ateneo";
const TYPE_FROM = 4200;
const SENT = TYPE_FROM + MESSAGE.length * 40 + 300;
const ANSWER_FROM = SENT + 2400;
const MONTH = landingMonths[landingMonths.length - 1];
const MISSING_AFTER = Math.max(0, MONTH.fixed - MONTH.contribution - landingHeroSale.left);
const ANSWER = `Listo: registré **40 cuadernos tapa blanda** para Librería El Ateneo por **${money(landingHeroSale.total)}**. Te dejaron ${money(landingHeroSale.left)} para los gastos del mes: ahora te faltan **${money(MISSING_AFTER)}** para cubrirlos. La entrega sale hoy en la ruta de Tomás.`;
const STATUS = [{ at: SENT + 200, title: "Buscando a Librería El Ateneo" }, { at: SENT + 1000, title: "Registrando la venta" }, { at: SENT + 1700, title: "Calculando lo que dejó" }];

/** **bold** in a streamed answer. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]*\*\*?)/g).map((part, index) => part.startsWith("**") ? <strong key={index}>{part.replace(/\*/g, "")}</strong> : <React.Fragment key={index}>{part.replace(/\*/g, "")}</React.Fragment>)}</>;
}

/**
 * The dashboard at work: the month's figures count up, the months of sales get a look one by one, and a sale told to
 * Cozte lands in the figures while the person watches.
 */
export function HeroMockup() {
  const [ref, time] = useSceneTime(LENGTH, LENGTH - 1);
  const compact = useCompactMoney("CLP");
  const month = MONTH;
  const counted = progress(time, 200, 1600);
  const added = progress(time, ANSWER_FROM + 200, ANSWER_FROM + 1400);
  const revenue = month.revenue * counted + landingHeroSale.total * added;
  const left = month.contribution * counted + landingHeroSale.left * added;
  const covered = month.fixed ? left / month.fixed : null;
  const focus = Math.min(landingMonths.length - 1, Math.max(0, Math.floor((time - 800) / 650)));
  const status = [...STATUS].reverse().find((item) => time >= item.at);
  const answering = time >= ANSWER_FROM;
  const input = time < SENT ? typed(MESSAGE, time, TYPE_FROM, 40) : "";
  return <div ref={ref} className="relative">
    <AppFrame active="dashboard" path="">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><p className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">Taller Norte</p><p className="text-lg font-semibold tracking-tight sm:text-xl">Así va septiembre</p></div>
          <span className="rounded-full border bg-card px-3 py-1 text-[11px] text-muted-foreground">Sábado 26/09</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <div className="relative"><Stat label="Ventas del mes" value={money(revenue)} note={`${month.sales + (added > 0.5 ? 1 : 0)} ventas`} />
            {added > 0 && added < 1 ? <span className="landing-rise absolute top-2 right-2 rounded-full bg-landing-highlight px-2 py-0.5 text-[10px] font-semibold text-landing-ink">+{compact(landingHeroSale.total)}</span> : null}</div>
          <Stat label="Te dejaron las ventas" value={money(left)} note="Después de producir, vender y entregar" />
          <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-3 py-3 sm:px-4">
            <span className="text-xs text-muted-foreground">Gastos del mes cubiertos</span>
            <span className="text-xl font-semibold tabular-nums sm:text-2xl">{covered === null ? "—" : `${Math.round(covered * 100)} %`}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-[var(--data-1)] transition-all duration-300" style={{ width: `${Math.min(100, (covered ?? 0) * 100)}%` }} /></span>
            <span className="text-xs text-muted-foreground">Faltan {money(Math.max(0, month.fixed - left))}</span>
          </div>
          <Stat label="Entregas de hoy" value={String(added > 0.5 ? 5 : 4)} note="En moto por Santiago" />
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <ChartCard title="Ventas de cada mes" description="Toca un mes para mirarlo." className="hidden p-3 sm:flex sm:p-4">
            <MonthBars months={landingMonths.map((item) => item.month)} values={landingMonths.map((item, index) => index === landingMonths.length - 1 ? item.revenue + landingHeroSale.total * added : item.revenue)} focus={focus} onFocus={() => undefined} format={money} compact={compact} height={176} label="Ventas de cada mes de Taller Norte" />
          </ChartCard>
          <section className="flex min-h-64 flex-col rounded-2xl border bg-card p-3 shadow-xs sm:p-4" aria-label="Cozte AI">
            <div className="flex items-center gap-1.5 text-sm font-semibold"><AnimatedIcon name="sparkles" size={15} />Cozte AI</div>
            <div className="mt-3 flex flex-1 flex-col justify-end gap-2.5 text-[13px] leading-relaxed">
              <p className="text-muted-foreground">¿Qué registramos hoy?</p>
              {time >= SENT ? <p className="landing-rise ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-foreground">{MESSAGE}</p> : null}
              {time >= SENT && !answering && status ? <WorkingStatus title={status.title} /> : null}
              {answering ? <p className="landing-rise"><Rich text={typed(ANSWER, time, ANSWER_FROM, 16)} /></p> : null}
              {time >= ANSWER_FROM + ANSWER.length * 16 ? <p className="landing-rise flex flex-wrap gap-1.5 text-[11px]"><span className="rounded-full bg-muted px-2 py-0.5">✓ Venta registrada</span><span className="rounded-full bg-muted px-2 py-0.5">✓ Entrega programada</span></p> : null}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl border bg-background px-3 py-2 text-[13px]">
              <span className={cn("min-w-0 flex-1 truncate", !input && "text-muted-foreground")}>{input || "Cuéntale a Cozte…"}{input && time < SENT ? <span className="ml-0.5 inline-block h-3.5 w-px animate-pulse bg-foreground align-middle" /> : null}</span>
              <span className={cn("flex size-7 items-center justify-center rounded-lg transition-colors", input ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}><AnimatedIcon name="send" size={14} /></span>
            </div>
          </section>
        </div>
      </div>
      <Cursor x={time < TYPE_FROM - 600 ? 60 : 93} y={time < TYPE_FROM - 600 ? 58 : 91} clicking={time > SENT - 350 && time < SENT + 150} hidden={time > SENT + 900} />
    </AppFrame>
  </div>;
}
