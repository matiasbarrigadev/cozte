"use client";

import type { Material, SharedExpense } from "@/lib/domain";
import type { Currency } from "@/lib/currency";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function CostGroupedView({ view, categories, materials, expenses, currency, draft, onAllocation }: {
  view: "list" | "board";
  categories: string[];
  materials: Material[];
  expenses: SharedExpense[];
  currency: string;
  draft: { materials: Record<string, number>; expenses: Record<string, number>; materialCurrencies: Record<string, Currency>; expenseCurrencies: Record<string, Currency> };
  onAllocation: (expense: SharedExpense) => void;
}) {
  const money = (amount: number | null, code: string) => amount == null ? "Sin precio" : new Intl.NumberFormat("es-CL", { style: "currency", currency: code, maximumFractionDigits: 3 }).format(amount);
  return <div className={view === "board" ? "grid gap-3 overflow-x-auto p-4 md:grid-cols-2 xl:grid-cols-3" : "space-y-4 p-4"}>
    {categories.map((name) => {
      const rows = [...materials.filter((item) => item.category === name).map((item) => ({ kind: "direct" as const, item })), ...expenses.filter((item) => item.category === name).map((item) => ({ kind: "shared" as const, item }))];
      if (!rows.length) return null;
      return <section key={name} className="rounded-xl border bg-card p-3"><div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-semibold">{name}</h2><Badge variant="secondary">{rows.length}</Badge></div><div className={view === "board" ? "space-y-2" : "grid gap-2 sm:grid-cols-2 xl:grid-cols-3"}>
        {rows.map(({ kind, item }) => <article key={`${kind}-${item.id}`} className="rounded-lg border bg-background p-3 text-sm"><div className="flex items-start justify-between gap-2"><strong>{item.name}</strong><Badge variant="outline">{kind === "direct" ? "Directo" : "Compartido"}</Badge></div>{kind === "direct" ? <><p className="mt-1 text-xs text-muted-foreground">{item.supplier || "Sin proveedor"} · por {item.purchaseUnit}</p><p className="mt-2 font-medium tabular-nums">{draft.materialCurrencies[item.id] !== undefined && draft.materials[item.id] === undefined ? "Importe pendiente" : money(draft.materials[item.id] ?? (item.nativeAmountMilli == null ? item.priceMinor : item.nativeAmountMilli / 1000), draft.materialCurrencies[item.id] ?? item.currency ?? currency)}</p>{draft.materials[item.id] !== undefined || draft.materialCurrencies[item.id] !== undefined ? <Badge variant="secondary">Borrador</Badge> : null}</> : <><p className="mt-1 text-xs text-muted-foreground">{item.period} · {item.allocationBasis === "manual" ? "Porcentajes" : item.allocationBasis === "hours" ? "Horas" : "Unidades"}</p><p className="mt-2 font-medium tabular-nums">{draft.expenseCurrencies[item.id] !== undefined && draft.expenses[item.id] === undefined ? "Importe pendiente" : money(draft.expenses[item.id] ?? (item.nativeAmountMilli == null ? item.amountMinor : item.nativeAmountMilli / 1000), draft.expenseCurrencies[item.id] ?? item.currency ?? currency)}</p>{draft.expenses[item.id] !== undefined || draft.expenseCurrencies[item.id] !== undefined ? <Badge variant="secondary">Borrador</Badge> : null}<Button size="sm" variant="ghost" className="mt-1 px-0" onClick={() => onAllocation(item)}>Configurar reparto</Button></>}</article>)}
      </div></section>;
    })}
  </div>;
}
