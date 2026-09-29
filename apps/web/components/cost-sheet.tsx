"use client";

import * as React from "react";
import { toast } from "sonner";
import { calculateCosts, productionExpenses, type DomainState, type Material, type SharedExpense } from "@/lib/domain";
import { supportedCurrencies, toNativeMilli, type Currency } from "@/lib/currency";
import { behaviorTag } from "@/lib/break-even";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { MonthSelect } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AnimatedIcon } from "@/components/animated-icon";
import { Columns3, LayoutList, Settings2, Table2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CostGroupedView } from "@/components/cost-grouped-view";
import { useIsMobile } from "@/hooks/use-mobile";
import { ExportMenu, downloadCsv } from "@/components/business/data-table";

type SheetKind = "all" | "materials" | "expenses";
type SheetView = "table" | "list" | "board";
type Draft = { materials: Record<string, number>; expenses: Record<string, number>; materialCurrencies: Record<string, Currency>; expenseCurrencies: Record<string, Currency> };
type MetaAction = { action: "update-material-meta" | "update-expense-meta"; id: string; field: string; value: string };

const editableCellClass = "h-11 rounded-none border-0 bg-transparent px-3 shadow-none transition-colors hover:bg-accent/30 focus-visible:relative focus-visible:z-10 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:bg-transparent disabled:opacity-100";
const sheetCellClass = "border-r border-b border-border p-0 last:border-r-0";
const sheetHeaderClass = "h-10 border-b border-r border-border bg-muted/60 px-3 text-xs font-medium text-muted-foreground last:border-r-0";

function EditableText({ value, label, onCommit, disabled, className }: {
  value: string; label: string; onCommit: (value: string) => void; disabled?: boolean; className?: string;
}) {
  return <Input key={value} defaultValue={value} aria-label={label} disabled={disabled} className={cn(editableCellClass, className)}
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
    aria-label={label} disabled={disabled} className={cn(editableCellClass, "min-w-28 text-right tabular-nums")}
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

export function CostSheet({ state, draft, draftReady, draftStatus, canReview, busy, demo, onOpenCozte, onRetryDraft, onMaterialPrice, onExpenseAmount, onMaterialCurrency, onExpenseCurrency, onMetaChange, onCategoryCreate, onCategoryRename, onAllocationChange, onUsageChange, onAddMaterial, onAddExpense, onReview, onDiscard }: {
  state: DomainState;
  draft: Draft;
  draftReady: boolean;
  draftStatus: "loading" | "saving" | "saved" | "error";
  canReview: boolean;
  busy: boolean;
  demo: boolean;
  onOpenCozte: () => void;
  onRetryDraft: () => void;
  onMaterialPrice: (id: string, value: number) => void;
  onExpenseAmount: (id: string, value: number) => void;
  onMaterialCurrency: (id: string, value: Currency) => void;
  onExpenseCurrency: (id: string, value: Currency) => void;
  onMetaChange: (action: MetaAction) => void;
  onCategoryCreate: (name: string) => Promise<boolean>;
  onCategoryRename: (id: string, name: string) => Promise<boolean>;
  onAllocationChange: (id: string, basis: "hours" | "units" | "manual", shares: Record<string, number>) => void;
  onUsageChange: (productId: string, materialId: string, quantityMilli: number) => Promise<boolean>;
  onAddMaterial: () => void;
  onAddExpense: () => void;
  onReview: () => void;
  onDiscard: () => void;
}) {
  const [kind, setKind] = React.useState<SheetKind>("all");
  // On a phone the wide table is hard to read, so the list is the default there; the person can still switch.
  const isMobile = useIsMobile();
  const [chosenView, setView] = React.useState<SheetView | null>(null);
  const view: SheetView = chosenView ?? (isMobile ? "list" : "table");
  const [categoryDialog, setCategoryDialog] = React.useState(false);
  const [categoryName, setCategoryName] = React.useState("");
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [allocationId, setAllocationId] = React.useState<string | null>(null);
  const [allocationBasis, setAllocationBasis] = React.useState<"hours" | "units" | "manual">("hours");
  const [allocationShares, setAllocationShares] = React.useState<Record<string, string>>({});
  const [usageMaterialId, setUsageMaterialId] = React.useState<string | null>(null);
  const [usageValues, setUsageValues] = React.useState<Record<string, string>>({});
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState("all");
  // The company's other monthly expenses (delivery, sales, administration) live in their own section.
  const expenses = productionExpenses(state);
  const categories = [...new Set([...(state.categories ?? []).map((item) => item.name), ...state.materials.map((item) => item.category), ...expenses.map((item) => item.category)])].sort();
  const activeAllocation = expenses.find((item) => item.id === allocationId);
  const usageMaterial = state.materials.find((item) => item.id === usageMaterialId);
  function openUsage(item: Material) {
    setUsageMaterialId(item.id);
    setUsageValues(Object.fromEntries(state.products.map((product) => [product.id, String((state.components.find((part) => part.productId === product.id && part.materialId === item.id)?.quantityMilli ?? 0) / 1000)])));
  }
  function openAllocation(item: SharedExpense) {
    setAllocationId(item.id);
    setAllocationBasis(item.allocationBasis);
    setAllocationShares(Object.fromEntries(state.products.map((product) => [product.id, String((item.allocationShares?.[product.id] ?? 0) / 100)])));
  }
  const selectedCategory = category === "all" || categories.includes(category) ? category : "all";
  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const matches = (name: string, group: string) => (selectedCategory === "all" || group === selectedCategory) && (!normalizedQuery || `${name} ${group}`.toLocaleLowerCase("es").includes(normalizedQuery));
  const entityKey = (name: string) => name.trim().toLocaleLowerCase("es");
  const productionInput = (item: Material) => state.productionWork?.inputs.find((input) => entityKey(input.name) === entityKey(item.name));
  const productionExpense = (item: SharedExpense) => state.productionWork?.recurringCosts.find((cost) => entityKey(cost.name) === entityKey(item.name));
  const materials = kind === "expenses" ? [] : state.materials.filter((item) => matches(`${item.name} ${item.supplier}`, item.category));
  const visibleExpenses = kind === "materials" ? [] : expenses.filter((item) => matches(item.name, item.category));
  const changedMaterialIds = state.materials.filter((item) => draft.materialCurrencies[item.id] !== undefined || (draft.materials[item.id] !== undefined && draft.materials[item.id] !== (item.nativeAmountMilli == null ? item.priceMinor : item.nativeAmountMilli / 1000)));
  const changedExpenseIds = expenses.filter((item) => draft.expenseCurrencies[item.id] !== undefined || (draft.expenses[item.id] !== undefined && draft.expenses[item.id] !== (item.nativeAmountMilli == null ? item.amountMinor : item.nativeAmountMilli / 1000)));
  const changeCount = changedMaterialIds.length + changedExpenseIds.length;
  const expenseAppliesTo = (expense: SharedExpense, productId: string) => {
    const product = state.products.find((item) => item.id === productId);
    return expense.allocationBasis === "manual" ? (expense.allocationShares?.[productId] ?? 0) > 0 : expense.allocationBasis === "hours" ? (product?.productionHoursMilli ?? 0) > 0 : (product?.lotUnits ?? 0) > 0;
  };
  const affectedProducts = new Set([
    ...changedMaterialIds.flatMap((item) => state.components.filter((part) => part.materialId === item.id).map((part) => part.productId)),
    ...changedExpenseIds.flatMap((expense) => state.products.filter((product) => expenseAppliesTo(expense, product.id)).map((item) => item.id)),
  ]);
  const canEdit = !busy && draftReady;
  const basisLabel = (basis: SharedExpense["allocationBasis"]) => basis === "hours" ? "Por horas" : basis === "units" ? "Por unidades" : "Porcentajes";
  const QUALITY_LABELS = { complete: "Completo", estimated: "Estimado", incomplete: "Incompleto" } as const;
  const today = new Date().toLocaleDateString("en-CA");
  function exportProducts() {
    const costs = calculateCosts(state);
    downloadCsv(`costo-por-producto-${today}`, ["Producto", "Unidades por lote", "Insumos por unidad", "Mano de obra por unidad", "Gastos compartidos por unidad", "Costo por unidad", "Precio de venta", "Margen estimado (%)", "Estado", "Qué falta", "Moneda"],
      state.products.map((product) => {
        const cost = costs.find((item) => item.productId === product.id);
        return [product.name, product.lotUnits, cost?.perUnit?.materialMinor, cost?.perUnit?.laborMinor, cost?.perUnit?.sharedMinor, cost?.unitMinor, product.salePriceMinor || null, cost?.estimatedMarginPercent,
          cost ? QUALITY_LABELS[cost.quality] : "", cost?.warnings.join(" · ") ?? "", state.organization.currency];
      }));
  }
  function exportConcepts() {
    downloadCsv(`conceptos-de-costo-${today}`, ["Tipo", "Concepto", "Categoría", "Proveedor", "Período", "Unidad de compra / reparto", "Moneda", "Precio o monto", `Precio o monto en ${state.organization.currency}`, "Productos que lo usan"], [
      ...materials.map((item) => [
        "Directo", item.name, item.category, item.supplier, "", item.purchaseUnit, item.currency ?? state.organization.currency,
        item.nativeAmountMilli == null ? item.priceMinor : item.nativeAmountMilli / 1000, item.priceMinor,
        state.components.filter((part) => part.materialId === item.id).map((part) => state.products.find((product) => product.id === part.productId)?.name).filter(Boolean).join(", "),
      ]),
      ...visibleExpenses.map((item) => [
        "Compartido", item.name, item.category, "", item.period, basisLabel(item.allocationBasis), item.currency ?? state.organization.currency,
        item.nativeAmountMilli == null ? item.amountMinor : item.nativeAmountMilli / 1000, item.amountMinor,
        state.products.filter((product) => expenseAppliesTo(item, product.id)).map((product) => product.name).join(", "),
      ]),
    ]);
  }

  function materialRow(item: Material) {
    const operationalProducts = new Set(state.components.filter((part) => part.materialId === item.id).map((part) => state.products.find((product) => product.id === part.productId)?.name).filter((name): name is string => Boolean(name)));
    const mapInput = productionInput(item);
    const mapUsage = mapInput?.usage ?? [];
    const pending = changedMaterialIds.some((entry) => entry.id === item.id);
    const selectedCurrency = draft.materialCurrencies[item.id] ?? item.currency ?? state.organization.currency;
    const displayAmount = draft.materials[item.id] ?? (draft.materialCurrencies[item.id] ? null : item.nativeAmountMilli == null ? item.priceMinor : item.nativeAmountMilli / 1000);
    return <TableRow key={`material-${item.id}`} className={cn("bg-card hover:bg-muted/40", pending && "bg-accent/35 hover:bg-accent/50")}>
      <TableCell className={cn(sheetCellClass, "min-w-48")}><div className="flex items-center gap-2 px-2"><Badge variant="outline">Directo</Badge><EditableText value={item.name} label={`Nombre de ${item.name}`} disabled={!canEdit} className="min-w-36 font-medium" onCommit={(value) => onMetaChange({ action: "update-material-meta", id: item.id, field: "name", value })} /></div></TableCell>
      <TableCell className={cn(sheetCellClass, "min-w-40")}><Dropdown aria-label={`Categoría de ${item.name}`} value={item.category} disabled={!canEdit} variant="cell" onChange={(event) => onMetaChange({ action: "update-material-meta", id: item.id, field: "category", value: event.target.value })}>{categories.map((name) => <DropdownOption key={name} value={name}>{name}</DropdownOption>)}</Dropdown></TableCell>
      <TableCell className={cn(sheetCellClass, "min-w-44")}><EditableText value={item.supplier} label={`Proveedor de ${item.name}`} disabled={!canEdit} onCommit={(value) => onMetaChange({ action: "update-material-meta", id: item.id, field: "supplier", value })} /></TableCell>
      <TableCell className={cn(sheetCellClass, "min-w-32")}><EditableText value={item.purchaseUnit} label={`Unidad de ${item.name}`} disabled={!canEdit} onCommit={(value) => onMetaChange({ action: "update-material-meta", id: item.id, field: "purchaseUnit", value })} /></TableCell>
      <TableCell className={cn(sheetCellClass, "min-w-28")}><Dropdown aria-label={`Moneda de ${item.name}`} value={selectedCurrency} disabled={!canEdit} variant="cell" onChange={(event) => onMaterialCurrency(item.id, event.target.value as Currency)}>{supportedCurrencies.map((code) => <DropdownOption key={code} value={code}>{code}</DropdownOption>)}</Dropdown></TableCell>
      <TableCell className={cn(sheetCellClass, "min-w-36")}><EditableMoney value={displayAmount} label={`Precio de ${item.name}`} disabled={!canEdit} onCommit={(value) => onMaterialPrice(item.id, value)} />{selectedCurrency !== state.organization.currency ? <span className="block px-3 pb-1 text-right text-[11px] text-muted-foreground">{state.fxQuotes?.[selectedCurrency]?.asOf ? `${state.fxQuotes[selectedCurrency]?.source} ${state.fxQuotes[selectedCurrency]?.asOf}` : "Cotización pendiente"}</span> : null}</TableCell>
       <TableCell className={cn(sheetCellClass, "min-w-56")}><div className="space-y-1 p-2"><Button size="sm" variant="ghost" className="h-8 w-full justify-start rounded-md px-2" disabled={!canEdit} onClick={() => openUsage(item)}>{operationalProducts.size} en planilla · Editar consumo</Button>{operationalProducts.size ? <p className="px-2 text-xs text-muted-foreground">{[...operationalProducts].join(", ")}</p> : null}{mapUsage.length ? <div className="rounded-md bg-muted/50 px-2 py-1.5"><p className="text-xs font-medium">Mapa Cozte · {mapUsage.length} producto{mapUsage.length === 1 ? "" : "s"}</p><p className="text-xs text-muted-foreground">{mapUsage.map((usage) => `${usage.product}: ${usage.quantityPerBatch === null ? "consumo pendiente" : `${usage.quantityPerBatch} ${mapInput?.consumptionUnit ?? ""} por lote`}`).join(" · ")}</p><Button size="sm" variant="link" className="h-7 px-0 text-xs" onClick={onOpenCozte}>Revisar mapa con Cozte</Button></div> : null}{!operationalProducts.size && !mapUsage.length ? <p className="px-2 text-xs text-muted-foreground">Sin producto asociado</p> : null}</div></TableCell>
      <TableCell className={cn(sheetCellClass, "px-3")}>{pending ? <Badge variant="secondary">Borrador</Badge> : <span className="text-muted-foreground">Vigente</span>}</TableCell>
    </TableRow>;
  }

  function expenseRow(item: SharedExpense) {
    const affected = state.products.filter((product) => expenseAppliesTo(item, product.id)).length;
    const mapCost = productionExpense(item);
    const mapProducts = (state.productionWork?.products ?? []).filter((product) => mapCost && (mapCost.allocation === "manual_percentage"
      ? (mapCost.shares.find((share) => entityKey(share.product) === entityKey(product.name))?.percent ?? 0) > 0
      : mapCost.allocation === "production_hours"
        ? (product.hoursPerBatch ?? 0) > 0 && (product.batchesPerMonth ?? 0) > 0
        : (product.goodUnitsPerBatch ?? 0) > 0 && (product.batchesPerMonth ?? 0) > 0));
    const pending = changedExpenseIds.some((entry) => entry.id === item.id);
    const selectedCurrency = draft.expenseCurrencies[item.id] ?? item.currency ?? state.organization.currency;
    const displayAmount = draft.expenses[item.id] ?? (draft.expenseCurrencies[item.id] ? null : item.nativeAmountMilli == null ? item.amountMinor : item.nativeAmountMilli / 1000);
    return <TableRow key={`expense-${item.id}`} className={cn("bg-card hover:bg-muted/40", pending && "bg-accent/35 hover:bg-accent/50")}>
      <TableCell className={cn(sheetCellClass, "min-w-48")}><div className="flex items-center gap-2 px-2"><Badge variant="outline">Compartido</Badge><EditableText value={item.name} label={`Nombre de ${item.name}`} disabled={!canEdit} className="min-w-36 font-medium" onCommit={(value) => onMetaChange({ action: "update-expense-meta", id: item.id, field: "name", value })} />{item.behavior && item.behavior !== "fixed" ? <Badge variant="secondary" className="shrink-0" title={item.behaviorNote || undefined}>{behaviorTag(item)}</Badge> : null}</div></TableCell>
      <TableCell className={cn(sheetCellClass, "min-w-40")}><Dropdown aria-label={`Categoría de ${item.name}`} value={item.category} disabled={!canEdit} variant="cell" onChange={(event) => onMetaChange({ action: "update-expense-meta", id: item.id, field: "category", value: event.target.value })}>{categories.map((name) => <DropdownOption key={name} value={name}>{name}</DropdownOption>)}</Dropdown></TableCell>
      <TableCell className={cn(sheetCellClass, "min-w-44")}><MonthSelect variant="cell" aria-label={`Período de ${item.name}`} value={item.period} disabled={!canEdit} onChange={(value) => { if (value) onMetaChange({ action: "update-expense-meta", id: item.id, field: "period", value }); }} /></TableCell>
      <TableCell className={cn(sheetCellClass, "min-w-32")}><Button size="sm" variant="ghost" className="h-11 w-full justify-start rounded-none px-3" disabled={!canEdit} onClick={() => openAllocation(item)}><Settings2 data-icon="inline-start" />{item.allocationBasis === "hours" ? "Por horas" : item.allocationBasis === "units" ? "Por unidades" : "Porcentajes"}</Button></TableCell>
      <TableCell className={cn(sheetCellClass, "min-w-28")}><Dropdown aria-label={`Moneda de ${item.name}`} value={selectedCurrency} disabled={!canEdit} variant="cell" onChange={(event) => onExpenseCurrency(item.id, event.target.value as Currency)}>{supportedCurrencies.map((code) => <DropdownOption key={code} value={code}>{code}</DropdownOption>)}</Dropdown></TableCell>
      <TableCell className={cn(sheetCellClass, "min-w-36")}><EditableMoney value={displayAmount} label={`Monto de ${item.name}`} disabled={!canEdit} onCommit={(value) => onExpenseAmount(item.id, value)} />{selectedCurrency !== state.organization.currency ? <span className="block px-3 pb-1 text-right text-[11px] text-muted-foreground">{state.fxQuotes?.[selectedCurrency]?.asOf ? `${state.fxQuotes[selectedCurrency]?.source} ${state.fxQuotes[selectedCurrency]?.asOf}` : "Cotización pendiente"}</span> : null}</TableCell>
       <TableCell className={cn(sheetCellClass, "min-w-52 px-3 py-2")}><div className="space-y-1"><Badge variant="secondary">Planilla · {affected} producto{affected === 1 ? "" : "s"}</Badge>{mapCost ? <div className="rounded-md bg-muted/50 px-2 py-1.5"><p className="text-xs font-medium">Mapa Cozte · {mapCost.allocation === "manual_percentage" ? "porcentajes" : mapCost.allocation === "production_hours" ? "por horas" : "por unidades"}</p><p className="text-xs text-muted-foreground">{mapProducts.length ? mapProducts.map((product) => product.name).join(", ") : "Reparto pendiente de definir"}</p><Button size="sm" variant="link" className="h-7 px-0 text-xs" onClick={onOpenCozte}>Revisar reparto con Cozte</Button></div> : null}</div></TableCell>
      <TableCell className={cn(sheetCellClass, "px-3")}>{pending ? <Badge variant="secondary">Borrador</Badge> : <span className="text-muted-foreground">Vigente</span>}</TableCell>
    </TableRow>;
  }

  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm text-muted-foreground">Producción / costos</p><h1 className="text-3xl font-semibold tracking-tight">Costos de producción</h1><p className="text-sm text-muted-foreground">Organiza los conceptos con los nombres de tu empresa. Revisa el impacto antes de confirmar importes.</p></div>
      <div className="flex flex-wrap gap-2"><ExportMenu options={[
        { label: "Costo por producto", hint: "Cuánto cuesta cada unidad, desglosado, con su precio y margen", onSelect: exportProducts },
        { label: "Conceptos de costo", hint: "Insumos y gastos compartidos, con los filtros aplicados", onSelect: exportConcepts },
      ]} /><Button variant="outline" onClick={() => setCategoryDialog(true)}><Settings2 data-icon="inline-start" />Categorías</Button><Button variant="outline" onClick={onAddMaterial}><AnimatedIcon name="plus" data-icon="inline-start" />Costo directo</Button><Button variant="outline" onClick={onAddExpense}><AnimatedIcon name="plus" data-icon="inline-start" />Costo compartido</Button></div>
    </div>
    <Card className="overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 md:px-6">
          <Tabs value={kind} onValueChange={(value) => setKind(value as SheetKind)}><TabsList variant="line" aria-label="Forma de asignación"><TabsTrigger value="all">Todos <Badge variant="secondary">{state.materials.length + expenses.length}</Badge></TabsTrigger><TabsTrigger value="materials">Directos <Badge variant="secondary">{state.materials.length}</Badge></TabsTrigger><TabsTrigger value="expenses">Compartidos <Badge variant="secondary">{expenses.length}</Badge></TabsTrigger></TabsList></Tabs>
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
            {draftStatus === "saving" ? <AnimatedIcon name="cloud" /> : draftStatus === "saved" ? <AnimatedIcon name="check" /> : null}
            {demo ? "Demo · no se guarda" : draftStatus === "loading" ? "Cargando borrador" : draftStatus === "saving" ? "Guardando borrador" : draftStatus === "error" ? draftReady ? "No se guardó el borrador" : "No se pudo cargar el borrador" : "Borrador guardado"}
            {draftStatus === "error" ? <Button size="sm" variant="outline" onClick={onRetryDraft}>Reintentar</Button> : null}
          </div>
        </div>
        <div className="flex flex-col gap-3 border-b px-4 py-3 md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex gap-1" role="group" aria-label="Vista de costos"><Button size="sm" variant={view === "table" ? "secondary" : "ghost"} onClick={() => setView("table")}><Table2 data-icon="inline-start" />Tabla</Button><Button size="sm" variant={view === "list" ? "secondary" : "ghost"} onClick={() => setView("list")}><LayoutList data-icon="inline-start" />Lista</Button><Button size="sm" variant={view === "board" ? "secondary" : "ghost"} onClick={() => setView("board")}><Columns3 data-icon="inline-start" />Tablero</Button></div><span className="text-xs text-muted-foreground">{materials.length + visibleExpenses.length} conceptos</span></div>
          <div className="relative"><AnimatedIcon name="search" size={16} className="pointer-events-none absolute top-2.5 left-3 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar costos" placeholder="Buscar costo o proveedor" className="pl-9" /></div>
          {categories.length ? <div className="overflow-x-auto pb-1"><ToggleGroup value={[selectedCategory]} onValueChange={(values) => setCategory(values.at(-1) ?? "all")} variant="outline" size="sm" aria-label="Filtrar por categoría" className="min-w-max"><ToggleGroupItem value="all" className="h-11 md:h-7">Todas</ToggleGroupItem>{categories.map((item) => <ToggleGroupItem key={item} value={item} className="h-11 md:h-7">{item}</ToggleGroupItem>)}</ToggleGroup></div> : null}
        </div>
        {materials.length + visibleExpenses.length ? view === "table" ? <>
          <p className="px-4 py-1 text-xs text-muted-foreground">Desliza para ver más columnas →</p>
          <div className="mx-3 mb-3 overflow-hidden rounded-xl border border-border bg-card shadow-sm md:mx-4 md:mb-4">
            <Table aria-label="Costos de producción" className="min-w-[1120px] border-separate border-spacing-0" containerProps={{ role: "region", "aria-label": "Planilla de costos desplazable", tabIndex: 0 }}>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className={sheetHeaderClass}>Concepto</TableHead>
                  <TableHead className={sheetHeaderClass}>Categoría</TableHead>
                  <TableHead className={sheetHeaderClass}>Proveedor / período</TableHead>
                  <TableHead className={sheetHeaderClass}>Unidad / reparto</TableHead>
                  <TableHead className={sheetHeaderClass}>Moneda</TableHead>
                  <TableHead className={cn(sheetHeaderClass, "text-right")}>Precio / monto</TableHead>
                  <TableHead className={sheetHeaderClass}>Alcance</TableHead>
                  <TableHead className={sheetHeaderClass}>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:last-child>td]:border-b-0">{materials.map(materialRow)}{visibleExpenses.map(expenseRow)}</TableBody>
            </Table>
          </div>
        </> : <CostGroupedView view={view} categories={selectedCategory === "all" ? categories : [selectedCategory]} materials={materials} expenses={visibleExpenses} currency={state.organization.currency} draft={draft} onAllocation={openAllocation} /> : <Empty className="py-10"><EmptyHeader><EmptyTitle>No hay costos en esta vista</EmptyTitle><EmptyDescription>{query || selectedCategory !== "all" ? "Prueba otra búsqueda o categoría." : "Agrega un costo para comenzar."}</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" onClick={() => { setQuery(""); setCategory("all"); setKind("all"); }}>Ver todos</Button></EmptyContent></Empty>}
      </CardContent>
    </Card>
    {changeCount ? <Alert><AnimatedIcon name="alert" /><AlertTitle>{changeCount} cambio{changeCount === 1 ? "" : "s"} en borrador</AlertTitle><AlertDescription>{affectedProducts.size ? `Puede cambiar el costeo de ${affectedProducts.size} producto${affectedProducts.size === 1 ? "" : "s"}. ` : ""}Los importes vigentes no cambian hasta tu aprobación.</AlertDescription></Alert> : null}
    {changeCount && !canReview ? <Alert variant="destructive"><AnimatedIcon name="alert" /><AlertTitle>No se puede calcular el impacto</AlertTitle><AlertDescription>Completa el importe y verifica la cotización vigente de la moneda elegida.</AlertDescription></Alert> : null}
    <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{changeCount ? `${changeCount} importe${changeCount === 1 ? "" : "s"} por confirmar` : "Todos los importes al día"}</span><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!changeCount || busy} onClick={onDiscard}>Descartar borrador</Button><Button disabled={!changeCount || !canReview || busy || !draftReady} onClick={onReview}>Revisar impacto</Button></div></div>
    <Dialog open={categoryDialog} onOpenChange={setCategoryDialog}><DialogContent><DialogHeader><DialogTitle>Categorías de la empresa</DialogTitle><DialogDescription>Usa los nombres acordados para organizar tus costos. La regla de reparto se define por concepto.</DialogDescription></DialogHeader><div className="max-h-72 space-y-2 overflow-y-auto">{(state.categories ?? []).map((item) => <div key={item.id} className="flex gap-2"><Input aria-label={`Nombre de ${item.name}`} value={renaming === item.id ? categoryName : item.name} onFocus={() => { setRenaming(item.id); setCategoryName(item.name); }} onChange={(event) => setCategoryName(event.target.value)} /><Button variant="outline" disabled={busy || renaming !== item.id || categoryName.trim() === item.name} onClick={async () => { if (await onCategoryRename(item.id, categoryName.trim())) { setRenaming(null); setCategoryName(""); } }}>Guardar</Button></div>)}</div><div className="flex gap-2"><Input aria-label="Nueva categoría" placeholder="Ej. Materias primas" value={renaming === null ? categoryName : ""} onFocus={() => { setRenaming(null); setCategoryName(""); }} onChange={(event) => setCategoryName(event.target.value)} /><Button disabled={busy || renaming !== null || categoryName.trim().length < 2} onClick={async () => { if (await onCategoryCreate(categoryName.trim())) setCategoryName(""); }}>Agregar</Button></div></DialogContent></Dialog>
    <Dialog open={activeAllocation !== undefined} onOpenChange={(open) => { if (!open) setAllocationId(null); }}><DialogContent><DialogHeader><DialogTitle>Distribución de {activeAllocation?.name}</DialogTitle><DialogDescription>Elige cómo repartir este costo entre los productos. El cambio recalcula sus costos.</DialogDescription></DialogHeader><Dropdown aria-label="Método de reparto" value={allocationBasis} onChange={(event) => setAllocationBasis(event.target.value as "hours" | "units" | "manual")}><DropdownOption value="hours">Horas de producción</DropdownOption><DropdownOption value="units">Unidades del lote</DropdownOption><DropdownOption value="manual">Porcentajes acordados</DropdownOption></Dropdown>{allocationBasis === "manual" ? <div className="space-y-2">{state.products.map((product) => <label key={product.id} className="flex items-center justify-between gap-3 text-sm"><span>{product.name}</span><div className="flex items-center gap-1"><Input className="w-24 text-right" type="number" min="0" max="100" step="0.01" value={allocationShares[product.id] ?? ""} onChange={(event) => setAllocationShares((current) => ({ ...current, [product.id]: event.target.value }))} /><span>%</span></div></label>)}<p className="text-xs text-muted-foreground">Total: {state.products.reduce((sum, product) => sum + Number(allocationShares[product.id] || 0), 0).toFixed(2)} %</p></div> : null}<DialogFooter><Button variant="outline" onClick={() => setAllocationId(null)}>Cancelar</Button><Button disabled={busy || (allocationBasis === "manual" && Math.round(state.products.reduce((sum, product) => sum + Number(allocationShares[product.id] || 0), 0) * 100) !== 10000)} onClick={() => { if (activeAllocation) onAllocationChange(activeAllocation.id, allocationBasis, Object.fromEntries(state.products.map((product) => [product.id, Math.round(Number(allocationShares[product.id] || 0) * 100)]))); setAllocationId(null); }}>Aplicar reparto</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={usageMaterial !== undefined} onOpenChange={(open) => { if (!open) setUsageMaterialId(null); }}><DialogContent><DialogHeader><DialogTitle>Consumo de {usageMaterial?.name}</DialogTitle><DialogDescription>Indica cuánto se usa por lote, expresado en {usageMaterial?.purchaseUnit || "la unidad de compra"}. Cero quita la asignación.</DialogDescription></DialogHeader><div className="max-h-80 space-y-2 overflow-y-auto">{state.products.map((product) => <div key={product.id} className="flex items-center gap-2"><label className="min-w-0 flex-1 text-sm" htmlFor={`usage-${product.id}`}>{product.name}</label><Input id={`usage-${product.id}`} className="w-28 text-right" type="number" min="0" step="0.001" value={usageValues[product.id] ?? "0"} onChange={(event) => setUsageValues((current) => ({ ...current, [product.id]: event.target.value }))} /><span className="w-16 truncate text-xs text-muted-foreground">{usageMaterial?.purchaseUnit}</span><Button size="sm" variant="outline" disabled={busy || !usageMaterial || !Number.isFinite(Number(usageValues[product.id])) || Number(usageValues[product.id]) < 0 || Math.round(Number(usageValues[product.id]) * 1000) === (state.components.find((part) => part.productId === product.id && part.materialId === usageMaterialId)?.quantityMilli ?? 0)} onClick={async () => { if (usageMaterial && await onUsageChange(product.id, usageMaterial.id, Math.round(Number(usageValues[product.id]) * 1000))) toast.success("Consumo actualizado"); }}>Guardar</Button></div>)}</div></DialogContent></Dialog>
  </div>;
}
