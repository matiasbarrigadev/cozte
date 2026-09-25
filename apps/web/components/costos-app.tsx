"use client";

import * as React from "react";
import Link from "next/link";
import { OrganizationSwitcher, UserButton, useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { calculateCosts, convertToOrganizationCurrency, type DomainState, type Product, type ProductCost, type ProductionWorkMap } from "@/lib/domain";
import { supportedCurrencies, toNativeMilli, type Currency } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { EntityDialog } from "./entity-dialog";
import { CostSheet } from "./cost-sheet";
import { CozteAssistant } from "./cozte-assistant";
import { CostHistory, type CostSnapshotRow, type HistoryEntry, type ProfileSnapshotRow } from "./cost-history";
import { CostAnalysisView } from "./cost-analysis-view";
import { SalesSection } from "./business/sales-section";
import { ExpensesSection } from "./business/expenses-section";
import { PurchasesSection } from "./business/purchases-section";
import { ResultSection } from "./business/result-section";
import { MonthCard } from "./business/month-card";
import { DEMO_MONTH } from "@/lib/demo";
import { appPath, viewFromPathname, viewFromSegments, type AppView } from "@/lib/app-routes";
import { dashboardSummary } from "@/lib/dashboard-summary";
import { CompositionBar, CompositionLegend } from "./business/composition";
import { AnimatedIcon, type AnimatedIconName } from "./animated-icon";
import { CozteLogo } from "./cozte-logo";

type Dashboard = DomainState & {
  costs: ProductCost[];
  alerts: { id: string; material_id: string; message: string; first_detected_at: string }[];
  productionWork?: ProductionWorkMap | null;
};
type View = AppView;
type Draft = { materials: Record<string, number>; expenses: Record<string, number>; materialCurrencies: Record<string, Currency>; expenseCurrencies: Record<string, Currency>; source: string; effectiveDate: string };

type NavItem = { id: View; label: string; icon: AnimatedIconName };
/** Grouped the way a business thinks about it: what it costs, what happens each day and how it went. */
const navGroups: { label: string; items: NavItem[] }[] = [
  { label: "Espacio de trabajo", items: [{ id: "dashboard", label: "Dashboard", icon: "dashboard" }, { id: "asistente", label: "Cozte AI", icon: "assistant" }] },
  { label: "Costos", items: [{ id: "planilla", label: "Costos de producción", icon: "costs" }, { id: "ventas", label: "Ventas y entregas", icon: "arrowUpRight" }, { id: "gastos", label: "Gastos de la empresa", icon: "layers" }] },
  { label: "Día a día", items: [{ id: "compras", label: "Compras", icon: "receipt" }, { id: "resultado", label: "Resultado del mes", icon: "review" }] },
  { label: "Evolución", items: [{ id: "analisis", label: "Análisis de costos", icon: "chart" }, { id: "historial", label: "Historial", icon: "history" }] },
];

const formatMoney = (value: number | null, currency: string) => value === null ? "Sin calcular" : new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: currency === "CLP" ? 0 : 3 }).format(value);
/** Whole amounts for reading, not for editing: lessons, totals and tooltips. */
const plainMoney = (value: number, currency: string) => new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: Math.abs(value) < 100 && currency !== "CLP" ? 2 : 0 }).format(value);
const formatPercent = (value: number | null) => value === null ? "—" : `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(value)}%`;
const emptyDraft = (): Draft => ({ materials: {}, expenses: {}, materialCurrencies: {}, expenseCurrencies: {}, source: "", effectiveDate: new Date().toISOString().slice(0, 10) });

export function CostosApp({ initial, demo = false, initialSection }: { initial: Dashboard; demo?: boolean; initialSection?: string[] }) {
  const [state, setState] = React.useState<Dashboard>(initial);
  const initialRoute = viewFromSegments(initialSection) ?? { view: "dashboard" as View };
  const [view, setView] = React.useState<View>(initialRoute.view);
  const [selected, setSelected] = React.useState<string | null>(initialRoute.productId ?? initial.products[0]?.id ?? null);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(() => { const value = emptyDraft(); if (demo) value.materials.papel = 10000; return value; });
  const [draftReady, setDraftReady] = React.useState(demo);
  const [draftLoadAttempt, setDraftLoadAttempt] = React.useState(0);
  const [draftStatus, setDraftStatus] = React.useState<"loading" | "saving" | "saved" | "error">(demo ? "saved" : "loading");
  const draftGeneration = React.useRef(0);
  const draftWriteChain = React.useRef<Promise<void>>(Promise.resolve());
  const [review, setReview] = React.useState<ProductCost[] | null>(null);
  const [reviewFxRates, setReviewFxRates] = React.useState<Record<string, number>>({});
  const [busy, setBusy] = React.useState(false);
  const [pendingMeta, setPendingMeta] = React.useState<{ action: Record<string, unknown>; affected: string[]; description: string } | null>(null);
  const [dialog, setDialog] = React.useState<"product" | "material" | "expense" | "edit-product" | null>(null);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const [snapshots, setSnapshots] = React.useState<CostSnapshotRow[]>([]);
  const [profileSnapshots, setProfileSnapshots] = React.useState<ProfileSnapshotRow[]>([]);
  const [decision, setDecision] = React.useState("");
  // One month for all business sections, so moving between them keeps the same period.
  const [businessMonth, setBusinessMonth] = React.useState(demo ? DEMO_MONTH : new Date().toISOString().slice(0, 7));
  const currency = state.organization.currency;
  const product = state.products.find((item) => item.id === selected) ?? state.products[0];
  const currentCost = state.costs.find((item) => item.productId === product?.id);
  const productionWorkProducts = state.productionWork?.products.filter((workProduct) =>
    !state.products.some((catalogProduct) => catalogProduct.name.trim().toLocaleLowerCase() === workProduct.name.trim().toLocaleLowerCase()),
  ) ?? [];
  const dashboardProductCount = state.products.length + productionWorkProducts.length;
  const summary = React.useMemo(() => dashboardSummary(state, state.costs, (value) => plainMoney(value, currency)), [state, currency]);
  const materialCurrency = (item: DomainState["materials"][number]) => draft.materialCurrencies[item.id] ?? item.currency ?? currency;
  const expenseCurrency = (item: DomainState["expenses"][number]) => draft.expenseCurrencies[item.id] ?? item.currency ?? currency;
  const nativeMaterial = (item: DomainState["materials"][number]) => item.nativeAmountMilli == null ? item.priceMinor : item.nativeAmountMilli / 1000;
  const nativeExpense = (item: DomainState["expenses"][number]) => item.nativeAmountMilli == null ? item.amountMinor : item.nativeAmountMilli / 1000;
  const changedMaterials = state.materials.filter((item) => draft.materialCurrencies[item.id] !== undefined || (draft.materials[item.id] !== undefined && draft.materials[item.id] !== nativeMaterial(item)));
  const changedExpenses = state.expenses.filter((item) => item.period === state.activePeriod && (draft.expenseCurrencies[item.id] !== undefined || (draft.expenses[item.id] !== undefined && draft.expenses[item.id] !== nativeExpense(item))));
  const changeCount = changedMaterials.length + changedExpenses.length;
  const clientPreview = React.useMemo(() => {
    try {
      const materialAmounts = Object.fromEntries(Object.entries(draft.materials).map(([id, amount]) => [id, convertToOrganizationCurrency(state, toNativeMilli(amount), draft.materialCurrencies[id] ?? state.materials.find((item) => item.id === id)?.currency ?? currency)]));
      const expenseAmounts = Object.fromEntries(Object.entries(draft.expenses).map(([id, amount]) => [id, convertToOrganizationCurrency(state, toNativeMilli(amount), draft.expenseCurrencies[id] ?? state.expenses.find((item) => item.id === id)?.currency ?? currency)]));
      if (changedMaterials.some((item) => draft.materials[item.id] === undefined) || changedExpenses.some((item) => draft.expenses[item.id] === undefined) || [...Object.values(materialAmounts), ...Object.values(expenseAmounts)].some((value) => value === null)) return null;
      return calculateCosts(state, materialAmounts as Record<string, number>, expenseAmounts as Record<string, number>);
    } catch { return null; }
  }, [state, draft, currency, changedMaterials, changedExpenses]);
  const preview = review ?? clientPreview;

  React.useEffect(() => {
    if (demo) return;
    let active = true;
    fetch("/api/draft", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("No se pudo cargar el borrador");
      const data = await response.json();
      if (active) {
        if (data.draft) setDraft(data.draft);
        setDraftReady(true);
        setDraftStatus("saved");
      }
    }).catch(() => { if (active) setDraftStatus("error"); });
    return () => { active = false; };
  }, [demo, draftLoadAttempt]);

  React.useEffect(() => {
    if (demo || !draftReady) return;
    const generation = ++draftGeneration.current;
    const timer = setTimeout(() => {
      setDraftStatus("saving");
      draftWriteChain.current = draftWriteChain.current.catch(() => {}).then(async () => {
        const response = await fetch("/api/draft", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
        if (!response.ok) throw new Error("No se pudo guardar el borrador");
        if (draftGeneration.current === generation) setDraftStatus("saved");
      }).catch(() => { if (draftGeneration.current === generation) setDraftStatus("error"); });
    }, 500);
    return () => clearTimeout(timer);
  }, [demo, draftReady, draft]);

  async function refresh() {
    if (demo) return;
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("No pudimos actualizar los datos");
    setState(await response.json());
  }

  async function changeBaseCurrency(next: Currency) {
    if (demo || next === currency) return;
    setBusy(true);
    try {
      const response = await fetch("/api/organization/currency", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ currency: next, expectedRevision: state.revision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudo cambiar la moneda base");
      await refresh();
      toast.success(`Moneda base: ${next}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo cambiar la moneda"); }
    finally { setBusy(false); }
  }

  async function save(action: Record<string, unknown>, quiet = false) {
    if (demo) { toast.info("Demostración: los cambios no se guardan"); return false; }
    setBusy(true);
    try {
      const response = await fetch("/api/changes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...action, expectedRevision: state.revision, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudo guardar");
      await refresh();
      setReview(null);
      if (!quiet) toast.success("Cambio confirmado");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar");
      if (error instanceof Error && error.message.includes("cambiaron")) await refresh();
      return false;
    } finally { setBusy(false); }
  }

  async function reviewChanges() {
    if (!changeCount || !clientPreview) return;
    if (!demo) {
      setBusy(true);
      try {
        const response = await fetch("/api/changes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "bulk-prices", materials: changedMaterials.map((item) => ({ id: item.id, amount: draft.materials[item.id], currency: materialCurrency(item) })), expenses: changedExpenses.map((item) => ({ id: item.id, amount: draft.expenses[item.id], currency: expenseCurrency(item) })), source: draft.source || "Pendiente de fuente", effectiveDate: draft.effectiveDate, expectedRevision: state.revision, idempotencyKey: crypto.randomUUID() }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "No se pudo calcular");
        setReview(result.after);
        setReviewFxRates(Object.fromEntries(Object.entries(result.next.fxQuotes ?? {}).map(([code, quote]) => [code, (quote as { ratePpm: number }).ratePpm])));
      } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo calcular"); return; }
      finally { setBusy(false); }
    }
    setReviewOpen(true);
  }

  async function confirmChanges() {
    if (!draft.source.trim() || draft.source.trim().length < 2) { toast.error("Indica la fuente del cambio"); return; }
    const saved = await save({ action: "bulk-prices", materials: changedMaterials.map((item) => ({ id: item.id, amount: draft.materials[item.id], currency: materialCurrency(item) })), expenses: changedExpenses.map((item) => ({ id: item.id, amount: draft.expenses[item.id], currency: expenseCurrency(item) })), expectedFxRates: reviewFxRates, source: draft.source.trim(), effectiveDate: draft.effectiveDate });
    if (saved) { setDraftStatus("saving"); setDraft(emptyDraft()); setReviewOpen(false); }
  }

  function editMetadata(action: { action: "update-material-meta" | "update-expense-meta"; id: string; field: string; value: string }) {
    if (action.field === "period") {
      setPendingMeta({ action, affected: state.products.map((item) => item.name), description: `Cambiar el período a ${action.value} puede cambiar el mes activo y qué gastos entran en el costo de cada producto.` });
      return;
    }
    if (action.field === "purchaseUnit") {
      const affected = [...new Set(state.components.filter((item) => item.materialId === action.id).map((item) => item.productId))];
      if (affected.length) {
        setPendingMeta({ action, affected: state.products.filter((item) => affected.includes(item.id)).map((item) => item.name), description: "Cambiar la unidad puede alterar cómo interpretas el consumo del insumo en estos productos. Revisa sus cantidades después de aplicar." });
        return;
      }
    }
    if (action.field === "allocationBasis" && state.products.length) {
      setPendingMeta({ action, affected: state.products.map((item) => item.name), description: "Cambiar la base de reparto redistribuye este gasto entre los productos." });
      return;
    }
    void save(action, true);
  }

  const fetchHistory = React.useCallback(async () => {
    const response = await fetch("/api/history", { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo cargar el historial");
    const data = await response.json();
    return { events: data.events ?? [], snapshots: data.snapshots ?? [], profileSnapshots: data.profileSnapshots ?? [] } as { events: HistoryEntry[]; snapshots: CostSnapshotRow[]; profileSnapshots: ProfileSnapshotRow[] };
  }, []);
  const applyHistory = React.useCallback((data: Awaited<ReturnType<typeof fetchHistory>>) => { setHistory(data.events); setSnapshots(data.snapshots); setProfileSnapshots(data.profileSnapshots); }, []);

  function loadHistory() {
    if (demo) return;
    fetchHistory().then(applyHistory).catch(() => toast.error("No se pudo cargar el historial"));
  }

  // Each section has its own URL; pushState keeps navigation instant (no server round trip) and back/forward work.
  function navigate(next: View, productId?: string) {
    if (productId) setSelected(productId);
    setView(next);
    if (next === "historial") loadHistory();
    if (!demo) {
      const path = appPath(next, productId ?? (next === "producto" ? selected : null));
      if (window.location.pathname !== path) window.history.pushState(null, "", path);
    }
  }

  const openRoute = React.useEffectEvent((pathname: string) => {
    const route = viewFromPathname(pathname);
    if (!route) return;
    if (route.productId) setSelected(route.productId);
    setView(route.view);
    if (route.view === "historial") loadHistory();
  });

  React.useEffect(() => {
    if (demo) return;
    // A deep link to /app/historial needs its data on first load.
    if (initialRoute.view === "historial") fetchHistory().then(applyHistory).catch(() => toast.error("No se pudo cargar el historial"));
    const onPopState = () => openRoute(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // Runs once: later route changes arrive through navigate() or popstate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  return (
    <SidebarProvider className="cozte-workspace">
      <Sidebar collapsible="icon">
        <SidebarHeader><div className="min-h-15 px-2 py-3 group-data-[collapsible=icon]:hidden"><CozteLogo className="text-2xl" /><span className="mt-1 block text-xs text-sidebar-foreground/65">Costeo vivo</span></div></SidebarHeader>
        <SidebarContent>{navGroups.map((group) => <SidebarGroup key={group.label}><SidebarGroupLabel>{group.label}</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>
          {group.items.map((item) => <NavigationItem key={item.id} item={item} active={view === item.id} badge={item.id === "planilla" ? changeCount : 0} onNavigate={() => navigate(item.id)} />)}
        </SidebarMenu></SidebarGroupContent></SidebarGroup>)}</SidebarContent>
        <SidebarFooter><div className="flex min-w-0 items-center gap-2 px-2 pb-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">{demo ? <Badge variant="outline" className="border-white/25 bg-white/5 text-white">Demostración</Badge> : <><div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"><OrganizationSwitcher hidePersonal appearance={{ elements: { organizationSwitcherTrigger: "cozte-org-trigger", organizationPreviewAvatarBox: "cozte-org-avatar", organizationSwitcherPopoverCard: "cozte-clerk-popover" } }} /></div><UserButton appearance={{ elements: { userButtonTrigger: "cozte-user-trigger", userButtonAvatarBox: "cozte-user-avatar", userButtonPopoverCard: "cozte-clerk-popover" } }} /></>}</div></SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-16 items-center gap-3 border-b bg-card px-4 md:px-8"><SidebarTrigger /><Separator orientation="vertical" className="h-6" /><span className="truncate text-sm font-semibold text-foreground">{demo ? state.organization.name : <ActiveOrganizationName fallback={state.organization.name} />}</span><div className="ml-auto flex items-center gap-2">{demo ? <Button variant="outline" size="sm" render={<Link href="/sign-up" />} nativeButton={false}>Crear cuenta</Button> : null}{!demo && !state.products.length && !state.materials.length && !state.expenses.length ? <NativeSelect value={currency} disabled={busy} aria-label="Moneda base de la empresa" onChange={(event) => void changeBaseCurrency(event.target.value as Currency)}>{supportedCurrencies.map((code) => <NativeSelectOption key={code} value={code}>{code}</NativeSelectOption>)}</NativeSelect> : <Badge variant="outline" title="Moneda base de la empresa">{currency}</Badge>}</div></header>
        <main className={view === "asistente" ? "mx-auto flex w-full max-w-none flex-col gap-4 px-4 py-5 md:px-8" : "mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-7 md:px-8 md:py-10"}>
          {demo && view !== "asistente" ? <Alert><AlertTitle>Vista de ejemplo</AlertTitle><AlertDescription>Puedes explorar y simular cambios. Para guardarlos, crea una cuenta.</AlertDescription></Alert> : null}
          {view === "dashboard" ? <>
            <section className="cozte-dashboard-hero rounded-[28px] p-6 sm:p-8 md:p-10">
              <div className="relative flex flex-wrap items-start justify-between gap-6"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground/75">Tu producción, en perspectiva</p><h1 className="mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-[-0.05em] text-primary-foreground sm:text-4xl">Costos de tus productos</h1><p className="mt-3 max-w-xl text-sm leading-relaxed text-primary-foreground/75">Cuánto te cuesta fabricar cada producto, qué falta para que ese número sea confiable y qué puedes aprender de él.</p></div><Button variant="secondary" onClick={() => setDialog("product")}><AnimatedIcon name="plus" data-icon="inline-start" />Añadir producto</Button></div>
              <div className="relative mt-9 grid gap-4 md:grid-cols-3">
                <Metric label="Productos con costo calculado" value={`${summary.calculated} de ${dashboardProductCount}`} note={summary.estimated ? `${summary.estimated} con supuestos por confirmar` : summary.calculated ? "Calculados por el motor con tus datos" : "Cozte te guía para completar los datos"} />
                <Metric label="Costo de producción del mes" value={summary.monthlyProductionCost !== null ? plainMoney(summary.monthlyProductionCost, currency) : "Por calcular"} note={summary.monthlyProductionCost !== null ? "Fabricar lo que produces en un mes normal" : "Falta el costo o los lotes al mes de algún producto"} />
                <Metric label="Datos por completar" value={String(summary.gaps.length + state.alerts.length)} note="Cada dato hace el costo más confiable" />
              </div>
            </section>
            {summary.gaps.length && state.products.length ? <Card><CardHeader><CardTitle>Próximos pasos para un costo confiable</CardTitle><CardDescription>Lo que más mejora la precisión, en orden. Puedes contárselo a Cozte con tus palabras o cargarlo en la planilla.</CardDescription></CardHeader>
              <CardContent><ol className="flex flex-col gap-2">{summary.gaps.slice(0, 5).map((gap, index) => <li key={gap} className="flex items-start gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm"><span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium tabular-nums text-muted-foreground">{index + 1}</span><span>{gap}</span></li>)}</ol>{summary.gaps.length > 5 ? <p className="mt-2 text-xs text-muted-foreground">Y {summary.gaps.length - 5} dato{summary.gaps.length - 5 === 1 ? "" : "s"} más.</p> : null}</CardContent>
              <CardFooter className="flex flex-wrap gap-2"><Button onClick={() => navigate("asistente")}><AnimatedIcon name="assistant" data-icon="inline-start" />Completar con Cozte</Button><Button variant="outline" onClick={() => navigate("planilla")}>Abrir costos de producción</Button></CardFooter></Card> : null}
            {state.alerts.length ? <Alert><AlertTitle>{state.alerts.length} precio{state.alerts.length === 1 ? "" : "s"} para revisar</AlertTitle><AlertDescription><div className="flex flex-wrap items-center gap-3"><span>{state.alerts.slice(0, 3).map((item) => item.message).join(" · ")}</span><Button variant="link" onClick={() => navigate("planilla")}>Abrir planilla</Button></div></AlertDescription></Alert> : null}
            {state.products.length ? <MonthCard state={state} demo={demo} month={businessMonth} onOpen={(section) => navigate(section)} /> : null}
            <Card><CardHeader><CardTitle>Fichas de productos</CardTitle><CardDescription>Lo que cuesta fabricar cada unidad, en qué se va ese costo y cuánto deja su precio de venta.</CardDescription>{summary.composition.length ? <CompositionLegend /> : null}</CardHeader><CardContent>{state.products.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Producto</TableHead><TableHead className="text-right">Costo/u</TableHead><TableHead className="min-w-40">En qué se va cada unidad</TableHead><TableHead className="text-right">Precio</TableHead><TableHead className="text-right">Margen</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{state.products.map((item) => { const cost = state.costs.find((entry) => entry.productId === item.id); return <TableRow key={item.id}><TableCell><button className="text-left font-medium hover:underline" onClick={() => { navigate("producto", item.id); }}>{item.name}</button><div className="text-xs text-muted-foreground">Lote de {item.lotUnits} unidades{item.batchesPerMonthMilli != null ? ` · ${item.batchesPerMonthMilli / 1000} lotes al mes` : ""}</div></TableCell><TableCell className="text-right tabular-nums">{formatMoney(cost?.unitMinor ?? null, currency)}{cost?.quality === "estimated" ? <div><Badge variant="outline" title={cost.assumptions.join(" · ")}>Estimado</Badge></div> : null}</TableCell><TableCell>{(() => { const parts = summary.composition.find((entry) => entry.productId === item.id); return parts ? <CompositionBar parts={parts} format={(value) => plainMoney(value, currency)} /> : <span className="text-xs text-muted-foreground">Se ve cuando el costo esté completo</span>; })()}</TableCell><TableCell className="text-right tabular-nums">{item.salePriceMinor > 0 ? formatMoney(item.salePriceMinor, currency) : "Sin definir"}</TableCell><TableCell className="text-right">{cost?.warnings.length ? <Badge variant="secondary">Incompleto</Badge> : formatPercent(cost?.estimatedMarginPercent ?? null)}</TableCell><TableCell><Button size="icon-sm" variant="ghost" aria-label={`Abrir ${item.name}`} onClick={() => { navigate("producto", item.id); }}><AnimatedIcon name="arrowRight" /></Button></TableCell></TableRow>; })}</TableBody></Table></div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><AnimatedIcon name="boxes" size={24} /></EmptyMedia><EmptyTitle>Aún no hay fichas comerciales</EmptyTitle><EmptyDescription>Empieza describiendo cómo produces; Cozte irá armando el costo con la información disponible.</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => navigate("asistente")}>Empezar con Cozte</Button></EmptyContent></Empty>}</CardContent></Card>
            {summary.lessons.length ? <Card><CardHeader><CardTitle>Para entender tu costo</CardTitle><CardDescription>Ideas de finanzas para tu producción, calculadas con tus propios números.</CardDescription></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{summary.lessons.map((lesson) => <article key={lesson.id} className="flex flex-col gap-1.5 rounded-lg border-l-4 border-l-primary bg-muted/40 px-4 py-3"><h3 className="text-sm font-semibold">{lesson.title}</h3><p className="text-sm leading-relaxed text-muted-foreground">{lesson.text}</p></article>)}</CardContent>
              <CardFooter><Button variant="outline" size="sm" onClick={() => navigate("asistente")}>Preguntarle a Cozte</Button></CardFooter></Card> : null}
            {productionWorkProducts.length > 0 ? <Card><CardHeader><CardTitle>{state.productionWork?.isDraft ? "Líneas de producción en armado" : "Líneas del mapa de producción"}</CardTitle><CardDescription>El avance aparece aquí mientras Cozte reúne los datos necesarios para calcular el costo de fabricación.</CardDescription></CardHeader><CardContent className="space-y-3">{productionWorkProducts.map((workProduct) => {
              const cost = state.productionWork?.costs.find((item) => item.product.toLocaleLowerCase() === workProduct.name.toLocaleLowerCase());
              const costReady = state.productionWork?.evaluableProducts.some((name) => name.toLocaleLowerCase() === workProduct.name.toLocaleLowerCase()) ?? false;
              return <div key={workProduct.name} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{workProduct.name}</span><Badge variant="outline">{state.productionWork?.isDraft ? "En armado" : "En el mapa"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{workProduct.goodUnitsPerBatch != null ? `${workProduct.goodUnitsPerBatch} ${workProduct.finishedUnit} por lote` : "Cozte está reuniendo los datos de producción."}{workProduct.batchesPerMonth != null ? ` · ${workProduct.batchesPerMonth} lotes al mes` : ""}</p></div>
                <div className="text-right"><p className="text-xs text-muted-foreground">Costo de fabricación por {workProduct.finishedUnit}</p><p className="font-semibold tabular-nums">{costReady ? formatMoney(cost?.unitMinor ?? null, currency) : "Por calcular"}</p></div>
              </div>;
            })}<Button variant="outline" onClick={() => navigate("asistente")}>Seguir armando con Cozte</Button></CardContent></Card> : null}
            {changeCount ? <Alert><AlertTitle>Hay {changeCount} cambio{changeCount === 1 ? "" : "s"} en borrador</AlertTitle><AlertDescription><Button variant="link" onClick={reviewChanges}>Revisar impacto en todos los productos</Button></AlertDescription></Alert> : null}
          </> : null}

          {view === "producto" && product ? <>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><Button variant="ghost" size="sm" onClick={() => navigate("dashboard")}><AnimatedIcon name="arrowLeft" data-icon="inline-start" />Todos los productos</Button><h1 className="mt-2 text-3xl font-semibold tracking-tight">{product.name}</h1><p className="text-sm text-muted-foreground">Lote de {product.lotUnits} unidades · {product.batchesPerMonthMilli != null ? `${product.batchesPerMonthMilli / 1000} lotes al mes` : "lotes al mes sin definir"} · versión {product.version}</p></div><Button variant="outline" onClick={() => setDialog("edit-product")}><AnimatedIcon name="edit" data-icon="inline-start" />Editar producto</Button></div>
            {currentCost?.warnings.length ? <Alert><AlertTitle>Costeo incompleto</AlertTitle><AlertDescription>{currentCost.warnings.join(" · ")}{currentCost.partialUnitMinor > 0 ? ` · Costo conocido hasta ahora: ${formatMoney(currentCost.partialUnitMinor, currency)} por unidad` : ""}</AlertDescription></Alert> : null}
            {!currentCost?.warnings.length && currentCost?.assumptions.length ? <Alert><AlertTitle>Costo estimado</AlertTitle><AlertDescription>{currentCost.assumptions.join(" · ")}</AlertDescription></Alert> : null}
            <div className="grid gap-4 md:grid-cols-3"><Metric label="Fabricación por unidad" value={formatMoney(currentCost?.unitMinor ?? null, currency)} note="Incluye gastos compartidos" /><Metric label="Gasto compartido por lote" value={formatMoney(currentCost?.lines.find((line) => line.kind === "shared_expense")?.amountMinor ?? 0, currency)} note="Asignado según actividad" /><Metric label="Margen estimado" value={formatPercent(currentCost?.estimatedMarginPercent ?? null)} note="Después de venta variable" /></div>
            <Card><CardHeader><CardTitle>Desglose del lote</CardTitle><CardDescription>Los insumos compartidos usan un único precio vigente.</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Concepto</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Lote</TableHead><TableHead className="text-right">Unidad</TableHead></TableRow></TableHeader><TableBody>{currentCost?.lines.map((line, index) => <TableRow key={`${line.kind}-${line.materialId ?? index}`}><TableCell><strong>{line.label}</strong>{line.quantityMilli != null ? <div className="text-xs text-muted-foreground">{line.quantityMilli / 1000} {state.materials.find((item) => item.id === line.materialId)?.purchaseUnit}</div> : null}</TableCell><TableCell>{line.kind === "material" ? "Directo" : line.kind === "labor" ? "Trabajo directo" : "Indirecto compartido"}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(line.amountMinor, currency)}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(Math.round(line.amountMinor / product.lotUnits), currency)}</TableCell></TableRow>)}</TableBody></Table></div></CardContent><CardFooter className="flex justify-between"><span>Total fabricación</span><strong>{formatMoney(currentCost?.totalLotMinor ?? null, currency)}</strong></CardFooter></Card>
            <ProductComponents product={product} state={state} onSave={save} busy={busy} demo={demo} />
            <Card><CardHeader><CardTitle>Decisión de negocio</CardTitle><CardDescription>Registra por qué cambiaste precio, proveedor o proceso.</CardDescription></CardHeader><CardContent><Textarea value={decision} onChange={(event) => setDecision(event.target.value)} placeholder="Ej. Revisaremos el precio de venta tras la suba del papel" /></CardContent><CardFooter><Button disabled={busy || decision.trim().length < 3 || demo} onClick={async () => { if (await save({ action: "record-decision", productId: product.id, kind: "other", note: decision })) setDecision(""); }}>Guardar decisión</Button></CardFooter></Card>
          </> : null}

          {view === "planilla" ? <>
            <CostSheet state={state} draft={draft} draftReady={draftReady} draftStatus={draftStatus} canReview={clientPreview !== null} busy={busy} demo={demo} onOpenCozte={() => navigate("asistente")}
              onRetryDraft={() => { if (draftReady) { setDraftStatus("saving"); setDraft((current) => ({ ...current })); } else { setDraftStatus("loading"); setDraftLoadAttempt((current) => current + 1); } }}
              onMaterialPrice={(id, value) => { if (!demo) setDraftStatus("saving"); setDraft((current) => ({ ...current, materials: { ...current.materials, [id]: value } })); setReview(null); }}
              onExpenseAmount={(id, value) => { if (!demo) setDraftStatus("saving"); setDraft((current) => ({ ...current, expenses: { ...current.expenses, [id]: value } })); setReview(null); }}
              onMaterialCurrency={(id, value) => { setDraftStatus("saving"); setDraft((current) => { const materials = { ...current.materials }; delete materials[id]; const materialCurrencies = { ...current.materialCurrencies }; if (value === (state.materials.find((item) => item.id === id)?.currency ?? currency)) delete materialCurrencies[id]; else materialCurrencies[id] = value; return { ...current, materials, materialCurrencies }; }); setReview(null); }}
              onExpenseCurrency={(id, value) => { setDraftStatus("saving"); setDraft((current) => { const expenses = { ...current.expenses }; delete expenses[id]; const expenseCurrencies = { ...current.expenseCurrencies }; if (value === (state.expenses.find((item) => item.id === id)?.currency ?? currency)) delete expenseCurrencies[id]; else expenseCurrencies[id] = value; return { ...current, expenses, expenseCurrencies }; }); setReview(null); }}
              onMetaChange={editMetadata} onAddMaterial={() => setDialog("material")} onAddExpense={() => setDialog("expense")}
              onCategoryCreate={(name) => save({ action: "create-category", name }, true)}
              onCategoryRename={(id, name) => save({ action: "rename-category", id, name }, true)}
              onAllocationChange={(id, basis, shares) => setPendingMeta({ action: { action: "update-expense-allocation", id, basis, shares }, affected: state.products.map((item) => item.name), description: "Este reparto cambia la porción asignada a cada producto. Confirma para recalcular los costos." })}
              onUsageChange={(productId, materialId, quantityMilli) => save({ action: "set-component", productId, materialId, quantityMilli }, true)}
              onReview={reviewChanges} onDiscard={() => { if (!demo) setDraftStatus("saving"); setDraft(emptyDraft()); setReview(null); }} />
          </> : null}

          {view === "ventas" ? <SalesSection state={state} demo={demo} month={businessMonth} onMonthChange={setBusinessMonth} onOpenCozte={() => navigate("asistente")} /> : null}

          {view === "gastos" ? <ExpensesSection state={state} demo={demo} month={businessMonth} onSave={save} onOpenProduction={() => navigate("planilla")} onOpenPurchases={() => navigate("compras")} /> : null}

          {view === "compras" ? <PurchasesSection state={state} demo={demo} month={businessMonth} onMonthChange={setBusinessMonth} onOpenCozte={() => navigate("asistente")} onDataChanged={refresh} /> : null}

          {view === "resultado" ? <ResultSection state={state} demo={demo} month={businessMonth} onMonthChange={setBusinessMonth} onOpenSales={() => navigate("ventas")} onOpenCozte={() => navigate("asistente")} /> : null}

          {view === "analisis" ? <CostAnalysisView currency={currency} demo={demo} /> : null}

          {view === "asistente" ? <CozteAssistant demo={demo} state={state} onDataChanged={refresh} onOpenCosts={() => navigate("planilla")} /> : null}

          {view === "historial" ? <CostHistory state={state} events={history} snapshots={snapshots} profileSnapshots={profileSnapshots} /> : null}
        </main>
      </SidebarInset>
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Antes de confirmar</DialogTitle><DialogDescription>Ningún cambio de la planilla se aplica hasta que lo apruebes.</DialogDescription></DialogHeader>
        {changeCount ? <div className="flex flex-col gap-4">
              <Card><CardHeader><CardTitle>{changeCount} cambio{changeCount === 1 ? "" : "s"} en borrador</CardTitle><CardDescription>Importes originales y equivalencia en {currency}. Si cambia la cotización, volverás a revisar.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Concepto</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Vigente ({currency})</TableHead><TableHead className="text-right">Nuevo original</TableHead><TableHead className="text-right">Equivalente ({currency})</TableHead></TableRow></TableHeader><TableBody>{changedMaterials.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>Insumo</TableCell><TableCell className="text-right">{formatMoney(item.priceMinor, currency)}</TableCell><TableCell className="text-right">{draft.materials[item.id] === undefined ? "Pendiente" : formatMoney(draft.materials[item.id], materialCurrency(item))}</TableCell><TableCell className="text-right">{draft.materials[item.id] === undefined ? "—" : formatMoney(convertToOrganizationCurrency(state, toNativeMilli(draft.materials[item.id]), materialCurrency(item)), currency)}</TableCell></TableRow>)}{changedExpenses.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>Gasto compartido</TableCell><TableCell className="text-right">{formatMoney(item.amountMinor, currency)}</TableCell><TableCell className="text-right">{draft.expenses[item.id] === undefined ? "Pendiente" : formatMoney(draft.expenses[item.id], expenseCurrency(item))}</TableCell><TableCell className="text-right">{draft.expenses[item.id] === undefined ? "—" : formatMoney(convertToOrganizationCurrency(state, toNativeMilli(draft.expenses[item.id]), expenseCurrency(item)), currency)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
              <Card><CardHeader><CardTitle>Impacto en productos</CardTitle><CardDescription>Fabricación por unidad, calculada con las mismas reglas que el costo vigente.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Producto</TableHead><TableHead className="text-right">Vigente</TableHead><TableHead className="text-right">Nuevo</TableHead><TableHead className="text-right">Diferencia</TableHead></TableRow></TableHeader><TableBody>{state.products.map((item) => { const oldCost = state.costs.find((entry) => entry.productId === item.id); const newCost = preview?.find((entry) => entry.productId === item.id); const delta = oldCost?.unitMinor != null && newCost?.unitMinor != null ? newCost.unitMinor - oldCost.unitMinor : null; return <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell className="text-right">{formatMoney(oldCost?.unitMinor ?? null, currency)}</TableCell><TableCell className="text-right">{formatMoney(newCost?.unitMinor ?? null, currency)}</TableCell><TableCell className="text-right"><Badge variant={delta && delta > 0 ? "destructive" : "secondary"}>{delta == null ? "—" : `${delta > 0 ? "+" : ""}${formatMoney(delta, currency)}`}</Badge></TableCell></TableRow>; })}</TableBody></Table></CardContent></Card>
              <Card><CardHeader><CardTitle>Fuente y fecha</CardTitle><CardDescription>Estos datos quedarán en el historial de la actualización.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-2"><label className="flex flex-col gap-1 text-sm">Fuente<Input value={draft.source} onChange={(event) => { setDraftStatus("saving"); setDraft((current) => ({ ...current, source: event.target.value })); }} placeholder="Factura, cotización o verificación manual" /></label><label className="flex flex-col gap-1 text-sm">Fecha efectiva<Input type="date" value={draft.effectiveDate} onChange={(event) => { setDraftStatus("saving"); setDraft((current) => ({ ...current, effectiveDate: event.target.value })); }} /></label></CardContent><CardFooter className="flex gap-2"><Button variant="outline" onClick={() => setReviewOpen(false)}>Seguir editando</Button><Button disabled={busy || demo} onClick={confirmChanges}>Confirmar cambios</Button></CardFooter></Card>
        </div> : <p className="text-sm text-muted-foreground">No hay cambios en borrador.</p>}
      </DialogContent></Dialog>
      <EntityDialog kind={dialog} product={dialog === "edit-product" ? product : undefined} products={state.products} categories={state.categories ?? [...new Set([...state.materials.map((item) => item.category), ...state.expenses.map((item) => item.category)])].map((name) => ({ id: name, name }))} onClose={() => setDialog(null)} onSave={save} currency={currency} busy={busy} demo={demo} />
      <Dialog open={pendingMeta !== null} onOpenChange={(open) => { if (!open) setPendingMeta(null); }}><DialogContent><DialogHeader><DialogTitle>Este cambio afecta otros productos</DialogTitle><DialogDescription>{pendingMeta?.description}</DialogDescription></DialogHeader><div className="flex flex-wrap gap-2">{pendingMeta?.affected.map((name) => <Badge key={name} variant="secondary">{name}</Badge>)}</div><DialogFooter><Button variant="outline" onClick={() => setPendingMeta(null)}>Cancelar</Button><Button disabled={busy} onClick={async () => { if (pendingMeta && await save({ ...pendingMeta.action, acknowledgeImpact: true }, true)) setPendingMeta(null); }}>Aplicar cambio</Button></DialogFooter></DialogContent></Dialog>
    </SidebarProvider>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <Card><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="text-3xl tabular-nums">{value}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{note}</CardContent></Card>;
}

function ActiveOrganizationName({ fallback }: { fallback: string }) {
  const { organization } = useOrganization();
  return organization?.name ?? fallback;
}

function NavigationItem({ item, active, badge, onNavigate }: { item: NavItem; active: boolean; badge: number; onNavigate: () => void }) {
  const { setOpenMobile } = useSidebar();
  return <SidebarMenuItem><SidebarMenuButton isActive={active} tooltip={item.label} onClick={() => { onNavigate(); setOpenMobile(false); }}><AnimatedIcon name={item.icon} /><span>{item.label}</span>{badge > 0 ? <Badge variant="secondary">{badge}</Badge> : null}</SidebarMenuButton></SidebarMenuItem>;
}

function ProductComponents({ product, state, onSave, busy, demo }: { product: Product; state: Dashboard; onSave: (action: Record<string, unknown>) => Promise<boolean>; busy: boolean; demo: boolean }) {
  const [materialId, setMaterialId] = React.useState(state.materials[0]?.id ?? "");
  const [quantity, setQuantity] = React.useState("1");
  const components = state.components.filter((item) => item.productId === product.id);
  return <Card><CardHeader><CardTitle>Composición</CardTitle><CardDescription>Un mismo insumo puede estar en varios productos con cantidades distintas.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Insumo</TableHead><TableHead>Consumo por lote</TableHead><TableHead className="text-right">Acción</TableHead></TableRow></TableHeader><TableBody>{components.map((item) => { const material = state.materials.find((entry) => entry.id === item.materialId); return <TableRow key={item.materialId}><TableCell>{material?.name ?? "Insumo no encontrado"}</TableCell><TableCell>{item.quantityMilli / 1000} {material?.purchaseUnit}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" disabled={busy || demo} onClick={() => void onSave({ action: "set-component", productId: product.id, materialId: item.materialId, quantityMilli: 0 })}>Quitar</Button></TableCell></TableRow>; })}</TableBody></Table></CardContent><CardFooter className="flex flex-wrap gap-2"><NativeSelect value={materialId} onChange={(event) => setMaterialId(event.target.value)} aria-label="Insumo para agregar"><NativeSelectOption value="">Seleccionar insumo</NativeSelectOption>{state.materials.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect><Input className="w-28" type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} aria-label="Cantidad por lote" /><Button variant="outline" disabled={!materialId || busy || demo} onClick={() => void onSave({ action: "set-component", productId: product.id, materialId, quantityMilli: Math.round(Number(quantity) * 1000) })}>Guardar consumo</Button></CardFooter></Card>;
}
