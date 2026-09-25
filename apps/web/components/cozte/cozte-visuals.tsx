"use client";

import * as React from "react";
import { analyzeCosts, type CostAnalysis } from "@/lib/cost-analysis";
import { AREA_LABELS, PURCHASE_KIND_LABELS, type BusinessView } from "@/lib/business";
import { productionCostSources, type DomainState, type ProductCost } from "@/lib/domain";
import { DEMO_MONTH, demoHistory } from "@/lib/demo";
import { WIDGETS, type WidgetKind } from "@/lib/cozte-widgets";
import { TimeLineChart, type TimeSeries } from "@/components/charts/time-line-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnimatedIcon } from "@/components/animated-icon";
import { cn } from "@/lib/utils";
import { formatDate, useBusinessView, useMoney } from "@/components/business/business-ui";
import { CompositionBar, CompositionLegend } from "@/components/business/composition";

type Dashboard = DomainState & { costs: ProductCost[] };
type VisualData = { state: Dashboard; demo: boolean; business: BusinessView | null; analysis: CostAnalysis | null; requestAnalysis: () => void; money: (value: number) => string };

const VisualContext = React.createContext<VisualData | null>(null);
const SERIES = Array.from({ length: 8 }, (_, index) => `var(--chart-series-${index + 1})`);

/**
 * Live data for every visual in the chat and on the board: one fetch of the month and, only when a chart needs it,
 * one of the cost history. Everything comes from the engine, never from the model's text.
 */
export function CozteVisualProvider({ state, demo, refreshKey, children }: { state: Dashboard; demo: boolean; refreshKey: number; children: React.ReactNode }) {
  const month = demo ? DEMO_MONTH : new Date().toISOString().slice(0, 7);
  const { view } = useBusinessView(month, demo, state, refreshKey);
  const money = useMoney(state.organization.currency);
  const [wantAnalysis, setWantAnalysis] = React.useState(false);
  const [fetched, setFetched] = React.useState<CostAnalysis | null>(null);
  const demoAnalysis = React.useMemo(() => demo && wantAnalysis ? analyzeCosts(demoHistory(), { granularity: "month", currency: state.organization.currency }) : null, [demo, wantAnalysis, state.organization.currency]);
  React.useEffect(() => {
    if (demo || !wantAnalysis) return;
    let active = true;
    fetch("/api/analysis?granularity=month", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<CostAnalysis> : null).then((data) => { if (active && data) setFetched(data); }).catch(() => {});
    return () => { active = false; };
  }, [demo, wantAnalysis, state.revision, refreshKey]);
  const requestAnalysis = React.useCallback(() => setWantAnalysis(true), []);
  const value = React.useMemo(() => ({ state, demo, business: view, analysis: demo ? demoAnalysis : fetched, requestAnalysis, money }), [state, demo, view, demoAnalysis, fetched, requestAnalysis, money]);
  return <VisualContext.Provider value={value}>{children}</VisualContext.Provider>;
}

function useVisualData() {
  const data = React.useContext(VisualContext);
  if (!data) throw new Error("CozteVisual must be inside CozteVisualProvider");
  return data;
}

/** Which predefined visuals have something to show right now. */
export function useAvailableVisuals(): { kind: WidgetKind; productId?: string; label: string }[] {
  const { state, business } = useVisualData();
  if (!state.products.length) return [];
  return [
    { kind: "unit-cost", label: WIDGETS["unit-cost"].label },
    ...state.products.map((product) => ({ kind: "cost-breakdown" as const, productId: product.id, label: `Desglose de ${product.name}` })),
    { kind: "channels", label: WIDGETS.channels.label },
    { kind: "month", label: WIDGETS.month.label },
    ...(business?.sales.length ? [{ kind: "sales" as const, label: WIDGETS.sales.label }] : []),
    { kind: "cost-evolution", label: WIDGETS["cost-evolution"].label },
    ...(business?.purchases.length || business?.investments.length ? [{ kind: "purchases" as const, label: WIDGETS.purchases.label }] : []),
  ];
}

/** A visual as a card: title, live data, and pin or remove actions depending on where it sits. */
export function CozteVisual({ kind, productId, onPin, onRemove, compact }: { kind: WidgetKind; productId?: string | null; onPin?: () => void; onRemove?: () => void; compact?: boolean }) {
  const { state } = useVisualData();
  const product = productId ? state.products.find((item) => item.id === productId) : undefined;
  const title = kind === "cost-breakdown" && product ? `Desglose de ${product.name}` : kind === "channels" && product ? `Te queda por canal · ${product.name}` : WIDGETS[kind].label;
  return <section aria-label={title} className={cn("flex w-full min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 text-card-foreground", !compact && "max-w-xl")}>
    <header className="flex items-start justify-between gap-2">
      <div className="min-w-0"><h3 className="truncate text-sm font-semibold">{title}</h3><p className="text-[11px] text-muted-foreground">Datos actuales</p></div>
      <div className="flex shrink-0 items-center gap-1">
        {onPin ? <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onPin}><AnimatedIcon name="plus" data-icon="inline-start" size={14} />Fijar en tablero</Button> : null}
        {onRemove ? <Button type="button" size="icon-sm" variant="ghost" aria-label={`Quitar ${title} del tablero`} onClick={onRemove}><AnimatedIcon name="close" size={14} /></Button> : null}
      </div>
    </header>
    <VisualBody kind={kind} productId={productId ?? null} />
  </section>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-xs text-muted-foreground">{children}</p>;
}

function VisualBody({ kind, productId }: { kind: WidgetKind; productId: string | null }) {
  switch (kind) {
    case "unit-cost": return <UnitCostVisual />;
    case "cost-breakdown": return <BreakdownVisual productId={productId} />;
    case "channels": return <ChannelsVisual productId={productId} />;
    case "month": return <MonthVisual />;
    case "sales": return <SalesVisual />;
    case "cost-evolution": return <EvolutionVisual />;
    case "purchases": return <PurchasesVisual />;
  }
}

function UnitCostVisual() {
  const { state, money } = useVisualData();
  if (!state.products.length) return <Empty>Todavía no hay productos.</Empty>;
  return <div className="flex flex-col gap-2.5">
    <CompositionLegend />
    {state.products.map((product) => {
      const cost = state.costs.find((item) => item.productId === product.id);
      return <div key={product.id} className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate">{product.name}</span><span className="font-semibold tabular-nums">{cost?.unitMinor != null ? money(cost.unitMinor) : <span className="text-xs font-normal text-muted-foreground">Incompleto</span>}</span></div>
        {cost?.perUnit && cost.unitMinor ? <CompositionBar parts={{ productId: product.id, name: product.name, unitCost: cost.unitMinor, materials: cost.perUnit.materialMinor, labor: cost.perUnit.laborMinor, shared: cost.perUnit.sharedMinor }} format={money} /> : null}
      </div>;
    })}
  </div>;
}

/** Horizontal bars, one hue: magnitude of each concept in one unit's cost. */
function Bars({ rows, money, total }: { rows: { label: string; value: number; hint?: string; tone?: "negative" }[]; money: (value: number) => string; total?: number }) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  return <ul className="flex flex-col gap-1.5">
    {rows.map((row) => <li key={row.label} className="grid grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-2 text-xs" title={row.hint}>
      <span className="truncate text-muted-foreground">{row.label}</span>
      <span className="h-2.5 rounded-full bg-muted"><span className="block h-2.5 rounded-full" style={{ width: `${Math.max(3, Math.abs(row.value) / max * 100)}%`, background: row.tone === "negative" ? "var(--chart-increase)" : "var(--chart-series-1)" }} /></span>
      <span className="text-right font-medium tabular-nums">{money(row.value)}{total ? <span className="ml-1 font-normal text-muted-foreground">{Math.round(row.value / total * 100)} %</span> : null}</span>
    </li>)}
  </ul>;
}

function BreakdownVisual({ productId }: { productId: string | null }) {
  const { state, money } = useVisualData();
  const product = state.products.find((item) => item.id === productId) ?? state.products[0];
  const cost = product ? state.costs.find((item) => item.productId === product.id) : undefined;
  if (!product || !cost) return <Empty>No encontré ese producto.</Empty>;
  const lotUnits = Math.max(product.lotUnits, 1);
  const names = new Map(productionCostSources(state).map((item) => [item.id, item.name]));
  const rows = [
    ...cost.lines.filter((line) => line.kind === "material" && line.amountMinor > 0).map((line) => ({ label: line.label, value: line.amountMinor / lotUnits })),
    ...(cost.perUnit?.laborMinor ? [{ label: "Mano de obra directa", value: cost.perUnit.laborMinor }] : []),
    ...Object.entries(cost.monthly.sharedByExpense).map(([id, monthly]) => ({ label: names.get(id) ?? "Gasto compartido", value: monthly / Math.max(cost.monthly.units, 1) })),
  ].sort((a, b) => b.value - a.value);
  const total = cost.unitMinor ?? cost.partialUnitMinor;
  return <div className="flex flex-col gap-2">
    <p className="text-sm">Cada unidad cuesta <span className="font-semibold tabular-nums">{money(total)}</span>{cost.unitMinor === null ? <span className="text-xs text-muted-foreground"> (lo conocido hasta ahora)</span> : null}</p>
    {rows.length ? <Bars rows={rows} money={money} total={total} /> : <Empty>Todavía no tiene insumos ni gastos asociados.</Empty>}
  </div>;
}

function ChannelsVisual({ productId }: { productId: string | null }) {
  const { business, money } = useVisualData();
  if (!business) return <Empty>Cargando…</Empty>;
  const rows = business.economics.filter((row) => !productId || row.productId === productId);
  const products = [...new Set(rows.map((row) => row.productId))];
  if (!rows.some((row) => row.left !== null)) return <Empty>Falta el precio de venta o el costo completo para calcularlo.</Empty>;
  return <div className="flex flex-col gap-3">
    {products.map((id) => {
      const own = rows.filter((row) => row.productId === id && row.left !== null);
      return <div key={id} className="flex flex-col gap-1.5">
        {products.length > 1 ? <span className="text-xs font-medium">{own[0]?.productName}</span> : null}
        <Bars rows={own.map((row) => ({ label: row.channelName, value: row.left!, tone: row.left! < 0 ? "negative" as const : undefined, hint: `Precio ${money(row.price ?? 0)} − producir ${money(row.productionCost ?? 0)} − vender ${money(row.sellingCost ?? 0)} − entregar ${money(row.deliveryCost)}` }))} money={money} />
      </div>;
    })}
    <p className="text-[11px] text-muted-foreground">Lo que queda por unidad después de producir, vender y entregar.</p>
  </div>;
}

function MonthVisual() {
  const { business, money } = useVisualData();
  if (!business) return <Empty>Cargando…</Empty>;
  const result = business.result;
  const progress = result.breakEvenRevenue ? Math.min(100, Math.round(result.revenue / result.breakEvenRevenue * 100)) : null;
  return <div className="flex flex-col gap-2 text-sm">
    <div className="flex items-baseline justify-between gap-2"><span className="text-muted-foreground">{result.result >= 0 ? "Ganancia del mes" : "Pérdida del mes"}</span><span className={cn("text-xl font-semibold tabular-nums", result.sales && result.result < 0 && "text-destructive")}>{money(result.result)}</span></div>
    <div className="grid grid-cols-3 gap-2 text-xs">
      <div><p className="text-muted-foreground">Vendiste</p><p className="font-medium tabular-nums">{money(result.revenue)}</p></div>
      <div><p className="text-muted-foreground">Te dejaron</p><p className="font-medium tabular-nums">{money(result.contribution)}</p></div>
      <div><p className="text-muted-foreground">Gastos fijos</p><p className="font-medium tabular-nums">{money(result.fixedTotal + result.investmentsShare)}</p></div>
    </div>
    {result.breakEvenRevenue !== null ? <div className="flex flex-col gap-1">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Llevas ${progress} % del punto de equilibrio`}><div className="h-full rounded-full" style={{ width: `${progress}%`, background: progress! >= 100 ? "var(--chart-decrease)" : "var(--chart-series-1)" }} /></div>
      <span className="text-[11px] text-muted-foreground">Para no perder: {money(result.breakEvenRevenue)} · llevas {progress} %</span>
    </div> : null}
  </div>;
}

function SalesVisual() {
  const { business, money } = useVisualData();
  if (!business) return <Empty>Cargando…</Empty>;
  if (!business.sales.length) return <Empty>No hay ventas registradas este mes.</Empty>;
  const byChannel = new Map<string, number>();
  for (const sale of business.sales) byChannel.set(sale.channelName, (byChannel.get(sale.channelName) ?? 0) + sale.totalMinor);
  const total = business.sales.reduce((sum, sale) => sum + sale.totalMinor, 0);
  return <div className="flex flex-col gap-2">
    <p className="text-sm"><span className="font-semibold tabular-nums">{money(total)}</span> <span className="text-muted-foreground">en {business.sales.length} venta{business.sales.length === 1 ? "" : "s"}</span></p>
    <Bars rows={[...byChannel].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} money={money} total={total} />
  </div>;
}

function EvolutionVisual() {
  const { analysis, requestAnalysis, money } = useVisualData();
  React.useEffect(() => { requestAnalysis(); }, [requestAnalysis]);
  if (!analysis) return <Empty>Cargando la evolución…</Empty>;
  if (analysis.periods.length < 2) return <Empty>Todavía hay un solo mes de historia; la evolución aparece a partir del segundo.</Empty>;
  const series: TimeSeries[] = analysis.products.slice(0, 8).map((product, index) => ({ key: product.id, label: product.name, color: SERIES[index], values: analysis.periods.map((period) => product.points.find((point) => point.period === period && !point.incomplete)?.unitCost ?? null) }));
  const label = (period: string) => new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${period}-01T12:00:00Z`));
  return <TimeLineChart periods={analysis.periods} periodLabel={label} series={series} formatValue={money} ariaLabel="Costo por unidad de cada producto por mes" />;
}

function PurchasesVisual() {
  const { business, money } = useVisualData();
  if (!business) return <Empty>Cargando…</Empty>;
  const items = [...business.purchases, ...business.investments.filter((item) => !business.purchases.some((purchase) => purchase.id === item.id))].sort((a, b) => b.purchasedOn.localeCompare(a.purchasedOn)).slice(0, 6);
  if (!items.length) return <Empty>Todavía no hay compras registradas.</Empty>;
  return <ul className="flex flex-col gap-1.5 text-xs">
    {items.map((item) => <li key={item.id} className="flex items-center justify-between gap-2">
      <span className="min-w-0"><span className="block truncate font-medium">{item.description}</span><span className="text-muted-foreground">{formatDate(item.purchasedOn)} · {AREA_LABELS[item.area]}</span></span>
      <span className="flex shrink-0 items-center gap-2"><Badge variant="outline" className="text-[10px]">{PURCHASE_KIND_LABELS[item.kind]}</Badge><span className="tabular-nums">{money(item.amountMinor)}</span></span>
    </li>)}
  </ul>;
}
