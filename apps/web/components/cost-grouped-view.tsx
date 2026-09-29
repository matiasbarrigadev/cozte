"use client";

import type { Material, SharedExpense } from "@/lib/domain";
import type { Currency } from "@/lib/currency";
import { BEHAVIOR_GROUPS, SUPPLY_BEHAVIOR_HINT, behaviorGroup, behaviorLabel, type BehaviorGroup } from "@/lib/cost-behavior";
import { CostTypePill } from "@/components/business/cost-behavior-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const GROUP_ORDER: BehaviorGroup[] = ["variable", "fixed", "mixed"];
const GROUP_BORDERS: Record<BehaviorGroup, string> = { variable: "var(--data-4)", fixed: "color-mix(in oklab, var(--muted-foreground) 45%, transparent)", mixed: "var(--data-2)" };

/** The production costs as cards: first split into variable, fixed and mixed, then by the business's categories. */
export function CostGroupedView({ view, categories, materials, expenses, currency, draft, totals, hints, labor, canEdit, onAllocation, onBehavior }: {
  view: "list" | "board";
  categories: string[];
  materials: Material[];
  expenses: SharedExpense[];
  currency: string;
  draft: { materials: Record<string, number>; expenses: Record<string, number>; materialCurrencies: Record<string, Currency>; expenseCurrencies: Record<string, Currency> };
  totals: Record<BehaviorGroup, string>;
  hints: Record<BehaviorGroup, string>;
  /** Labor paid per lot in a normal month, already formatted; it is set on each product. */
  labor: string | null;
  canEdit: boolean;
  onAllocation: (expense: SharedExpense) => void;
  onBehavior: (expense: SharedExpense) => void;
}) {
  const money = (amount: number | null, code: string) => amount == null ? "Sin precio" : new Intl.NumberFormat("es-CL", { style: "currency", currency: code, maximumFractionDigits: 3 }).format(amount);
  const groups = GROUP_ORDER.map((group) => ({ group, materials: group === "variable" ? materials : [], expenses: expenses.filter((item) => behaviorGroup(item) === group) }))
    .filter((entry) => entry.materials.length + entry.expenses.length > 0 || (entry.group === "variable" && labor));
  return <div className="flex flex-col gap-5 p-4">
    {groups.map((entry) => <section key={entry.group} aria-label={BEHAVIOR_GROUPS[entry.group].title} className="flex flex-col gap-3">
      <header className="border-l-4 pl-3" style={{ borderLeftColor: GROUP_BORDERS[entry.group] }}>
        <div className="flex flex-wrap items-baseline gap-x-3"><h2 className="font-semibold">{BEHAVIOR_GROUPS[entry.group].title}</h2><span className="text-sm tabular-nums">{totals[entry.group]}</span></div>
        <p className="text-xs text-muted-foreground">{hints[entry.group]}</p>
      </header>
      {entry.group === "variable" && labor ? <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-card px-3 py-2 text-sm"><strong>Mano de obra por lote</strong><CostTypePill group="variable" label="Variable" /><span className="text-xs text-muted-foreground">Se paga por tanda y se define en cada producto · ≈ {labor} al mes</span></div> : null}
      <div className={view === "board" ? "grid gap-3 overflow-x-auto md:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-4"}>
        {categories.map((name) => {
          const rows = [...entry.materials.filter((item) => item.category === name).map((item) => ({ kind: "direct" as const, item })), ...entry.expenses.filter((item) => item.category === name).map((item) => ({ kind: "shared" as const, item }))];
          if (!rows.length) return null;
          return <section key={name} className="rounded-xl border bg-card p-3"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-semibold">{name}</h3><Badge variant="secondary">{rows.length}</Badge></div><div className={view === "board" ? "space-y-2" : "grid gap-2 sm:grid-cols-2 xl:grid-cols-3"}>
            {rows.map(({ kind, item }) => <article key={`${kind}-${item.id}`} className="rounded-lg border bg-background p-3 text-sm">
              <div className="flex items-start justify-between gap-2"><strong>{item.name}</strong><Badge variant="outline">{kind === "direct" ? "Directo" : "Compartido"}</Badge></div>
              {kind === "direct" ? <>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5" title={SUPPLY_BEHAVIOR_HINT}><CostTypePill group="variable" label="Variable" /><span className="text-[11px] text-muted-foreground">Según la receta</span></div>
                <p className="mt-1 text-xs text-muted-foreground">{item.supplier || "Sin proveedor"} · por {item.purchaseUnit}</p>
                <p className="mt-2 font-medium tabular-nums">{draft.materialCurrencies[item.id] !== undefined && draft.materials[item.id] === undefined ? "Importe pendiente" : money(draft.materials[item.id] ?? (item.nativeAmountMilli == null ? item.priceMinor : item.nativeAmountMilli / 1000), draft.materialCurrencies[item.id] ?? item.currency ?? currency)}</p>
                {draft.materials[item.id] !== undefined || draft.materialCurrencies[item.id] !== undefined ? <Badge variant="secondary">Borrador</Badge> : null}
              </> : <>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><CostTypePill group={behaviorGroup(item)} label={behaviorLabel(item).label} onClick={canEdit ? () => onBehavior(item) : undefined} title={item.behaviorNote || "Cambiar si es fijo, variable o mixto"} /><span className="text-[11px] text-muted-foreground">{behaviorLabel(item).detail}</span></div>
                <p className="mt-1 text-xs text-muted-foreground">{item.period} · {item.allocationBasis === "manual" ? "Porcentajes" : item.allocationBasis === "hours" ? "Horas" : "Unidades"}</p>
                <p className="mt-2 font-medium tabular-nums">{draft.expenseCurrencies[item.id] !== undefined && draft.expenses[item.id] === undefined ? "Importe pendiente" : money(draft.expenses[item.id] ?? (item.nativeAmountMilli == null ? item.amountMinor : item.nativeAmountMilli / 1000), draft.expenseCurrencies[item.id] ?? item.currency ?? currency)}</p>
                {draft.expenses[item.id] !== undefined || draft.expenseCurrencies[item.id] !== undefined ? <Badge variant="secondary">Borrador</Badge> : null}
                {behaviorGroup(item) !== "variable" ? <Button size="sm" variant="ghost" className="mt-1 px-0" onClick={() => onAllocation(item)}>Configurar reparto</Button> : null}
              </>}
            </article>)}
          </div></section>;
        })}
      </div>
    </section>)}
  </div>;
}
