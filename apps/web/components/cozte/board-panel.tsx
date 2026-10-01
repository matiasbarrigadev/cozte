"use client";

import * as React from "react";
import { toast } from "sonner";
import { METRICS, METRIC_KEYS, monthLabel, type MetricKey } from "@/lib/decks";
import { DEFAULT_KPI_METRICS, MAX_BOARD_WIDGETS, WIDGETS, WIDGET_GROUPS, moveWidget, pinWidget, widgetKey, type BoardWidget, type WidgetKind, type WidgetSpec } from "@/lib/cozte-widgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MonthSelect } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { AnimatedIcon } from "@/components/animated-icon";
import { cn } from "@/lib/utils";
import { CozteVisual, useAvailableVisuals, useVisualData, type WidgetChoice } from "./cozte-visuals";

/** Figures grouped the way a person looks for them. */
const METRIC_GROUPS: { label: string; metrics: MetricKey[] }[] = [
  { label: "El mes", metrics: METRIC_KEYS.filter((key) => METRICS[key].usesMonth) },
  { label: "La producción", metrics: ["products", "monthly-units"] },
  { label: "Un producto", metrics: METRIC_KEYS.filter((key) => METRICS[key].perProduct) },
];

/** Widgets suggested on an empty board, in order, when they have data. */
const STARTERS: WidgetKind[] = ["month", "sales-by-channel", "unit-cost", "channels", "kpis", "cost-breakdown"];

/**
 * The board next to the chat: widgets pinned by the person or by Cozte, always with live data. Each one can be
 * enlarged, reordered, removed or sent to Cozte as a question; new ones come from a catalog with a live preview.
 */
export function BoardPanel({ board, onChange, onAsk, prepend }: { board: BoardWidget[]; onChange: (next: BoardWidget[]) => void; onAsk?: (text: string) => void; /** Shown above the widgets (the path's progress). */ prepend?: React.ReactNode }) {
  const [galleryOpen, setGalleryOpen] = React.useState(false);
  const choices = useAvailableVisuals();
  const starters = STARTERS.map((kind) => choices.find((choice) => choice.kind === kind)).filter((choice): choice is WidgetChoice => Boolean(choice?.available)).slice(0, 4);
  const add = (widget: WidgetSpec) => {
    const full = board.length >= MAX_BOARD_WIDGETS && !board.some((item) => widgetKey(item) === widgetKey(widget));
    onChange(pinWidget(board, widget));
    toast.success(full ? `Quedó fijo; el tablero tiene hasta ${MAX_BOARD_WIDGETS} y se quitó el último` : "Quedó fijo en tu tablero");
  };
  return <Card className="flex h-[calc(100dvh-13rem)] min-h-[30rem] w-full min-w-0 flex-col gap-0 overflow-hidden py-0 lg:h-[calc(100dvh-11rem)]">
    <CardHeader className="shrink-0 gap-2 border-b px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">Tu tablero{board.length ? <Badge variant="outline">{board.length}</Badge> : null}</h2>
        <Button type="button" size="sm" variant="outline" onClick={() => setGalleryOpen(true)}><AnimatedIcon name="plus" data-icon="inline-start" size={14} />Agregar</Button>
      </div>
      <CardDescription>Lo que quieres tener a la vista, siempre al día. Agrégalo tú o pídeselo a Cozte: «fija las ventas por canal».</CardDescription>
    </CardHeader>
    <CardContent className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-4">
      {prepend}
      {board.length ? board.map((widget, index) => <CozteVisual key={widget.id} widget={widget} compact onAsk={onAsk}
        onMoveUp={index > 0 ? () => onChange(moveWidget(board, widget.id, index - 1)) : undefined}
        onMoveDown={index < board.length - 1 ? () => onChange(moveWidget(board, widget.id, index + 1)) : undefined}
        onRemove={() => onChange(board.filter((item) => item.id !== widget.id))} />)
        : <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3 text-sm">
          <p className="text-muted-foreground">Tu tablero está vacío. Empieza con uno de estos:</p>
          {starters.length ? <div className="grid gap-2">{starters.map((choice) => <button key={choice.kind} type="button" onClick={() => add({ kind: choice.kind, addedBy: "user", ...(choice.kind === "kpis" ? { metrics: DEFAULT_KPI_METRICS } : {}) })} className="flex flex-col gap-0.5 rounded-lg border bg-background px-3 py-2 text-left transition-colors hover:bg-muted">
            <span className="font-medium">{choice.label}</span><span className="text-xs text-muted-foreground">{choice.hint}</span>
          </button>)}</div> : <p className="text-xs text-muted-foreground">Cuando tengas productos cargados vas a poder fijar sus costos y ventas acá.</p>}
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setGalleryOpen(true)}>Ver todos los widgets</Button>
        </div>}
    </CardContent>
    <WidgetGallery open={galleryOpen} onOpenChange={setGalleryOpen} board={board} choices={choices} onAdd={(widget) => { add(widget); setGalleryOpen(false); }} />
  </Card>;
}

/** The catalog: widgets by topic, each with what it shows; choosing one opens its options with a live preview. */
function WidgetGallery({ open, onOpenChange, board, choices, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; board: BoardWidget[]; choices: WidgetChoice[]; onAdd: (widget: WidgetSpec) => void }) {
  const [selected, setSelected] = React.useState<WidgetKind | null>(null);
  const pinnedKinds = new Set(board.map((widget) => widget.kind));
  return <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setSelected(null); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      {selected ? <WidgetOptions kind={selected} onBack={() => setSelected(null)} onAdd={(widget) => { onAdd(widget); setSelected(null); }} /> : <>
        <DialogHeader>
          <DialogTitle>Agregar al tablero</DialogTitle>
          <DialogDescription>Elige qué quieres tener a la vista. Todos se calculan con tus datos y se actualizan solos.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {WIDGET_GROUPS.map((group) => <section key={group.id} className="flex flex-col gap-2">
            <div><h3 className="text-sm font-semibold">{group.label}</h3><p className="text-xs text-muted-foreground">{group.hint}</p></div>
            <div className="grid gap-2 sm:grid-cols-2">
              {choices.filter((choice) => choice.group === group.id).map((choice) => <button key={choice.kind} type="button" onClick={() => setSelected(choice.kind)}
                className={cn("flex flex-col gap-1 rounded-lg border bg-background p-3 text-left transition-colors hover:border-foreground/40 hover:bg-muted/50", !choice.available && "opacity-70")}>
                <span className="flex items-center justify-between gap-2 text-sm font-medium">{choice.label}
                  {pinnedKinds.has(choice.kind) ? <Badge variant="secondary" className="text-[10px]">En tu tablero</Badge> : !choice.available ? <Badge variant="outline" className="text-[10px]">{choice.reason}</Badge> : null}
                </span>
                <span className="text-xs text-muted-foreground">{choice.hint}</span>
              </button>)}
            </div>
          </section>)}
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}

function WidgetOptions({ kind, onBack, onAdd }: { kind: WidgetKind; onBack: () => void; onAdd: (widget: WidgetSpec) => void }) {
  const { state, currentMonth } = useVisualData();
  const meta = WIDGETS[kind];
  const [productId, setProductId] = React.useState<string>(meta.needsProduct ? state.products[0]?.id ?? "" : "");
  const [fixedMonth, setFixedMonth] = React.useState<string>("");
  const [metrics, setMetrics] = React.useState<MetricKey[]>(DEFAULT_KPI_METRICS);
  const [title, setTitle] = React.useState("");
  const perProduct = kind === "kpis" && metrics.some((metric) => METRICS[metric].perProduct);
  const showProduct = (meta.needsProduct || meta.productOptional || perProduct) && state.products.length > 0;
  const widget: WidgetSpec = {
    kind, addedBy: "user",
    productId: showProduct && productId ? productId : null,
    ...(meta.usesMonth && fixedMonth ? { month: fixedMonth } : {}),
    ...(kind === "kpis" ? { metrics: metrics.length ? metrics : DEFAULT_KPI_METRICS } : {}),
    ...(title.trim() ? { title: title.trim() } : {}),
  };
  return <>
    <DialogHeader>
      <DialogTitle>{meta.label}</DialogTitle>
      <DialogDescription>{meta.hint}</DialogDescription>
    </DialogHeader>
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">Vista previa con tus datos</span><CozteVisual widget={widget} compact /></div>
      <div className="flex flex-col gap-3 text-sm">
        {showProduct ? <label className="flex flex-col gap-1.5"><span className="font-medium">Producto</span>
          <Dropdown className="w-full" value={productId} onChange={(event) => setProductId(event.target.value)}>
            {meta.productOptional && !perProduct ? <DropdownOption value="">Todos los productos</DropdownOption> : null}
            {state.products.map((product) => <DropdownOption key={product.id} value={product.id}>{product.name}</DropdownOption>)}
          </Dropdown></label> : null}
        {kind === "kpis" ? <fieldset className="flex flex-col gap-2"><legend className="mb-1 font-medium">Cifras (hasta 4)</legend>
          {METRIC_GROUPS.map((group) => <div key={group.label} className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">{group.label}</span>
            {group.metrics.map((key) => <label key={key} className="flex items-center gap-2 text-xs" title={METRICS[key].hint}>
              <input type="checkbox" checked={metrics.includes(key)} disabled={!metrics.includes(key) && metrics.length >= 4} onChange={(event) => setMetrics((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))} />
              {METRICS[key].label}
            </label>)}
          </div>)}
        </fieldset> : null}
        {meta.usesMonth ? <fieldset className="flex flex-col gap-1.5"><legend className="mb-1 font-medium">Mes</legend>
          <label className="flex items-center gap-2 text-xs"><input type="radio" name="widget-month" checked={!fixedMonth} onChange={() => setFixedMonth("")} />El mes en curso (se actualiza solo)</label>
          <label className="flex items-center gap-2 text-xs"><input type="radio" name="widget-month" checked={Boolean(fixedMonth)} onChange={() => setFixedMonth(currentMonth)} />Un mes fijo</label>
          {fixedMonth ? <MonthSelect value={fixedMonth} onChange={(value) => { if (value) setFixedMonth(value); }} aria-label="Mes del widget" /> : null}
          {fixedMonth ? <span className="text-[11px] text-muted-foreground">{monthLabel(fixedMonth)}</span> : null}
        </fieldset> : null}
        <label className="flex flex-col gap-1.5"><span className="font-medium">Título (opcional)</span><Input value={title} maxLength={60} placeholder={meta.label} onChange={(event) => setTitle(event.target.value)} /></label>
      </div>
    </div>
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onBack}>Volver</Button>
      <Button type="button" onClick={() => onAdd(widget)}><AnimatedIcon name="plus" data-icon="inline-start" />Agregar al tablero</Button>
    </DialogFooter>
  </>;
}
