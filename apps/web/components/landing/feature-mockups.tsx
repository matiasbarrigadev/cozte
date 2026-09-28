"use client";

import * as React from "react";
import { MapPin, MessageCircle } from "lucide-react";
import { AnimatedIcon } from "@/components/animated-icon";
import { ChartCard, DATA_COLORS, Legend, LineChart, Sparkline, Treemap, useCompactMoney } from "@/components/analysis/charts";
import { ZoneModeChip } from "@/components/business/delivery-zones";
import { cn } from "@/lib/utils";
import { landingCosts, landingCostsAugust, landingCostsPaperUp, landingCustomers, landingInsights, landingMonths, landingPrices, landingRoute } from "./landing-data";
import { AppFrame, Cursor, WorkingStatus, money, progress, typed, useSceneTime } from "./scene";

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const PARTS = [
  { key: "materialMinor", label: "Materiales", color: DATA_COLORS[0] },
  { key: "laborMinor", label: "Mano de obra", color: DATA_COLORS[1] },
  { key: "sharedMinor", label: "Gastos compartidos", color: DATA_COLORS[3] },
] as const;

function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]*\*\*?)/g).map((part, index) => part.startsWith("**") ? <strong key={index}>{part.replace(/\*/g, "")}</strong> : <React.Fragment key={index}>{part.replace(/\*/g, "")}</React.Fragment>)}</>;
}

/* ---------- Costs: a price changes and every product that uses it follows ---------- */

const COST_LENGTH = 14000;

export function CostsMockup() {
  const [ref, time] = useSceneTime(COST_LENGTH, 6500);
  const up = progress(time, 3000, 4600) * (1 - progress(time, 11500, 12800));
  const paper = lerp(9000, 10000, progress(time, 2800, 3400) * (1 - progress(time, 11500, 12200)));
  const rows = landingCosts.map((row, index) => {
    const after = landingCostsPaperUp[index];
    const unit = lerp(row.unit, after.unit, up);
    return { ...row, unit, delta: after.unit - row.unit, margin: row.price ? (row.price - unit) / row.price : null, parts: { materialMinor: lerp(row.parts.materialMinor, after.parts.materialMinor, up), laborMinor: row.parts.laborMinor, sharedMinor: row.parts.sharedMinor } };
  });
  const top = Math.max(...landingCostsPaperUp.map((row) => row.unit));
  const deltas = landingCostsPaperUp.map((row, index) => row.unit - landingCosts[index].unit).filter((value) => value > 0);
  const note = `Papel interior sube en ${deltas.length} productos: entre ${money(Math.min(...deltas))} y ${money(Math.max(...deltas))} por unidad. ¿Revisamos los precios de venta?`;
  return <div ref={ref} className="relative">
    <AppFrame active="costos" path="/costos" compact>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2"><p className="text-base font-semibold">Costo por unidad</p><span className="rounded-full border bg-card px-2.5 py-0.5 text-[11px] text-muted-foreground">Septiembre</span></div>
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2.5 text-sm">
          <span className="min-w-0"><span className="block font-medium">Papel interior</span><span className="block text-xs text-muted-foreground">Papelería Sur · por resma · en 3 productos</span></span>
          <span className={cn("rounded-md border px-2.5 py-1 font-semibold tabular-nums transition-colors", time > 2600 && time < 3600 ? "border-foreground ring-2 ring-landing-highlight" : "border-input")}>{money(paper)}</span>
        </div>
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_4rem] gap-3 border-b bg-muted/60 px-3 py-2 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase sm:grid-cols-[minmax(0,1fr)_7rem_5.5rem_4rem]"><span>Producto</span><span className="hidden sm:block">De qué está hecho</span><span className="text-right">Costo/u</span><span className="text-right">Margen</span></div>
          {rows.map((row, index) => <div key={row.id} className="landing-rise grid grid-cols-[minmax(0,1fr)_5.5rem_4rem] items-center gap-3 border-b px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_7rem_5.5rem_4rem]" style={{ animationDelay: `${index * 120}ms` }}>
            <span className="truncate text-[13px] font-medium">{row.name}</span>
            <span className="hidden h-2.5 gap-0.5 sm:flex" style={{ width: `${(row.unit / top) * 100}%` }}>{PARTS.map((part) => <span key={part.key} className="h-full rounded-[3px] transition-all duration-300" style={{ flexGrow: row.parts[part.key], background: part.color }} />)}</span>
            <span className="relative text-right text-[13px] font-semibold tabular-nums">{money(row.unit)}{up > 0.05 && row.delta > 0 ? <span className="landing-rise absolute -top-3.5 right-0 rounded-full bg-[color-mix(in_oklab,var(--data-6)_16%,transparent)] px-1.5 text-[10px] font-semibold text-[var(--data-6)]">+{money(row.delta * up)}</span> : null}</span>
            <span className={cn("text-right text-xs tabular-nums", (row.margin ?? 1) < 0.3 ? "text-[var(--data-6)]" : "text-muted-foreground")}>{row.margin === null ? "—" : `${Math.round(row.margin * 100)} %`}</span>
          </div>)}
        </div>
        <Legend items={PARTS.map((part) => ({ key: part.key, label: part.label, color: part.color }))} />
        <div className={cn("flex items-start gap-2 rounded-xl bg-primary px-3 py-2.5 text-[13px] text-primary-foreground transition-all duration-500", time > 5000 && time < 11500 ? "opacity-100" : "translate-y-1 opacity-0")}>
          <AnimatedIcon name="sparkles" size={15} className="mt-0.5 shrink-0 text-landing-highlight" /><span>{note}</span>
        </div>
      </div>
      <Cursor x={time < 1800 ? 45 : 86} y={time < 1800 ? 70 : 27} clicking={time > 2500 && time < 2900} hidden={time > 4200} />
    </AppFrame>
  </div>;
}

/* ---------- Cozte: an invoice becomes a purchase and a new price ---------- */

const CHAT_LENGTH = 14500;
const dura = { before: landingCostsAugust.find((row) => row.id === "dura")!.unit, now: landingCosts.find((row) => row.id === "dura")!.unit };
const CHAT_ANSWER = `Listo: registré la compra de **40 resmas de papel interior** a Papelería Sur por **${money(360000)}**. La resma pasó de ${money(8800)} a ${money(9000)}, así que cada cuaderno tapa dura cuesta **${money(dura.now - dura.before)} más** por unidad. Tu margen sigue arriba del 40 %.`;
const CHAT_STATUS = [{ at: 1500, title: "Leyendo la factura" }, { at: 2500, title: "Registrando la compra" }, { at: 3500, title: "Actualizando el precio del papel" }];
const CHAT_ANSWER_FROM = 4700;

export function CozteChatMockup() {
  const [ref, time] = useSceneTime(CHAT_LENGTH, CHAT_LENGTH - 1);
  const status = [...CHAT_STATUS].reverse().find((item) => time >= item.at);
  const answered = time >= CHAT_ANSWER_FROM + CHAT_ANSWER.length * 14;
  return <div ref={ref} className="relative">
    <AppFrame active="cozte" path="/cozte" compact>
      <div className="flex min-h-[23rem] flex-col gap-3 text-[13px] leading-relaxed">
        <div className="flex items-center justify-between"><div className="flex items-center gap-1.5 text-base font-semibold"><AnimatedIcon name="sparkles" size={16} />Cozte AI</div><span className="text-[11px] text-muted-foreground">Nivel simple</span></div>
        <div className="flex flex-1 flex-col justify-end gap-3">
          {time >= 400 ? <div className="landing-rise ml-auto flex max-w-[85%] flex-col items-end gap-1.5">
            <span className="flex items-center gap-2.5 rounded-xl border bg-card p-2 pr-3">
              <span className="flex h-12 w-10 flex-col gap-1 rounded-md border bg-background p-1.5" aria-hidden="true">{[70, 90, 55, 80, 40].map((width, index) => <span key={index} className="h-0.5 rounded-full bg-muted-foreground/40" style={{ width: `${width}%` }} />)}</span>
              <span><span className="block text-xs font-medium">factura-1842.jpg</span><span className="block text-[11px] text-muted-foreground">Imagen · 184 KB</span></span>
            </span>
            <span className="rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-foreground">Compré papel, te dejo la factura</span>
          </div> : null}
          {time >= 1300 && time < CHAT_ANSWER_FROM && status ? <WorkingStatus title={status.title} /> : null}
          {time >= CHAT_ANSWER_FROM ? <p className="landing-rise max-w-[95%]"><Rich text={typed(CHAT_ANSWER, time, CHAT_ANSWER_FROM, 14)} /></p> : null}
          {answered ? <div className="landing-rise flex flex-wrap gap-1.5 text-[11px]">{["Compra registrada", "Precio del papel actualizado", "Factura adjuntada"].map((item) => <span key={item} className="rounded-full border bg-card px-2 py-0.5">✓ {item}</span>)}</div> : null}
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2">
          <AnimatedIcon name="attach" size={15} className="text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">Escribe, dicta o adjunta un comprobante…</span>
          <AnimatedIcon name="mic" size={15} className="text-muted-foreground" />
          <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground"><AnimatedIcon name="send" size={14} /></span>
        </div>
      </div>
    </AppFrame>
  </div>;
}

/* ---------- Result: do sales cover the structure, and what stands out ---------- */

const RESULT_LENGTH = 12000;

export function ResultMockup() {
  const [ref, time] = useSceneTime(RESULT_LENGTH, RESULT_LENGTH - 1);
  const compact = useCompactMoney("CLP");
  const focus = Math.min(landingMonths.length - 1, Math.floor(time / 900) % (landingMonths.length + 3));
  const labels = landingMonths.map((item) => item.month);
  return <div ref={ref} className="relative">
    <AppFrame active="analisis" path="/analisis" compact>
      <div className="flex flex-col gap-3">
        <ChartCard title="¿Las ventas cubren la estructura?" description="Cuando la línea verde pasa a la ocre, hay ganancia." className="p-3 sm:p-4"
          legend={<Legend items={[{ key: "contribution", label: "Te dejaron las ventas", color: DATA_COLORS[0] }, { key: "fixed", label: "Gastos fijos", color: DATA_COLORS[4], dashed: true }]} />}>
          <LineChart months={labels} focus={focus} onFocus={() => undefined} format={money} compact={compact} height={170} label="Lo que dejaron las ventas y los gastos fijos por mes"
            series={[{ key: "contribution", label: "Te dejaron las ventas", color: DATA_COLORS[0], values: landingMonths.map((item) => item.contribution), area: true }, { key: "fixed", label: "Gastos fijos", color: DATA_COLORS[4], values: landingMonths.map((item) => item.fixed), dashed: true }]} />
        </ChartCard>
        <section className="rounded-2xl border bg-card p-3 shadow-xs sm:p-4" aria-label="Lo que se destaca">
          <p className="text-sm font-semibold">Lo que se destaca en septiembre</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-[13px]">
            {landingInsights.map((insight, index) => time >= 1200 + index * 1500 ? <li key={index} className="landing-rise flex items-start gap-2.5 rounded-xl bg-muted/50 px-3 py-2">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", insight.tone === "good" ? "bg-emerald-500" : insight.tone === "bad" ? "bg-amber-500" : "bg-muted-foreground/60")} aria-hidden="true" />{insight.text}
            </li> : null)}
          </ul>
        </section>
      </div>
    </AppFrame>
  </div>;
}

/* ---------- Routes: today's stops on a map, delivered one by one ---------- */

const ROUTE_LENGTH = 14000;
const PINS: [number, number][] = [[46, 170], [112, 118], [196, 132], [270, 58]];
const PLACES = [{ label: "Taller", x: 46, y: 196 }, { label: "Santiago Centro", x: 112, y: 144 }, { label: "Ñuñoa", x: 196, y: 158 }, { label: "Las Condes", x: 270, y: 84 }];
const STREETS = ["M0 150 H320", "M0 96 H320", "M0 40 H320", "M60 0 V220", "M150 0 V220", "M238 0 V220", "M0 205 L320 12"];
const segments = PINS.slice(1).map((pin, index) => Math.hypot(pin[0] - PINS[index][0], pin[1] - PINS[index][1]));
const total = segments.reduce((sum, value) => sum + value, 0);
const arrivals = segments.map((_, index) => segments.slice(0, index + 1).reduce((sum, value) => sum + value, 0) / total);

function along(share: number): [number, number] {
  let rest = share * total;
  for (let index = 0; index < segments.length; index++) {
    if (rest <= segments[index]) { const t = rest / segments[index]; return [lerp(PINS[index][0], PINS[index + 1][0], t), lerp(PINS[index][1], PINS[index + 1][1], t)]; }
    rest -= segments[index];
  }
  return PINS[PINS.length - 1];
}

export function RouteMockup() {
  const [ref, time] = useSceneTime(ROUTE_LENGTH, ROUTE_LENGTH - 1);
  const drawn = progress(time, 300, 2300);
  const driven = progress(time, 3200, 11800);
  const [x, y] = along(driven);
  const done = arrivals.filter((share) => driven >= share - 0.001).length;
  const stops = landingRoute.slice(0, 3);
  return <div ref={ref} className="relative">
    <AppFrame active="entregas" path="/entregas" compact>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-base font-semibold">Hoja de ruta · hoy</p><ZoneModeChip mode="own" /></div>
        <div className="grid gap-3">
          <div className="overflow-hidden rounded-xl border bg-card">
            <svg viewBox="0 0 320 220" className="block h-auto max-h-64 w-full" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Recorrido del día por Santiago">
              <rect width="320" height="220" fill="var(--muted)" />
              <rect x="160" y="150" width="70" height="50" rx="10" fill="color-mix(in oklab, var(--data-3) 22%, transparent)" />
              <path d="M0 70 C70 60 110 84 170 74 S270 40 320 30" stroke="color-mix(in oklab, var(--data-4) 45%, transparent)" strokeWidth="9" fill="none" strokeLinecap="round" />
              {STREETS.map((street) => <path key={street} d={street} stroke="var(--background)" strokeWidth={street.includes("L") ? 7 : 5} fill="none" />)}
              {PLACES.map((place) => <text key={place.label} x={place.x} y={place.y} fontSize="10" fontWeight="600" fill="var(--muted-foreground)" textAnchor="middle" style={{ paintOrder: "stroke" }} stroke="var(--muted)" strokeWidth="3">{place.label}</text>)}
              <polyline points={PINS.map((pin) => pin.join(",")).join(" ")} fill="none" stroke="var(--data-1)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - drawn} />
              <g><rect x={PINS[0][0] - 11} y={PINS[0][1] - 11} width="22" height="22" rx="6" fill="var(--brand-ink)" /><text x={PINS[0][0]} y={PINS[0][1] + 4} textAnchor="middle" fontSize="11" fill="white">⌂</text></g>
              {PINS.slice(1).map((pin, index) => <g key={index}>
                <circle cx={pin[0]} cy={pin[1]} r="12" fill={index < done ? "var(--data-1)" : "var(--card)"} stroke="var(--data-1)" strokeWidth="2.5" className="transition-all duration-300" />
                <text x={pin[0]} y={pin[1] + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={index < done ? "white" : "var(--data-1)"}>{index < done ? "✓" : index + 1}</text>
              </g>)}
              {time > 3000 ? <g transform={`translate(${x} ${y})`}><circle r="9" fill="var(--brand-highlight)" opacity="0.5"><animate attributeName="r" values="7;11;7" dur="1.4s" repeatCount="indefinite" /></circle><circle r="5" fill="var(--brand-ink)" /></g> : null}
            </svg>
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[var(--data-1)] transition-all duration-300" style={{ width: `${(done / Math.max(stops.length, 1)) * 100}%` }} /></div>
            <p className="text-xs text-muted-foreground">{done} de {stops.length} entregadas · la lleva Tomás en moto</p>
            <ol className="grid gap-1.5 sm:grid-cols-3">
              {stops.map((stop, index) => <li key={stop.id} className={cn("flex min-w-0 items-start gap-2.5 rounded-xl border bg-card px-2.5 py-2 transition-all", index === done && "border-foreground ring-1 ring-foreground", index < done && "opacity-60")}>
                <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white", index < done ? "bg-emerald-600" : "bg-[var(--data-1)]")}>{index < done ? "✓" : index + 1}</span>
                <span className="min-w-0 text-[12px]"><span className="block truncate font-medium">{stop.recipient}{stop.timeWindow ? <span className="ml-1.5 font-normal text-muted-foreground">{stop.timeWindow}</span> : null}</span><span className="block truncate text-muted-foreground">{stop.address}</span></span>
              </li>)}
            </ol>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground"><MapPin className="size-3.5" />Abrir en Google Maps</span>
          <span className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-3 text-xs font-medium transition-shadow", time > 2300 && time < 3100 && "ring-2 ring-landing-highlight")}><MessageCircle className="size-3.5" />Enviar por WhatsApp</span>
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-3 text-xs font-medium"><AnimatedIcon name="truck" size={14} />Modo repartidor</span>
        </div>
      </div>
      <Cursor x={time < 1600 ? 30 : 52} y={time < 1600 ? 55 : 92} clicking={time > 2400 && time < 2800} hidden={time > 3600} />
    </AppFrame>
  </div>;
}

/* ---------- Customers and suppliers: who buys most and which supply got dearer ---------- */

const PEOPLE_LENGTH = 12000;

export function PeopleMockup() {
  const [ref, time] = useSceneTime(PEOPLE_LENGTH, PEOPLE_LENGTH - 1);
  const highlight = Math.floor(time / 1600) % Math.max(landingPrices.length, 1);
  const lead = landingPrices[0];
  const insight = lead && lead.change !== null ? `${lead.name} con ${lead.supplier} subió ${Math.round(lead.change * 100)} %: de ${money(lead.first)} a ${money(lead.last)} por ${lead.unit}.` : "";
  return <div ref={ref} className="relative">
    <AppFrame active="proveedores" path="/proveedores" compact>
      <div className="flex flex-col gap-3">
        <ChartCard title="Quién te compra más" description="Cada bloque es un cliente, del tamaño de lo que te compró." className="p-3 sm:p-4">
          <Treemap items={landingCustomers.map((row, index) => ({ key: row.id, label: row.name, value: row.stats.revenue, color: DATA_COLORS[index % DATA_COLORS.length], detail: `${row.stats.sales} compras` }))} format={money} height={150} label="Clientes por lo que compraron" />
        </ChartCard>
        <section className="rounded-2xl border bg-card p-3 shadow-xs sm:p-4" aria-label="Precios de tus insumos">
          <p className="text-sm font-semibold">Cómo cambiaron los precios de tus insumos</p>
          <ul className="mt-2 flex flex-col">
            {landingPrices.map((price, index) => <li key={`${price.supplier}-${price.materialId}`} className={cn("grid grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-3 rounded-lg px-2 py-1.5 transition-colors duration-500", index === highlight && "bg-muted/70")}>
              <span className="min-w-0 text-[12px]"><span className="block truncate font-medium">{price.name}</span><span className="block truncate text-muted-foreground">{price.supplier} · {money(price.last)}{price.unit ? ` por ${price.unit}` : ""}</span></span>
              <Sparkline values={price.points.map((point) => point.unitPrice)} focus={price.points.length - 1} color={(price.change ?? 0) > 0 ? "var(--data-6)" : "var(--data-1)"} height={28} label={`Precio de ${price.name}`} />
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums", (price.change ?? 0) > 0 ? "bg-[color-mix(in_oklab,var(--data-6)_14%,transparent)] text-[var(--data-6)]" : "bg-[color-mix(in_oklab,var(--data-1)_14%,transparent)] text-[var(--data-1)]")}>{(price.change ?? 0) > 0 ? "▲" : "▼"} {Math.abs(Math.round((price.change ?? 0) * 100))} %</span>
            </li>)}
          </ul>
          {insight ? <p className="mt-2 flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[12px]"><span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" /><span>{typed(insight, time, 800, 24)}</span></p> : null}
        </section>
      </div>
    </AppFrame>
  </div>;
}
