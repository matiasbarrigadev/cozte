"use client";

import * as React from "react";
import { AlertTriangle, Check, Cloud, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import type { DomainState, Material, SharedExpense } from "@/lib/domain";
import { supportedCurrencies, toNativeMilli, type Currency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type SheetKind = "all" | "materials" | "expenses";
type Draft = { materials: Record<string, number>; expenses: Record<string, number>; materialCurrencies: Record<string, Currency>; expenseCurrencies: Record<string, Currency> };
type MetaAction = { action: "update-material-meta" | "update-expense-meta"; id: string; field: string; value: string };

function EditableText({ value, label, onCommit, disabled, className }: {
  value: string; label: string; onCommit: (value: string) => void; disabled?: boolean; className?: string;
}) {
  return <Input key={value} defaultValue={value} aria-label={label} disabled={disabled} className={cn("h-11 md:h-8", className)}
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") { event.currentTarget.value = value; event.currentTarget.blur(); }
    }}
    onBlur={(event) => {
      const next = event.currentTarget.value.trim();
      event.currentTarget.value = value;
      if (next !== value) onCommit(next);
    }} />;
}

function EditableMoney({ value, label, onCommit, disabled }: {
  value: number | null; label: string; onCommit: (value: number) => void; disabled?: boolean;
}) {
  return <Input key={value ?? "empty"} type="number" min="0" step="0.001" inputMode="decimal" defaultValue={value ?? ""}
    aria-label={label} disabled={disabled} className="h-11 min-w-28 text-right tabular-nums md:h-8"
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") { event.currentTarget.value = value === null ? "" : String(value); event.currentTarget.blur(); }
    }}
    onBlur={(event) => {
      const raw = event.currentTarget.value.trim();
      event.currentTarget.value = value === null ? "" : String(value);
      const next = Number(raw);
      if (raw === "" && value === null) return;
      try { toNativeMilli(next); } catch { toast.error("Ingresa un importe válido, con hasta tres decimales"); return; }
      if (raw === "") { toast.error("Ingresa un importe"); return; }
      if (next !== value) onCommit(next);
    }} />;
}

export function CostSheet({ state, draft, draftReady, draftStatus, canReview, busy, demo, onRetryDraft, onMaterialPrice, onExpenseAmount, onMaterialCurrency, onExpenseCurrency, onMetaChange, onAddMaterial, onAddExpense, onReview, onDiscard }: {
  state: DomainState;
  draft: Draft;
  draftReady: boolean;
  draftStatus: "loading" | "saving" | "saved" | "error";
  canReview: boolean;
  busy: boolean;
  demo: boolean;
  onRetryDraft: () => void;
  onMaterialPrice: (id: string, value: number) => void;
  onExpenseAmount: (id: string, value: number) => void;
  onMaterialCurrency: (id: string, value: Currency) => void;
  onExpenseCurrency: (id: string, value: Currency) => void;
  onMetaChange: (action: MetaAction) => void;
  onAddMaterial: () => void;
  onAddExpense: () => void;
  onReview: () => void;
  onDiscard: () => void;
}) {
  const [kind, setKind] = React.useState<SheetKind>("all");
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState("all");
  const expenses = state.expenses.filter((item) => item.period === state.activePeriod);
  const categories = [...new Set([...state.materials.map((item) => item.category), ...expenses.map((item) => item.category)])].sort();
  const selectedCategory = category === "all" || categories.includes(category) ? category : "all";
  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const matches = (name: string, group: string) => (selectedCategory === "all" || group === selectedCategory) && (!normalizedQuery || `${name} ${group}`.toLocaleLowerCase("es").includes(normalizedQuery));
  const materials = kind === "expenses" ? [] : state.materials.filter((item) => matches(`${item.name} ${item.supplier}`, item.category));
  const visibleExpenses = kind === "materials" ? [] : expenses.filter((item) => matches(item.name, item.category));
  const changedMaterialIds = state.materials.filter((item) => draft.materialCurrencies[item.id] !== undefined || (draft.materials[item.id] !== undefined && draft.materials[item.id] !== (item.nativeAmountMilli == null ? item.priceMinor : item.nativeAmountMilli / 1000)));
  const changedExpenseIds = expenses.filter((item) => draft.expenseCurrencies[item.id] !== undefined || (draft.expenses[item.id] !== undefined && draft.expenses[item.id] !== (item.nativeAmountMilli == null ? item.amountMinor : item.nativeAmountMilli / 1000)));
  const changeCount = changedMaterialIds.length + changedExpenseIds.length;
  const affectedProducts = new Set([
    ...changedMaterialIds.flatMap((item) => state.components.filter((part) => part.materialId === item.id).map((part) => part.productId)),
    ...changedExpenseIds.flatMap(() => state.products.map((item) => item.id)),
  ]);
  const canEdit = !busy && draftReady;

  function materialRow(item: Material) {
    const affected = new Set(state.components.filter((part) => part.materialId === item.id).map((part) => part.productId)).size;
    const pending = changedMaterialIds.some((entry) => entry.id === item.id);
    const selectedCurrency = draft.materialCurrencies[item.id] ?? item.currency ?? state.organization.currency;
    const displayAmount = draft.materials[item.id] ?? (draft.materialCurrencies[item.id] ? null : item.nativeAmountMilli == null ? item.priceMinor : item.nativeAmountMilli / 1000);
    return <TableRow key={`material-${item.id}`} className={pending ? "bg-accent/50" : undefined}>
      <TableCell className="min-w-48"><div className="flex items-center gap-2"><Badge variant="outline">Insumo</Badge><EditableText value={item.name} label={`Nombre de ${item.name}`} disabled={!canEdit} className="min-w-36 font-medium" onCommit={(value) => onMetaChange({ action: "update-material-meta", id: item.id, field: "name", value })} /></div></TableCell>
      <TableCell className="min-w-40"><EditableText value={item.category} label={`Categoría de ${item.name}`} disabled={!canEdit} onCommit={(value) => onMetaChange({ action: "update-material-meta", id: item.id, field: "category", value })} /></TableCell>
      <TableCell className="min-w-44"><EditableText value={item.supplier} label={`Proveedor de ${item.name}`} disabled={!canEdit} onCommit={(value) => onMetaChange({ action: "update-material-meta", id: item.id, field: "supplier", value })} /></TableCell>
      <TableCell className="min-w-32"><EditableText value={item.purchaseUnit} label={`Unidad de ${item.name}`} disabled={!canEdit} onCommit={(value) => onMetaChange({ action: "update-material-meta", id: item.id, field: "purchaseUnit", value })} /></TableCell>
      <TableCell className="min-w-28"><NativeSelect aria-label={`Moneda de ${item.name}`} value={selectedCurrency} disabled={!canEdit} className="h-11 md:h-8" onChange={(event) => onMaterialCurrency(item.id, event.target.value as Currency)}>{supportedCurrencies.map((code) => <NativeSelectOption key={code} value={code}>{code}</NativeSelectOption>)}</NativeSelect></TableCell>
      <TableCell className="min-w-36"><EditableMoney value={displayAmount} label={`Precio de ${item.name}`} disabled={!canEdit} onCommit={(value) => onMaterialPrice(item.id, value)} />{selectedCurrency !== state.organization.currency ? <span className="text-xs text-muted-foreground">{state.fxQuotes?.[selectedCurrency]?.asOf ? `${state.fxQuotes[selectedCurrency]?.source} ${state.fxQuotes[selectedCurrency]?.asOf}` : "Cotización pendiente"}</span> : null}</TableCell>
      <TableCell><Badge variant={affected > 1 ? "secondary" : "outline"}>{affected} producto{affected === 1 ? "" : "s"}</Badge></TableCell>
      <TableCell>{pending ? <Badge variant="secondary">Borrador</Badge> : <span className="text-muted-foreground">Vigente</span>}</TableCell>
    </TableRow>;
  }

  function expenseRow(item: SharedExpense) {
    const pending = changedExpenseIds.some((entry) => entry.id === item.id);
    const selectedCurrency = draft.expenseCurrencies[item.id] ?? item.currency ?? state.organization.currency;
    const displayAmount = draft.expenses[item.id] ?? (draft.expenseCurrencies[item.id] ? null : item.nativeAmountMilli == null ? item.amountMinor : item.nativeAmountMilli / 1000);
    return <TableRow key={`expense-${item.id}`} className={pending ? "bg-accent/50" : undefined}>
      <TableCell className="min-w-48"><div className="flex items-center gap-2"><Badge variant="outline">Gasto</Badge><EditableText value={item.name} label={`Nombre de ${item.name}`} disabled={!canEdit} className="min-w-36 font-medium" onCommit={(value) => onMetaChange({ action: "update-expense-meta", id: item.id, field: "name", value })} /></div></TableCell>
      <TableCell className="min-w-40"><EditableText value={item.category} label={`Categoría de ${item.name}`} disabled={!canEdit} onCommit={(value) => onMetaChange({ action: "update-expense-meta", id: item.id, field: "category", value })} /></TableCell>
      <TableCell className="min-w-44 text-muted-foreground">{item.period}</TableCell>
      <TableCell className="min-w-32"><NativeSelect aria-label={`Reparto de ${item.name}`} value={item.allocationBasis} disabled={!canEdit} className="h-11 md:h-8"
        onChange={(event) => onMetaChange({ action: "update-expense-meta", id: item.id, field: "allocationBasis", value: event.target.value })}>
        <NativeSelectOption value="hours">Por horas</NativeSelectOption><NativeSelectOption value="units">Por unidades</NativeSelectOption>
      </NativeSelect></TableCell>
      <TableCell className="min-w-28"><NativeSelect aria-label={`Moneda de ${item.name}`} value={selectedCurrency} disabled={!canEdit} className="h-11 md:h-8" onChange={(event) => onExpenseCurrency(item.id, event.target.value as Currency)}>{supportedCurrencies.map((code) => <NativeSelectOption key={code} value={code}>{code}</NativeSelectOption>)}</NativeSelect></TableCell>
      <TableCell className="min-w-36"><EditableMoney value={displayAmount} label={`Monto de ${item.name}`} disabled={!canEdit} onCommit={(value) => onExpenseAmount(item.id, value)} />{selectedCurrency !== state.organization.currency ? <span className="text-xs text-muted-foreground">{state.fxQuotes?.[selectedCurrency]?.asOf ? `${state.fxQuotes[selectedCurrency]?.source} ${state.fxQuotes[selectedCurrency]?.asOf}` : "Cotización pendiente"}</span> : null}</TableCell>
      <TableCell><Badge variant="secondary">{state.products.length} producto{state.products.length === 1 ? "" : "s"}</Badge></TableCell>
      <TableCell>{pending ? <Badge variant="secondary">Borrador</Badge> : <span className="text-muted-foreground">Vigente</span>}</TableCell>
    </TableRow>;
  }

  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm text-muted-foreground">Planilla de costos</p><h1 className="text-3xl font-semibold tracking-tight">Tu hoja de costos</h1><p className="text-sm text-muted-foreground">Datos: autoguardado · Importes: revisión previa.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={onAddMaterial}><Plus data-icon="inline-start" />Insumo</Button><Button variant="outline" onClick={onAddExpense}><Plus data-icon="inline-start" />Gasto</Button></div>
    </div>
    <Card className="overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 md:px-6">
          <Tabs value={kind} onValueChange={(value) => setKind(value as SheetKind)}><TabsList variant="line" aria-label="Tipo de costo"><TabsTrigger value="all">Todos <Badge variant="secondary">{state.materials.length + expenses.length}</Badge></TabsTrigger><TabsTrigger value="materials">Insumos <Badge variant="secondary">{state.materials.length}</Badge></TabsTrigger><TabsTrigger value="expenses">Gastos <Badge variant="secondary">{expenses.length}</Badge></TabsTrigger></TabsList></Tabs>
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
            {draftStatus === "saving" ? <Cloud aria-hidden="true" /> : draftStatus === "saved" ? <Check aria-hidden="true" /> : null}
            {demo ? "Demo · no se guarda" : draftStatus === "loading" ? "Cargando borrador" : draftStatus === "saving" ? "Guardando borrador" : draftStatus === "error" ? draftReady ? "No se guardó el borrador" : "No se pudo cargar el borrador" : "Borrador guardado"}
            {draftStatus === "error" ? <Button size="sm" variant="outline" onClick={onRetryDraft}>Reintentar</Button> : null}
          </div>
        </div>
        <div className="flex flex-col gap-3 border-b px-4 py-3 md:px-6">
          <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar costos" placeholder="Buscar costo o proveedor" className="pl-9" /></div>
          {categories.length ? <div className="overflow-x-auto pb-1"><ToggleGroup value={[selectedCategory]} onValueChange={(values) => setCategory(values.at(-1) ?? "all")} variant="outline" size="sm" aria-label="Filtrar por categoría" className="min-w-max"><ToggleGroupItem value="all" className="h-11 md:h-7">Todas</ToggleGroupItem>{categories.map((item) => <ToggleGroupItem key={item} value={item} className="h-11 md:h-7">{item}</ToggleGroupItem>)}</ToggleGroup></div> : null}
        </div>
        {materials.length + visibleExpenses.length ? <><p className="px-4 py-1 text-xs text-muted-foreground md:hidden">Desliza la tabla para ver más columnas →</p><div className="overflow-x-auto" role="region" aria-label="Planilla de costos desplazable" tabIndex={0}><Table><TableHeader><TableRow><TableHead>Concepto</TableHead><TableHead>Categoría</TableHead><TableHead>Proveedor / período</TableHead><TableHead>Unidad / reparto</TableHead><TableHead>Moneda</TableHead><TableHead className="text-right">Precio / monto</TableHead><TableHead>Alcance</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader><TableBody>{materials.map(materialRow)}{visibleExpenses.map(expenseRow)}</TableBody></Table></div></> : <Empty className="py-10"><EmptyHeader><EmptyTitle>No hay costos en esta vista</EmptyTitle><EmptyDescription>{query || selectedCategory !== "all" ? "Prueba otra búsqueda o categoría." : "Agrega un insumo o un gasto para comenzar."}</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" onClick={() => { setQuery(""); setCategory("all"); setKind("all"); }}>Ver todos</Button></EmptyContent></Empty>}
      </CardContent>
    </Card>
    {changeCount ? <Alert><AlertTriangle /><AlertTitle>{changeCount} cambio{changeCount === 1 ? "" : "s"} en borrador</AlertTitle><AlertDescription>{affectedProducts.size ? `Puede cambiar el costeo de ${affectedProducts.size} producto${affectedProducts.size === 1 ? "" : "s"}. ` : ""}Los importes vigentes no cambian hasta tu aprobación.</AlertDescription></Alert> : null}
    {changeCount && !canReview ? <Alert variant="destructive"><AlertTriangle /><AlertTitle>No se puede calcular el impacto</AlertTitle><AlertDescription>Completa el importe y verifica la cotización vigente de la moneda elegida.</AlertDescription></Alert> : null}
    <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{changeCount ? `${changeCount} importe${changeCount === 1 ? "" : "s"} por confirmar` : "Todos los importes al día"}</span><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!changeCount || busy} onClick={onDiscard}>Descartar borrador</Button><Button disabled={!changeCount || !canReview || busy || !draftReady} onClick={onReview}>Revisar impacto</Button></div></div>
  </div>;
}
