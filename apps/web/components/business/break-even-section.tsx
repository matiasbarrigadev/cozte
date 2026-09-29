"use client";

import * as React from "react";
import { toast } from "sonner";
import { BEHAVIOR_LABELS, DRIVER_LABELS, MIX_SOURCE_LABELS, type BreakEvenPlan, type CostItem, type MixBasis, type MixSource, type SalesMixPlan } from "@/lib/break-even";
import type { DomainState } from "@/lib/domain";
import { demoBreakEven } from "@/lib/demo-store";
import { AnimatedIcon } from "@/components/animated-icon";
import { ChartCard, DATA_COLORS, ProportionBar } from "@/components/analysis/charts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";
import { SectionHeader, businessAction, notifySaved, useDemoVersion, useMoney } from "./business-ui";
import { CostBehaviorDialog, type BehaviorChange } from "./cost-behavior-dialog";

/**
 * The break-even of a normal month in three steps, the way a small business reads it: the fixed costs in one list that
 * adds up, what each product costs and leaves per unit, and how sales split between products; from those, how many of
 * each to sell. How each cost behaves and the mix are the business's own choices, always visible and editable.
 */

type Data = { plan: BreakEvenPlan; mix: SalesMixPlan; month: string; lastMonth: string };

const PART_COLORS = { materials: DATA_COLORS[0], labor: DATA_COLORS[1], expenses: DATA_COLORS[3], selling: DATA_COLORS[4], left: "var(--data-3)" };
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
const count = (value: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(value);

function useBreakEven(demo: boolean, refreshKey: number) {
  const demoChanges = useDemoVersion(demo);
  const [loaded, setLoaded] = React.useState<Data | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (demo) return;
    let active = true;
    fetch("/api/break-even", { cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo calcular el punto de equilibrio"); return body as Data; })
      .then((data) => { if (active) setLoaded(data); })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "No se pudo calcular el punto de equilibrio"));
    return () => { active = false; };
  }, [demo, refreshKey, tick]);
  const demoData = React.useMemo(() => demo ? demoBreakEven() : null, [demo, demoChanges]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data: demoData ?? loaded, reload: () => setTick((value) => value + 1) };
}

export function BreakEvenSection({ state, demo, onSaveChange, onOpenExpenses, onOpenCozte }: {
  state: DomainState; demo: boolean;
  /** Saves a cost change (update-expense-behavior) through the workspace; true when it was confirmed. */
  onSaveChange: (action: Record<string, unknown>) => Promise<boolean>;
  onOpenExpenses?: () => void; onOpenCozte?: () => void;
}) {
  const { data, reload } = useBreakEven(demo, state.revision);
  const money = useMoney(state.organization.currency);
  const [editing, setEditing] = React.useState<CostItem | null>(null);

  async function saveBehavior(change: BehaviorChange) {
    try {
      if (demo) { const result = await businessAction<{ done: string[] }>({ action: "save-expense-behavior", change }, true); notifySaved(result.done[0]); }
      else if (!await onSaveChange({ action: "update-expense-behavior", ...change })) return false;
      reload();
      return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar"); return false; }
  }
  async function saveMix(mix: Record<string, unknown>, message = "Mezcla de ventas guardada") {
    try { await businessAction({ action: "save-sales-mix", mix }, demo); notifySaved(message); reload(); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar"); return false; }
  }

  return <>
    <SectionHeader eyebrow="Costos" title="Punto de equilibrio" description="Cuánto tenés que vender de cada producto en un mes normal para cubrir tus costos fijos, en tres pasos: tus costos fijos, lo que cuesta y deja cada producto, y cómo se reparten tus ventas.">
      {onOpenCozte ? <Button variant="outline" onClick={onOpenCozte}><AnimatedIcon name="sparkles" data-icon="inline-start" />Armarlo con Cozte</Button> : null}
    </SectionHeader>
    {!data ? <TextShimmer className="text-sm">Calculando…</TextShimmer> : <div className="flex flex-col gap-6">
      <Summary plan={data.plan} money={money} />
      <div className="grid gap-4 xl:grid-cols-2">
        <FixedStep plan={data.plan} money={money} onEdit={setEditing} onOpenExpenses={onOpenExpenses} />
        <ProductsStep plan={data.plan} money={money} />
      </div>
      <MixStep key={JSON.stringify(data.mix)} data={data} money={money} onSave={saveMix} />
      <Assumptions plan={data.plan} onEdit={(id) => { const item = [...data.plan.fixed.items, ...data.plan.variableItems].find((row) => row.id === id); if (item) setEditing(item); }} />
    </div>}
    {editing ? <CostBehaviorDialog item={editing} money={money} onClose={() => setEditing(null)} onSave={async (change) => { if (await saveBehavior(change)) setEditing(null); }} /> : null}
  </>;
}

/** The answer first: how many units (and how much money) to sell to cover the month, and to earn the target. */
function Summary({ plan, money }: { plan: BreakEvenPlan; money: (value: number) => string }) {
  const ready = plan.products.filter((product) => product.unitsNeeded !== null);
  return <section className="grid gap-4 rounded-2xl border bg-card p-5 shadow-xs lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]" aria-label="Punto de equilibrio">
    <div className="flex flex-col gap-1">
      <p className="text-sm text-muted-foreground">Para cubrir {money(plan.fixed.total)} de costos fijos, vendé por mes</p>
      {plan.breakEven ? <>
        <p className="text-4xl font-semibold tracking-tight tabular-nums">{count(plan.breakEven.units)} unidades</p>
        <p className="text-sm text-muted-foreground">Unos {money(plan.breakEven.revenue)} en ventas{plan.target ? ` · para ganar ${money(plan.target.profit)}: ${count(plan.target.units)} unidades (${money(plan.target.revenue)})` : ""}</p>
      </> : <p className="text-lg font-medium">{plan.warnings.at(-1) ?? "Todavía no se puede calcular"}</p>}
    </div>
    {ready.length ? <ul className="flex flex-col gap-2.5" aria-label="Unidades por producto">
      {ready.map((product, index) => {
        const progress = product.unitsNeeded ? Math.min(1, product.soldUnits / product.unitsNeeded) : 0;
        return <li key={product.productId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
          <span className="flex min-w-0 items-center gap-2 text-sm"><span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: DATA_COLORS[index % DATA_COLORS.length] }} aria-hidden="true" /><span className="truncate font-medium">{product.name}</span></span>
          <span className="text-right text-sm tabular-nums"><strong>{count(product.unitsNeeded ?? 0)}</strong> <span className="text-muted-foreground">u · {money(product.revenueNeeded ?? 0)}</span></span>
          <span className="col-span-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full" style={{ width: `${progress * 100}%`, background: DATA_COLORS[index % DATA_COLORS.length] }} /></span>
            <span className="tabular-nums">{count(product.soldUnits)} vendidas este mes</span>
          </span>
        </li>;
      })}
    </ul> : null}
  </section>;
}

function BehaviorChip({ item, onClick }: { item: CostItem; onClick?: () => void }) {
  const tone = item.behavior === "fixed" ? "bg-muted text-muted-foreground" : "bg-[color-mix(in_oklab,var(--data-4)_14%,transparent)] text-[var(--data-4)]";
  const text = item.behavior === "fixed" ? "Fijo" : item.behavior === "variable" ? `Crece con ${DRIVER_LABELS[item.driver ?? "unit"]}` : `Mixto · ${item.variablePercent} % crece`;
  return <button type="button" onClick={onClick} disabled={!onClick || item.kind !== "expense"} className={cn("inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium enabled:hover:ring-1 enabled:hover:ring-foreground/30", tone)} title={item.kind === "expense" ? "Cambiar cómo se comporta" : undefined}>{text}</button>;
}

/** Step 1: every fixed cost of the month in one list, by category, adding up. */
function FixedStep({ plan, money, onEdit, onOpenExpenses }: { plan: BreakEvenPlan; money: (value: number) => string; onEdit: (item: CostItem) => void; onOpenExpenses?: () => void }) {
  const groups = plan.fixed.byCategory.map((group) => ({ ...group, items: plan.fixed.items.filter((item) => item.category === group.category) }));
  return <ChartCard title="1 · Costos fijos del mes" description="Lo que pagás aunque produzcas o vendas poco. Tocá la etiqueta de un gasto para decir si crece con la producción."
    action={onOpenExpenses ? <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onOpenExpenses}>Editar gastos</Button> : undefined}
    table={{ columns: ["Categoría", "Gasto", "Fijo por mes", "Cómo se comporta"], rows: plan.fixed.items.map((item) => [item.category, item.name, money(item.fixedPart), BEHAVIOR_LABELS[item.behavior]]) }}>
    <p className="text-3xl font-semibold tabular-nums">{money(plan.fixed.total)} <span className="text-sm font-normal text-muted-foreground">por mes</span></p>
    <div className="flex flex-col gap-3">
      {groups.map((group) => <div key={group.category} className="flex flex-col gap-1">
        <p className="flex justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase"><span>{group.category}</span><span className="tabular-nums">{money(group.amount)}</span></p>
        <ul className="flex flex-col divide-y rounded-xl border">{group.items.map((item) => <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
          <span className="min-w-0 truncate">{item.name}</span>
          <span className="text-right font-medium tabular-nums">{money(item.fixedPart)}</span>
          <span className="col-span-2"><BehaviorChip item={item} onClick={() => onEdit(item)} /></span>
        </li>)}</ul>
      </div>)}
    </div>
    {plan.variableItems.length ? <div className="rounded-xl bg-muted/50 p-3 text-sm">
      <p className="font-medium">Pasan al costo de cada unidad</p>
      <ul className="mt-1 flex flex-col gap-1">{plan.variableItems.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2"><span>{item.name}: {money(item.variablePart)} al mes</span><BehaviorChip item={item} onClick={() => onEdit(item)} /></li>)}</ul>
    </div> : null}
    {plan.suggestions.map((item) => <button key={item.expenseId} type="button" onClick={() => { const row = plan.fixed.items.find((cost) => cost.id === item.expenseId); if (row) onEdit(row); }} className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-left text-sm hover:bg-amber-50 dark:border-amber-400/30 dark:bg-amber-500/5">
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" /><span>{item.text} <span className="font-medium underline-offset-4 hover:underline">Revisar</span></span>
    </button>)}
  </ChartCard>;
}

/** Step 2: each product's sheet: what one unit costs to make and sell, and what it leaves. */
function ProductsStep({ plan, money }: { plan: BreakEvenPlan; money: (value: number) => string }) {
  return <ChartCard title="2 · Lo que cuesta y deja cada producto" description="Por unidad: materia prima, mano de obra que se paga por tanda, gastos que crecen con la producción y costos de vender. Lo que sobra del precio te deja para cubrir los fijos."
    table={{ columns: ["Producto", "Precio", "Materiales", "Mano de obra", "Gastos variables", "Vender", "Costo variable", "Te deja"], rows: plan.products.map((product) => [product.name, money(product.price), money(product.variable.materials), money(product.variable.labor), money(product.variable.expenses), money(product.variable.selling), money(product.variable.total), product.contributionUnit === null ? "—" : money(product.contributionUnit)]) }}>
    <ul className="flex flex-col gap-4">
      {plan.products.map((product) => <li key={product.productId} className="flex flex-col gap-2 rounded-xl border p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="font-medium">{product.name}</p><p className="text-sm text-muted-foreground tabular-nums">Precio {money(product.price)}</p></div>
        {product.missing ? <p className="text-sm text-amber-700 dark:text-amber-300">{product.missing}.</p> : <>
          <ProportionBar parts={[
            { key: "materials", label: "Materia prima", value: product.variable.materials, color: PART_COLORS.materials },
            { key: "labor", label: "Mano de obra por tanda", value: product.variable.labor, color: PART_COLORS.labor },
            { key: "expenses", label: "Gastos que crecen con la producción", value: product.variable.expenses, color: PART_COLORS.expenses },
            { key: "selling", label: "Costos de vender", value: product.variable.selling, color: PART_COLORS.selling },
            { key: "left", label: "Te deja", value: Math.max(0, product.contributionUnit ?? 0), color: PART_COLORS.left },
          ]} format={money} height={14} label={`De qué está hecho el precio de ${product.name}`} />
          <p className="text-sm"><span className="text-muted-foreground">Cuesta {money(product.variable.total)} hacer y vender una unidad · </span><strong className={cn((product.contributionUnit ?? 0) <= 0 && "text-destructive")}>te deja {money(product.contributionUnit ?? 0)}</strong>{product.contributionRatio !== null ? <span className="text-muted-foreground"> ({Math.round(product.contributionRatio * 100)} % del precio)</span> : null}</p>
        </>}
      </li>)}
    </ul>
  </ChartCard>;
}

/** Step 3: how sales split between products, in units or revenue, and from where; then the target profit. */
function MixStep({ data, money, onSave }: { data: Data; money: (value: number) => string; onSave: (mix: Record<string, unknown>, message?: string) => Promise<boolean> }) {
  const { plan, mix } = data;
  const ready = plan.products.filter((product) => !product.missing);
  const initial = Object.fromEntries(ready.map((product) => [product.productId, Math.round((mix.basis === "units" ? product.unitShare : product.revenueShare) * 100)]));
  const [draft, setDraft] = React.useState<Record<string, number>>(initial);
  const [target, setTarget] = React.useState(mix.targetProfitMinor ? String(mix.targetProfitMinor) : "");
  const total = Object.values(draft).reduce((sum, value) => sum + value, 0);
  const edited = Object.entries(draft).some(([id, value]) => value !== initial[id]);
  const sources: MixSource[] = ["auto", "last_month", "plan", "equal"];
  return <ChartCard title="3 · Cómo se reparten tus ventas" description="Qué parte de lo que vendés es cada producto. Con eso sale cuánto vender de cada uno.">
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Expresada</span>
      <div className="flex rounded-md border p-0.5" role="group" aria-label="Base de la mezcla">
        {(["units", "revenue"] as MixBasis[]).map((basis) => <button key={basis} type="button" aria-pressed={mix.basis === basis} onClick={() => void onSave({ basis }, basis === "units" ? "Mezcla por unidades" : "Mezcla por facturación")}
          className={cn("rounded px-2 py-1 font-medium", mix.basis === basis ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{basis === "units" ? "Por unidades" : "Por facturación"}</button>)}
      </div>
      <span className="ml-2 text-muted-foreground">Según</span>
      {sources.map((source) => <button key={source} type="button" aria-pressed={mix.source === source} onClick={() => void onSave({ source }, `Mezcla: ${MIX_SOURCE_LABELS[source].toLowerCase()}`)}
        className={cn("rounded-full border px-2.5 py-1 font-medium", mix.source === source ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>{source === "last_month" ? `Lo vendido en ${monthName(data.lastMonth)}` : MIX_SOURCE_LABELS[source]}</button>)}
      {mix.source === "manual" ? <span className="rounded-full border border-foreground bg-foreground px-2.5 py-1 font-medium text-background">Elegida por vos</span> : null}
    </div>
    <p className="text-xs text-muted-foreground">Ahora: {MIX_SOURCE_LABELS[plan.mix.used].toLowerCase()}{plan.mix.used === "last_month" ? ` (${monthName(data.lastMonth)})` : ""}. Si cambiás un porcentaje, pasa a ser tu mezcla elegida.</p>
    <ProportionBar parts={ready.map((product, index) => ({ key: product.productId, label: product.name, value: draft[product.productId] ?? 0, color: DATA_COLORS[index % DATA_COLORS.length] }))} format={(value) => `${Math.round(value)} %`} height={16} label="Mezcla de ventas" />
    <ul className="grid gap-2 sm:grid-cols-2">
      {ready.map((product, index) => <li key={product.productId} className="flex items-center gap-2 rounded-xl border px-3 py-2">
        <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: DATA_COLORS[index % DATA_COLORS.length] }} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm">{product.name}</span>
        <input type="range" min={0} max={100} value={draft[product.productId] ?? 0} onChange={(event) => setDraft((current) => ({ ...current, [product.productId]: Number(event.target.value) }))} className="w-24 accent-[var(--primary)]" aria-label={`Parte de ${product.name}`} />
        <Input type="number" min={0} max={100} value={draft[product.productId] ?? 0} onChange={(event) => setDraft((current) => ({ ...current, [product.productId]: Math.max(0, Math.min(100, Number(event.target.value) || 0)) }))} className="h-8 w-16 text-right tabular-nums" aria-label={`Porcentaje de ${product.name}`} />
        <span className="text-xs text-muted-foreground">%</span>
      </li>)}
    </ul>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className={cn("text-xs", total === 100 ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300")}>Suman {total} %{total !== 100 ? " · al guardar se ajustan a 100 %" : ""}</p>
      {edited ? <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setDraft(initial)}>Deshacer</Button><Button size="sm" disabled={total <= 0} onClick={() => void onSave({ shares: draft, source: "manual" })}>Usar esta mezcla</Button></div> : null}
    </div>
    <label className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
      <span>¿Querés ganar algo además de cubrir los fijos?</span>
      <Input type="number" min={0} step={1000} value={target} placeholder="Ganancia por mes" onChange={(event) => setTarget(event.target.value)} className="h-8 w-40 tabular-nums" />
      {String(mix.targetProfitMinor || "") !== target ? <Button size="sm" variant="outline" onClick={() => void onSave({ targetProfit: Number(target) || 0 }, Number(target) ? `Meta de ganancia: ${money(Number(target))}` : "Sin meta de ganancia")}>Calcular</Button> : null}
      {plan.target ? <span className="text-muted-foreground">Para ganar {money(plan.target.profit)}: {plan.products.filter((product) => product.targetUnits !== null).map((product) => `${count(product.targetUnits!)} de ${product.name}`).join(", ")}.</span> : null}
    </label>
  </ChartCard>;
}

/** Every choice behind the numbers, and what the data says against them. */
function Assumptions({ plan, onEdit }: { plan: BreakEvenPlan; onEdit: (id: string) => void }) {
  return <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-xs sm:p-5" aria-label="Supuestos">
    <div><h3 className="text-sm font-semibold">Supuestos de este cálculo</h3><p className="mt-0.5 text-xs text-muted-foreground">Cada uno es una decisión de tu negocio. Los que dicen «sin revisar» conviene confirmarlos.</p></div>
    {plan.alerts.map((alert) => <p key={alert} className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-sm dark:border-amber-400/30 dark:bg-amber-500/5"><span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />{alert}</p>)}
    {plan.warnings.map((warning) => <p key={warning} className="text-sm text-muted-foreground">{warning}</p>)}
    <ul className="flex flex-wrap gap-1.5">
      {plan.assumptions.map((item) => <li key={item.id}>
        <button type="button" disabled={item.kind !== "behavior"} onClick={() => onEdit(item.id.replace("behavior:", ""))} className={cn("rounded-full border px-2.5 py-1 text-left text-xs enabled:hover:bg-muted", !item.reviewed && "border-dashed")}>
          {item.text}{!item.reviewed ? <span className="ml-1 text-muted-foreground">· sin revisar</span> : null}
        </button>
      </li>)}
    </ul>
  </section>;
}
