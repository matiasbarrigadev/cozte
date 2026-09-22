"use client";

import * as React from "react";
import Link from "next/link";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Bot, Boxes, ClipboardCheck, Clock3, FileText, LayoutDashboard, Plus, Table2 } from "lucide-react";
import { calculateCosts, type DomainState, type Product, type ProductCost } from "@/lib/domain";
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
import { EvidencePanel } from "./evidence-panel";
import { CostSheet } from "./cost-sheet";
import { CozteAssistant } from "./cozte-assistant";
import { CostHistory, type CostSnapshotRow, type HistoryEntry, type ProfileSnapshotRow } from "./cost-history";

type Dashboard = DomainState & { costs: ProductCost[]; alerts: { id: string; material_id: string; message: string; first_detected_at: string }[] };
type View = "dashboard" | "producto" | "planilla" | "revision" | "comprobantes" | "asistente" | "historial";
type Draft = { materials: Record<string, number>; expenses: Record<string, number>; source: string; effectiveDate: string };

const nav: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "planilla", label: "Costos de producción", icon: Table2 },
  { id: "revision", label: "Revisar cambios", icon: ClipboardCheck },
  { id: "comprobantes", label: "Comprobantes", icon: FileText },
  { id: "asistente", label: "Cozte AI", icon: Bot },
  { id: "historial", label: "Historial", icon: Clock3 },
];

const formatMoney = (value: number | null, currency: string) => value === null ? "Sin calcular" : new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const formatPercent = (value: number | null) => value === null ? "—" : `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(value)}%`;
const emptyDraft = (): Draft => ({ materials: {}, expenses: {}, source: "", effectiveDate: new Date().toISOString().slice(0, 10) });

export function CostosApp({ initial, demo = false }: { initial: Dashboard; demo?: boolean }) {
  const [state, setState] = React.useState<Dashboard>(initial);
  const [view, setView] = React.useState<View>("dashboard");
  const [selected, setSelected] = React.useState<string | null>(initial.products[0]?.id ?? null);
  const [draft, setDraft] = React.useState<Draft>(() => { const value = emptyDraft(); if (demo) value.materials.papel = 10000; return value; });
  const [draftReady, setDraftReady] = React.useState(demo);
  const [draftLoadAttempt, setDraftLoadAttempt] = React.useState(0);
  const [draftStatus, setDraftStatus] = React.useState<"loading" | "saving" | "saved" | "error">(demo ? "saved" : "loading");
  const draftGeneration = React.useRef(0);
  const draftWriteChain = React.useRef<Promise<void>>(Promise.resolve());
  const [review, setReview] = React.useState<ProductCost[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [pendingMeta, setPendingMeta] = React.useState<{ action: Record<string, unknown>; affected: string[]; description: string } | null>(null);
  const [dialog, setDialog] = React.useState<"product" | "material" | "expense" | "edit-product" | null>(null);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const [snapshots, setSnapshots] = React.useState<CostSnapshotRow[]>([]);
  const [profileSnapshots, setProfileSnapshots] = React.useState<ProfileSnapshotRow[]>([]);
  const [decision, setDecision] = React.useState("");
  const currency = state.organization.currency;
  const product = state.products.find((item) => item.id === selected) ?? state.products[0];
  const currentCost = state.costs.find((item) => item.productId === product?.id);
  const changedMaterials = state.materials.filter((item) => draft.materials[item.id] !== undefined && draft.materials[item.id] !== item.priceMinor);
  const changedExpenses = state.expenses.filter((item) => item.period === state.activePeriod && draft.expenses[item.id] !== undefined && draft.expenses[item.id] !== item.amountMinor);
  const changeCount = changedMaterials.length + changedExpenses.length;
  const clientPreview = React.useMemo(() => {
    try { return calculateCosts(state, draft.materials, draft.expenses); } catch { return null; }
  }, [state, draft]);
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
        const response = await fetch("/api/changes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "bulk-prices", materials: changedMaterials.map((item) => ({ id: item.id, priceMinor: draft.materials[item.id] })), expenses: changedExpenses.map((item) => ({ id: item.id, amountMinor: draft.expenses[item.id] })), source: draft.source || "Pendiente de fuente", effectiveDate: draft.effectiveDate, expectedRevision: state.revision, idempotencyKey: crypto.randomUUID() }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "No se pudo calcular");
        setReview(result.after);
      } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo calcular"); return; }
      finally { setBusy(false); }
    }
    setView("revision");
  }

  async function confirmChanges() {
    if (!draft.source.trim() || draft.source.trim().length < 2) { toast.error("Indica la fuente del cambio"); return; }
    const saved = await save({ action: "bulk-prices", materials: changedMaterials.map((item) => ({ id: item.id, priceMinor: draft.materials[item.id] })), expenses: changedExpenses.map((item) => ({ id: item.id, amountMinor: draft.expenses[item.id] })), source: draft.source.trim(), effectiveDate: draft.effectiveDate });
    if (saved) { setDraftStatus("saving"); setDraft(emptyDraft()); setView("dashboard"); }
  }

  function editMetadata(action: { action: "update-material-meta" | "update-expense-meta"; id: string; field: string; value: string }) {
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

  async function loadHistory() {
    if (demo) return;
    try { const response = await fetch("/api/history", { cache: "no-store" }); if (response.ok) { const data = await response.json(); setHistory(data.events ?? []); setSnapshots(data.snapshots ?? []); setProfileSnapshots(data.profileSnapshots ?? []); } }
    catch { toast.error("No se pudo cargar el historial"); }
  }

  function navigate(next: View) {
    setView(next);
    if (next === "historial") void loadHistory();
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader><div className="flex items-center gap-3 px-2 py-3"><div className="flex size-9 items-center justify-center rounded-lg bg-primary text-xl font-bold text-primary-foreground" aria-hidden="true">C</div><div className="group-data-[collapsible=icon]:hidden"><strong className="block text-lg tracking-tight">Cozte</strong><span className="text-xs text-muted-foreground">Costeo vivo</span></div></div></SidebarHeader>
        <SidebarContent><SidebarGroup><SidebarGroupLabel>Espacio de trabajo</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>
          {nav.map((item) => <NavigationItem key={item.id} item={item} active={view === item.id} badge={item.id === "revision" ? changeCount : 0} onNavigate={() => navigate(item.id)} />)}
        </SidebarMenu></SidebarGroupContent></SidebarGroup></SidebarContent>
        <SidebarFooter><div className="flex items-center gap-2 px-2 pb-2">{demo ? <Badge variant="outline">Demostración</Badge> : <><OrganizationSwitcher hidePersonal /><UserButton /></>}</div></SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-16 items-center gap-3 border-b px-4 md:px-8"><SidebarTrigger /><Separator orientation="vertical" className="h-6" /><span className="truncate text-sm text-muted-foreground">{state.organization.name}</span><div className="ml-auto flex items-center gap-2">{demo ? <Button variant="outline" size="sm" render={<Link href="/sign-up" />} nativeButton={false}>Crear cuenta</Button> : null}<Badge variant="outline">{currency}</Badge></div></header>
        <main className={view === "asistente" ? "mx-auto flex w-full max-w-none flex-col gap-4 px-4 py-5 md:px-8" : "mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-7 md:px-8 md:py-10"}>
          {demo && view !== "asistente" ? <Alert><AlertTitle>Vista de ejemplo</AlertTitle><AlertDescription>Puedes explorar y simular cambios. Para guardarlos, crea una cuenta.</AlertDescription></Alert> : null}
          {view === "dashboard" ? <>
            <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">Dashboard</p><h1 className="text-3xl font-semibold tracking-tight">Costos de tus productos</h1></div><Button onClick={() => setDialog("product")}><Plus data-icon="inline-start" />Añadir producto</Button></div>
            <div className="grid gap-4 md:grid-cols-3"><Metric label="Productos" value={String(state.products.length)} note="Variantes y productos costeados" /><Metric label="Insumos compartidos" value={String(state.materials.filter((item) => state.components.filter((component) => component.materialId === item.id).length > 1).length)} note="Un precio, varios productos" /><Metric label="Por revisar" value={String(changeCount + state.alerts.length + state.costs.filter((item) => item.warnings.length > 0).length)} note="Cambios y datos faltantes" /></div>
            {state.alerts.length ? <Alert><AlertTitle>{state.alerts.length} precio{state.alerts.length === 1 ? "" : "s"} para revisar</AlertTitle><AlertDescription><div className="flex flex-wrap items-center gap-3"><span>{state.alerts.slice(0, 3).map((item) => item.message).join(" · ")}</span><Button variant="link" onClick={() => setView("planilla")}>Abrir planilla</Button></div></AlertDescription></Alert> : null}
            <Card><CardHeader><CardTitle>Todos los productos</CardTitle><CardDescription>Costo de fabricación por unidad y margen estimado</CardDescription></CardHeader><CardContent>{state.products.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Producto</TableHead><TableHead className="text-right">Costo/u</TableHead><TableHead className="text-right">Precio</TableHead><TableHead className="text-right">Margen</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{state.products.map((item) => { const cost = state.costs.find((entry) => entry.productId === item.id); return <TableRow key={item.id}><TableCell><button className="text-left font-medium hover:underline" onClick={() => { setSelected(item.id); setView("producto"); }}>{item.name}</button><div className="text-xs text-muted-foreground">Lote de {item.lotUnits} unidades</div></TableCell><TableCell className="text-right tabular-nums">{formatMoney(cost?.unitMinor ?? null, currency)}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(item.salePriceMinor, currency)}</TableCell><TableCell className="text-right">{cost?.warnings.length ? <Badge variant="secondary">Incompleto</Badge> : formatPercent(cost?.estimatedMarginPercent ?? null)}</TableCell><TableCell><Button size="icon-sm" variant="ghost" aria-label={`Abrir ${item.name}`} onClick={() => { setSelected(item.id); setView("producto"); }}><ArrowRight /></Button></TableCell></TableRow>; })}</TableBody></Table></div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><Boxes /></EmptyMedia><EmptyTitle>Todavía no hay productos</EmptyTitle><EmptyDescription>Crea el primero y carga sus insumos.</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => setDialog("product")}>Crear producto</Button></EmptyContent></Empty>}</CardContent></Card>
            {changeCount ? <Alert><AlertTitle>Hay {changeCount} cambio{changeCount === 1 ? "" : "s"} en borrador</AlertTitle><AlertDescription><Button variant="link" onClick={reviewChanges}>Revisar impacto en todos los productos</Button></AlertDescription></Alert> : null}
          </> : null}

          {view === "producto" && product ? <>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><Button variant="ghost" size="sm" onClick={() => setView("dashboard")}><ArrowLeft data-icon="inline-start" />Todos los productos</Button><h1 className="mt-2 text-3xl font-semibold tracking-tight">{product.name}</h1><p className="text-sm text-muted-foreground">Lote de {product.lotUnits} unidades · versión {product.version}</p></div><Button variant="outline" onClick={() => setDialog("edit-product")}>Editar producto</Button></div>
            {currentCost?.warnings.length ? <Alert><AlertTitle>Costeo incompleto</AlertTitle><AlertDescription>{currentCost.warnings.join(" · ")}</AlertDescription></Alert> : null}
            <div className="grid gap-4 md:grid-cols-3"><Metric label="Fabricación por unidad" value={formatMoney(currentCost?.unitMinor ?? null, currency)} note="Incluye gastos compartidos" /><Metric label="Gasto compartido por lote" value={formatMoney(currentCost?.lines.find((line) => line.kind === "shared_expense")?.amountMinor ?? 0, currency)} note="Asignado según actividad" /><Metric label="Margen estimado" value={formatPercent(currentCost?.estimatedMarginPercent ?? null)} note="Después de venta variable" /></div>
            <Card><CardHeader><CardTitle>Desglose del lote</CardTitle><CardDescription>Los insumos compartidos usan un único precio vigente.</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Concepto</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Lote</TableHead><TableHead className="text-right">Unidad</TableHead></TableRow></TableHeader><TableBody>{currentCost?.lines.map((line, index) => <TableRow key={`${line.kind}-${line.materialId ?? index}`}><TableCell><strong>{line.label}</strong>{line.quantityMilli != null ? <div className="text-xs text-muted-foreground">{line.quantityMilli / 1000} {state.materials.find((item) => item.id === line.materialId)?.purchaseUnit}</div> : null}</TableCell><TableCell>{line.kind === "material" ? "Directo" : line.kind === "labor" ? "Trabajo directo" : "Indirecto compartido"}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(line.amountMinor, currency)}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(Math.round(line.amountMinor / product.lotUnits), currency)}</TableCell></TableRow>)}</TableBody></Table></div></CardContent><CardFooter className="flex justify-between"><span>Total fabricación</span><strong>{formatMoney(currentCost?.totalLotMinor ?? null, currency)}</strong></CardFooter></Card>
            <ProductComponents product={product} state={state} onSave={save} busy={busy} demo={demo} />
            <Card><CardHeader><CardTitle>Decisión de negocio</CardTitle><CardDescription>Registra por qué cambiaste precio, proveedor o proceso.</CardDescription></CardHeader><CardContent><Textarea value={decision} onChange={(event) => setDecision(event.target.value)} placeholder="Ej. Revisaremos el precio de venta tras la suba del papel" /></CardContent><CardFooter><Button disabled={busy || decision.trim().length < 3 || demo} onClick={async () => { if (await save({ action: "record-decision", productId: product.id, kind: "other", note: decision })) setDecision(""); }}>Guardar decisión</Button></CardFooter></Card>
          </> : null}

          {view === "planilla" ? <>
            <CostSheet state={state} draft={draft} draftReady={draftReady} draftStatus={draftStatus} canReview={clientPreview !== null} busy={busy} demo={demo}
              onRetryDraft={() => { if (draftReady) { setDraftStatus("saving"); setDraft((current) => ({ ...current })); } else { setDraftStatus("loading"); setDraftLoadAttempt((current) => current + 1); } }}
              onMaterialPrice={(id, value) => { if (!demo) setDraftStatus("saving"); setDraft((current) => ({ ...current, materials: { ...current.materials, [id]: value } })); setReview(null); }}
              onExpenseAmount={(id, value) => { if (!demo) setDraftStatus("saving"); setDraft((current) => ({ ...current, expenses: { ...current.expenses, [id]: value } })); setReview(null); }}
              onMetaChange={editMetadata} onAddMaterial={() => setDialog("material")} onAddExpense={() => setDialog("expense")}
              onReview={reviewChanges} onDiscard={() => { if (!demo) setDraftStatus("saving"); setDraft(emptyDraft()); setReview(null); }} />
          </> : null}

          {view === "comprobantes" ? <><div><p className="text-sm text-muted-foreground">Evidencia</p><h1 className="text-3xl font-semibold tracking-tight">Comprobantes</h1></div><EvidencePanel demo={demo} /></> : null}

          {view === "revision" ? <>
            <div><p className="text-sm text-muted-foreground">Revisión</p><h1 className="text-3xl font-semibold tracking-tight">Antes de confirmar</h1><p className="text-sm text-muted-foreground">Ningún cambio se aplica hasta que lo apruebes.</p></div>
            {!changeCount ? <Empty><EmptyHeader><EmptyMedia variant="icon"><ClipboardCheck /></EmptyMedia><EmptyTitle>No hay cambios</EmptyTitle><EmptyDescription>Edita un precio o un gasto en la planilla.</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => setView("planilla")}>Abrir planilla</Button></EmptyContent></Empty> : <>
              <Card><CardHeader><CardTitle>{changeCount} cambio{changeCount === 1 ? "" : "s"} en borrador</CardTitle><CardDescription>Valores vigentes frente a nuevos valores</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Concepto</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Vigente</TableHead><TableHead className="text-right">Nuevo</TableHead></TableRow></TableHeader><TableBody>{changedMaterials.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>Insumo</TableCell><TableCell className="text-right">{formatMoney(item.priceMinor, currency)}</TableCell><TableCell className="text-right">{formatMoney(draft.materials[item.id], currency)}</TableCell></TableRow>)}{changedExpenses.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>Gasto compartido</TableCell><TableCell className="text-right">{formatMoney(item.amountMinor, currency)}</TableCell><TableCell className="text-right">{formatMoney(draft.expenses[item.id], currency)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
              <Card><CardHeader><CardTitle>Impacto en productos</CardTitle><CardDescription>Fabricación por unidad, calculada con las mismas reglas que el costo vigente.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Producto</TableHead><TableHead className="text-right">Vigente</TableHead><TableHead className="text-right">Nuevo</TableHead><TableHead className="text-right">Diferencia</TableHead></TableRow></TableHeader><TableBody>{state.products.map((item) => { const oldCost = state.costs.find((entry) => entry.productId === item.id); const newCost = preview?.find((entry) => entry.productId === item.id); const delta = oldCost?.unitMinor != null && newCost?.unitMinor != null ? newCost.unitMinor - oldCost.unitMinor : null; return <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell className="text-right">{formatMoney(oldCost?.unitMinor ?? null, currency)}</TableCell><TableCell className="text-right">{formatMoney(newCost?.unitMinor ?? null, currency)}</TableCell><TableCell className="text-right"><Badge variant={delta && delta > 0 ? "destructive" : "secondary"}>{delta == null ? "—" : `${delta > 0 ? "+" : ""}${formatMoney(delta, currency)}`}</Badge></TableCell></TableRow>; })}</TableBody></Table></CardContent></Card>
              <Card><CardHeader><CardTitle>Fuente y fecha</CardTitle><CardDescription>Estos datos quedarán en el historial de la actualización.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-2"><label className="flex flex-col gap-1 text-sm">Fuente<Input value={draft.source} onChange={(event) => { setDraftStatus("saving"); setDraft((current) => ({ ...current, source: event.target.value })); }} placeholder="Factura, cotización o verificación manual" /></label><label className="flex flex-col gap-1 text-sm">Fecha efectiva<Input type="date" value={draft.effectiveDate} onChange={(event) => { setDraftStatus("saving"); setDraft((current) => ({ ...current, effectiveDate: event.target.value })); }} /></label></CardContent><CardFooter className="flex gap-2"><Button variant="outline" onClick={() => setView("planilla")}>Seguir editando</Button><Button disabled={busy || demo} onClick={confirmChanges}>Confirmar cambios</Button></CardFooter></Card>
            </>}
          </> : null}

          {view === "asistente" ? <CozteAssistant state={state} demo={demo} onMaterialProposal={(materialId, priceMinor) => { setDraftStatus("saving"); setDraft((current) => ({ ...current, materials: { ...current.materials, [materialId]: priceMinor } })); toast.info("Precio agregado al borrador. Revísalo antes de confirmar."); setView("planilla"); }} /> : null}

          {view === "historial" ? <CostHistory state={state} events={history} snapshots={snapshots} profileSnapshots={profileSnapshots} /> : null}
        </main>
      </SidebarInset>
      <EntityDialog kind={dialog} product={dialog === "edit-product" ? product : undefined} products={state.products} onClose={() => setDialog(null)} onSave={save} currency={currency} busy={busy} demo={demo} />
      <Dialog open={pendingMeta !== null} onOpenChange={(open) => { if (!open) setPendingMeta(null); }}><DialogContent><DialogHeader><DialogTitle>Este cambio afecta otros productos</DialogTitle><DialogDescription>{pendingMeta?.description}</DialogDescription></DialogHeader><div className="flex flex-wrap gap-2">{pendingMeta?.affected.map((name) => <Badge key={name} variant="secondary">{name}</Badge>)}</div><DialogFooter><Button variant="outline" onClick={() => setPendingMeta(null)}>Cancelar</Button><Button disabled={busy} onClick={async () => { if (pendingMeta && await save({ ...pendingMeta.action, acknowledgeImpact: true }, true)) setPendingMeta(null); }}>Aplicar cambio</Button></DialogFooter></DialogContent></Dialog>
    </SidebarProvider>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <Card><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="text-3xl tabular-nums">{value}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{note}</CardContent></Card>;
}

function NavigationItem({ item, active, badge, onNavigate }: { item: (typeof nav)[number]; active: boolean; badge: number; onNavigate: () => void }) {
  const { setOpenMobile } = useSidebar();
  return <SidebarMenuItem><SidebarMenuButton isActive={active} tooltip={item.label} onClick={() => { onNavigate(); setOpenMobile(false); }}><item.icon /><span>{item.label}</span>{badge > 0 ? <Badge variant="secondary">{badge}</Badge> : null}</SidebarMenuButton></SidebarMenuItem>;
}

function ProductComponents({ product, state, onSave, busy, demo }: { product: Product; state: Dashboard; onSave: (action: Record<string, unknown>) => Promise<boolean>; busy: boolean; demo: boolean }) {
  const [materialId, setMaterialId] = React.useState(state.materials[0]?.id ?? "");
  const [quantity, setQuantity] = React.useState("1");
  const components = state.components.filter((item) => item.productId === product.id);
  return <Card><CardHeader><CardTitle>Composición</CardTitle><CardDescription>Un mismo insumo puede estar en varios productos con cantidades distintas.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Insumo</TableHead><TableHead>Consumo por lote</TableHead><TableHead className="text-right">Acción</TableHead></TableRow></TableHeader><TableBody>{components.map((item) => { const material = state.materials.find((entry) => entry.id === item.materialId); return <TableRow key={item.materialId}><TableCell>{material?.name ?? "Insumo no encontrado"}</TableCell><TableCell>{item.quantityMilli / 1000} {material?.purchaseUnit}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" disabled={busy || demo} onClick={() => void onSave({ action: "set-component", productId: product.id, materialId: item.materialId, quantityMilli: 0 })}>Quitar</Button></TableCell></TableRow>; })}</TableBody></Table></CardContent><CardFooter className="flex flex-wrap gap-2"><NativeSelect value={materialId} onChange={(event) => setMaterialId(event.target.value)} aria-label="Insumo para agregar"><NativeSelectOption value="">Seleccionar insumo</NativeSelectOption>{state.materials.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect><Input className="w-28" type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} aria-label="Cantidad por lote" /><Button variant="outline" disabled={!materialId || busy || demo} onClick={() => void onSave({ action: "set-component", productId: product.id, materialId, quantityMilli: Math.round(Number(quantity) * 1000) })}>Guardar consumo</Button></CardFooter></Card>;
}
