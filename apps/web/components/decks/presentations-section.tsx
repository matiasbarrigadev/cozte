"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  CHART_KINDS, CHART_KIND_KEYS, DECK_TEMPLATES, DECK_TEMPLATE_KEYS, DECK_THEMES, DECK_THEME_KEYS, LIMITS, METRICS, METRIC_KEYS, SLIDE_LAYOUTS, SLIDE_LAYOUT_KEYS, monthLabel,
  type ChartKind, type DeckOperation, type DeckTemplate, type DeckTheme, type MetricKey, type Presentation, type PresentationSummary, type Slide, type SlideChanges, type SlideInput, type SlideLayout,
} from "@/lib/decks";
import type { DomainState } from "@/lib/domain";
import { DEMO_MONTH } from "@/lib/demo";
import { CHART_GUIDE, COLOR_MEANING, DECK_CHECKLIST, DECK_STRUCTURE, LAYOUT_GUIDE, THEME_GUIDE, WRITING_GUIDE, chartLabel } from "@/lib/deck-design";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dropdown, DropdownOption, DropdownGroup } from "@/components/ui/dropdown";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { AnimatedIcon } from "@/components/animated-icon";
import { MonthPicker, SectionHeader } from "@/components/business/business-ui";
import { cn } from "@/lib/utils";
import { ScaledSlide } from "./deck-slide";
import { DeckPlayer } from "./deck-player";
import { PresentationRequestError, createDemoPresentations, serverPresentations, type PresentationsApi } from "./presentations-api";

type Props = {
  state: DomainState;
  demo: boolean;
  presentationId: string | null;
  onOpen: (id: string | null) => void;
  onAskCozte: (text: string) => void;
};

let demoApi: PresentationsApi | null = null;
function usePresentationsApi(demo: boolean): PresentationsApi {
  return React.useMemo(() => demo ? (demoApi ??= createDemoPresentations()) : serverPresentations, [demo]);
}

function failure(error: unknown, fallback: string) {
  const message = error instanceof PresentationRequestError ? error.message : fallback;
  toast.error(message, error instanceof PresentationRequestError && error.options.length ? { description: `Opciones: ${error.options.slice(0, 6).join(", ")}` } : undefined);
}

/** Visual reports built from the business's data: create them from a template or with Cozte, edit, present and share. */
export function PresentationsSection(props: Props) {
  const api = usePresentationsApi(props.demo);
  return props.presentationId
    ? <PresentationEditor key={props.presentationId} {...props} id={props.presentationId} api={api} />
    : <PresentationList {...props} api={api} />;
}

function PresentationList({ demo, onOpen, onAskCozte, api }: Props & { api: PresentationsApi }) {
  const [items, setItems] = React.useState<PresentationSummary[] | null>(null);
  const [month, setMonth] = React.useState(demo ? DEMO_MONTH : new Date().toISOString().slice(0, 7));
  const [creating, setCreating] = React.useState<DeckTemplate | null>(null);
  const [idea, setIdea] = React.useState("");
  React.useEffect(() => {
    let active = true;
    api.list().then((list) => { if (active) setItems(list); }).catch((error) => { if (active) { setItems([]); failure(error, "No se pudieron cargar las presentaciones"); } });
    return () => { active = false; };
  }, [api]);
  async function create(template: DeckTemplate) {
    setCreating(template);
    try { const created = await api.create({ template, month }); onOpen(created.id); }
    catch (error) { failure(error, "No se pudo crear la presentación"); }
    finally { setCreating(null); }
  }
  return <div className="flex flex-col gap-6">
    <SectionHeader eyebrow="Informes" title="Presentaciones" description="Informes visuales con tus números reales, listos para presentar o compartir con un link. Cada gráfico sale del motor de Cozte, nunca de un número inventado." />

    <Card>
      <CardHeader>
        <CardTitle>Crear una presentación</CardTitle>
        <CardDescription>Elige un tema y se arma al instante con tus datos. Después puedes editarla tú o pedirle cambios a Cozte.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <MonthPicker month={month} onChange={setMonth} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {DECK_TEMPLATE_KEYS.map((key) => <button key={key} type="button" disabled={creating !== null} onClick={() => void create(key)}
            className="group flex flex-col gap-1.5 rounded-xl border bg-card p-4 text-left transition hover:border-foreground/40 hover:shadow-sm disabled:opacity-60">
            <span className="flex items-center justify-between gap-2 font-semibold">{DECK_TEMPLATES[key].label}{creating === key ? <span className="text-xs font-normal text-muted-foreground">Creando…</span> : <AnimatedIcon name="arrowRight" size={16} className="opacity-0 transition group-hover:opacity-100" />}</span>
            <span className="text-xs text-muted-foreground">{DECK_TEMPLATES[key].hint}</span>
          </button>)}
        </div>
        <form className="flex flex-col gap-2 rounded-xl bg-muted/60 p-4" onSubmit={(event) => { event.preventDefault(); if (idea.trim()) onAskCozte(`Armame una presentación sobre: ${idea.trim()}`); }}>
          <label htmlFor="deck-idea" className="text-sm font-medium">O pídesela a Cozte con tus palabras</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="deck-idea" value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="Ej: cómo nos fue en ventas este mes, para mostrarle a mi socio" disabled={demo} />
            <Button type="submit" disabled={!idea.trim() || demo}><AnimatedIcon name="sparkles" data-icon="inline-start" />Pedir a Cozte</Button>
          </div>
          {demo ? <span className="text-xs text-muted-foreground">En la demostración, prueba las plantillas; con tu cuenta Cozte arma presentaciones a medida.</span> : null}
        </form>
      </CardContent>
    </Card>

    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Tus presentaciones</h2>
      {items === null ? <p className="text-sm text-muted-foreground">Cargando…</p> : items.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => <button key={item.id} type="button" onClick={() => onOpen(item.id)} className="group flex flex-col overflow-hidden rounded-xl border bg-card text-left transition hover:shadow-md">
          {item.cover ? <ScaledSlide slide={item.cover} index={0} total={item.slideCount} deck={{ ...item.deck, slides: [item.cover] }} title={item.title} theme={item.theme} /> : <div className="aspect-video bg-muted" />}
          <span className="flex flex-col gap-1 p-3">
            <span className="flex items-center justify-between gap-2"><span className="truncate font-semibold">{item.title}</span>{item.shareUrl ? <Badge variant="outline">Link público</Badge> : null}</span>
            <span className="text-xs text-muted-foreground">{item.slideCount} diapositivas · {monthLabel(item.deck.month)} · editada {new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" }).format(new Date(item.updatedAt.replace(" ", "T") + (item.updatedAt.endsWith("Z") ? "" : "Z")))}</span>
          </span>
        </button>)}
      </div> : <Empty className="border"><EmptyHeader><EmptyTitle>Todavía no hay presentaciones</EmptyTitle><EmptyDescription>Elige un tema arriba o pídele una a Cozte en el chat: «Armame un informe de ventas del mes».</EmptyDescription></EmptyHeader></Empty>}
    </section>
  </div>;
}

/** Default content for a new slide of each kind, so it looks right the moment it is added. */
function starterSlide(choice: string, state: DomainState): SlideInput | null {
  const [kind, value] = choice.split(":");
  if (kind === "chart") {
    const chart = value as ChartKind;
    return { title: CHART_KINDS[chart].label, chart, ...(CHART_KINDS[chart].needsProduct && state.products[0] ? { product: state.products[0].id } : {}) };
  }
  switch (value as SlideLayout) {
    case "bullets": return { layout: "bullets", title: "Nueva diapositiva", bullets: ["Primer punto", "Segundo punto"] };
    case "kpis": return { layout: "kpis", title: "El mes en cifras", metrics: ["revenue", "result"] };
    case "comparison": return { layout: "comparison", title: "Comparación", left: { title: "Fortalezas", bullets: ["…"] }, right: { title: "A mejorar", bullets: ["…"] } };
    case "section": return { layout: "section", title: "Un mensaje clave" };
    case "closing": return { layout: "closing", title: "Próximos pasos", bullets: ["Primer paso"] };
    case "cover": return { layout: "cover", title: "Portada" };
    default: return null;
  }
}

function PresentationEditor({ id, state, demo, onOpen, onAskCozte, api }: Props & { id: string; api: PresentationsApi }) {
  const [presentation, setPresentation] = React.useState<Presentation | null>(null);
  const [selected, setSelected] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [presenting, setPresenting] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [guideOpen, setGuideOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [request, setRequest] = React.useState("");

  const leave = React.useEffectEvent(() => onOpen(null));
  React.useEffect(() => {
    let active = true;
    api.get(id).then((loaded) => { if (active) { setPresentation(loaded); setTitle(loaded.title); } })
      .catch((error) => { if (active) { failure(error, "No se pudo abrir la presentación"); leave(); } });
    return () => { active = false; };
  }, [api, id]);

  async function run(work: () => Promise<{ presentation: Presentation; done: string[] }>, success?: (done: string[]) => string | null) {
    setBusy(true);
    try {
      const result = await work();
      setPresentation(result.presentation);
      setTitle(result.presentation.title);
      setSelected((current) => Math.min(current, result.presentation.deck.slides.length - 1));
      const message = success ? success(result.done) : result.done[0];
      if (message) toast.success(message);
      return result;
    } catch (error) { failure(error, "No se pudo guardar el cambio"); return null; }
    finally { setBusy(false); }
  }
  const edit = (operations: DeckOperation[], message?: string) => run(() => api.update(id, operations), (done) => message ?? done.join(" · "));

  if (!presentation) return <p className="text-sm text-muted-foreground">Abriendo la presentación…</p>;
  const slides = presentation.deck.slides;
  const slide = slides[Math.min(selected, slides.length - 1)];
  const number = Math.min(selected, slides.length - 1) + 1;
  const common = { deck: presentation.deck, title: presentation.title, theme: presentation.theme, total: slides.length };

  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" onClick={() => onOpen(null)}><AnimatedIcon name="arrowLeft" data-icon="inline-start" />Presentaciones</Button>
      <Input aria-label="Título de la presentación" value={title} maxLength={LIMITS.title} onChange={(event) => setTitle(event.target.value)}
        onBlur={() => { if (title.trim() && title.trim() !== presentation.title) void edit([{ action: "settings", title: title.trim() }], "Título actualizado"); else setTitle(presentation.title); }}
        className="h-9 min-w-48 flex-1 text-base font-semibold" />
      <Dropdown aria-label="Estilo" value={presentation.theme} disabled={busy} onChange={(event) => void edit([{ action: "settings", theme: event.target.value as DeckTheme }])}>
        {DECK_THEME_KEYS.map((key) => <DropdownOption key={key} value={key}>Estilo: {DECK_THEMES[key].label}</DropdownOption>)}
      </Dropdown>
      <MonthPicker month={presentation.deck.month} onChange={(month) => { if (month !== presentation.deck.month) void edit([{ action: "settings", month }]); }} />
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={() => setPresenting(true)}><AnimatedIcon name="panel" data-icon="inline-start" />Presentar</Button>
      <Button variant="outline" onClick={() => setShareOpen(true)}><AnimatedIcon name="arrowUpRight" data-icon="inline-start" />Compartir{presentation.shareUrl ? <Badge variant="secondary" className="ml-1">Público</Badge> : null}</Button>
      <Button variant="outline" disabled={busy} onClick={() => void run(() => api.action(id, "undo"))}><AnimatedIcon name="history" data-icon="inline-start" />Deshacer</Button>
      <Button variant="outline" disabled={busy} onClick={() => void edit([{ action: "refresh" }])}><AnimatedIcon name="refresh" data-icon="inline-start" />Actualizar datos</Button>
      <Button variant="ghost" onClick={() => setGuideOpen(true)}><AnimatedIcon name="sparkles" data-icon="inline-start" />Guía de diseño</Button>
      <Button variant="ghost" className="ml-auto text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}><AnimatedIcon name="delete" data-icon="inline-start" />Eliminar</Button>
    </div>
    <p className="text-xs text-muted-foreground">Cifras calculadas el {new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(presentation.deck.dataAt))}. «Actualizar datos» las recalcula con lo cargado hoy.</p>

    <div className="grid gap-4 lg:grid-cols-[11rem_minmax(0,1fr)_22rem]">
      <ol className="flex gap-2 overflow-x-auto pb-1 lg:max-h-[calc(100dvh-16rem)] lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pb-0" aria-label="Diapositivas">
        {slides.map((item, index) => <li key={item.id} className="w-36 shrink-0 lg:w-full">
          <button type="button" onClick={() => setSelected(index)} aria-current={index === number - 1} className={cn("flex w-full flex-col gap-1 rounded-lg p-1 text-left ring-2 transition", index === number - 1 ? "ring-primary" : "ring-transparent hover:ring-border")}>
            <span className="overflow-hidden rounded-md border"><ScaledSlide slide={item} index={index} {...common} /></span>
            <span className="truncate px-0.5 text-[11px] text-muted-foreground">{index + 1}. {item.title}</span>
          </button>
        </li>)}
      </ol>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="overflow-hidden rounded-xl border shadow-sm"><ScaledSlide slide={slide} index={number - 1} {...common} /></div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Diapositiva {number} de {slides.length}</span>
          <Button size="sm" variant="outline" disabled={busy || number === 1} onClick={() => { void edit([{ action: "move", slide: number, to: number - 1 }], "Movida"); setSelected(number - 2); }}>Subir</Button>
          <Button size="sm" variant="outline" disabled={busy || number === slides.length} onClick={() => { void edit([{ action: "move", slide: number, to: number + 1 }], "Movida"); setSelected(number); }}>Bajar</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => { void edit([{ action: "duplicate", slide: number }]); setSelected(number); }}>Duplicar</Button>
          <Button size="sm" variant="outline" disabled={busy || slides.length === 1} onClick={() => void edit([{ action: "remove", slide: number }])}>Quitar</Button>
          <Dropdown aria-label="Agregar diapositiva" className="ml-auto" value="" disabled={busy} onChange={(event) => {
            const input = starterSlide(event.target.value, state);
            if (input) { void edit([{ action: "add", slide: input, position: number + 1 }]).then((result) => { if (result) setSelected(number); }); }
          }}>
            <DropdownOption value="">+ Agregar diapositiva…</DropdownOption>
            <DropdownGroup label="Gráficos con tus datos">{CHART_KIND_KEYS.map((key) => <DropdownOption key={key} value={`chart:${key}`}>{CHART_KINDS[key].label}</DropdownOption>)}</DropdownGroup>
            <DropdownGroup label="Otros diseños">{(["kpis", "bullets", "comparison", "section", "closing"] as SlideLayout[]).map((key) => <DropdownOption key={key} value={`layout:${key}`}>{SLIDE_LAYOUTS[key].label}</DropdownOption>)}</DropdownGroup>
          </Dropdown>
        </div>
        {slide.notes ? <p className="rounded-lg bg-muted px-3 py-2 text-sm"><span className="font-medium">Notas para presentar: </span>{slide.notes}</p> : null}
      </div>

      <div className="flex flex-col gap-4">
        <Card className="gap-3">
          <CardHeader><CardTitle className="text-base">Pedile cambios a Cozte</CardTitle><CardDescription>Cozte ve la presentación y la edita por ti: textos, gráficos, orden, estilo.</CardDescription></CardHeader>
          <CardContent>
            <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); if (request.trim()) onAskCozte(`En la presentación «${presentation.title}» (estoy en la diapositiva ${number}): ${request.trim()}`); }}>
              <Textarea value={request} onChange={(event) => setRequest(event.target.value)} rows={3} placeholder="Ej: explica esta diapositiva más simple, agrega una con el punto de equilibrio y cierra con 3 próximos pasos" disabled={demo} />
              <Button type="submit" disabled={!request.trim() || demo}><AnimatedIcon name="sparkles" data-icon="inline-start" />Enviar a Cozte</Button>
              {demo ? <span className="text-xs text-muted-foreground">Disponible con tu cuenta.</span> : null}
            </form>
          </CardContent>
        </Card>
        <SlideForm key={`${slide.id}-${presentation.revision}`} slide={slide} state={state} busy={busy} onSave={(set) => void edit([{ action: "update", slide: number, set }], "Diapositiva guardada")} />
      </div>
    </div>

    {presenting ? <DeckPlayer presentation={presentation} initialIndex={number - 1} onClose={() => setPresenting(false)} showNotes /> : null}
    <ShareDialog open={shareOpen} onOpenChange={setShareOpen} presentation={presentation} busy={busy} demo={demo} onToggle={(share) => void run(() => api.action(id, share ? "share" : "unshare"), () => share ? "Link público activado" : "Link desactivado: ya no funciona")} />
    <DesignGuide open={guideOpen} onOpenChange={setGuideOpen} />
    <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}><DialogContent>
      <DialogHeader><DialogTitle>¿Eliminar «{presentation.title}»?</DialogTitle><DialogDescription>Deja de aparecer en tu lista y su link público deja de funcionar.</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancelar</Button><Button variant="destructive" disabled={busy} onClick={async () => { try { await api.remove(id); toast.success("Presentación eliminada"); onOpen(null); } catch (error) { failure(error, "No se pudo eliminar"); } }}>Eliminar</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}

const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

/** Edits one slide: every field the slide's design uses; charts and figures are chosen, never typed. */
function SlideForm({ slide, state, busy, onSave }: { slide: Slide; state: DomainState; busy: boolean; onSave: (set: SlideChanges) => void }) {
  const [layout, setLayout] = React.useState<SlideLayout>(slide.layout);
  const [title, setTitle] = React.useState(slide.title);
  const [subtitle, setSubtitle] = React.useState(slide.subtitle ?? "");
  const [text, setText] = React.useState(slide.text ?? "");
  const [bullets, setBullets] = React.useState((slide.bullets ?? []).join("\n"));
  const [left, setLeft] = React.useState({ title: slide.left?.title ?? "Antes", bullets: (slide.left?.bullets ?? []).join("\n") });
  const [right, setRight] = React.useState({ title: slide.right?.title ?? "Después", bullets: (slide.right?.bullets ?? []).join("\n") });
  const [chart, setChart] = React.useState<ChartKind>(slide.chart?.kind ?? "unit-cost");
  const [metrics, setMetrics] = React.useState<MetricKey[]>(slide.kpis?.map((kpi) => kpi.metric) ?? ["revenue", "result"]);
  const [product, setProduct] = React.useState(slide.chart?.productId ?? slide.kpis?.find((kpi) => kpi.productId)?.productId ?? "");
  const [month, setMonth] = React.useState(slide.chart?.month ?? slide.kpis?.find((kpi) => kpi.month)?.month ?? "");
  const [notes, setNotes] = React.useState(slide.notes ?? "");
  const usesProduct = (layout === "chart" && (CHART_KINDS[chart].needsProduct || chart === "channels")) || (layout === "kpis" && metrics.some((metric) => METRICS[metric].perProduct));
  const usesMonth = (layout === "chart" && CHART_KINDS[chart].usesMonth) || (layout === "kpis" && metrics.some((metric) => METRICS[metric].usesMonth));
  const showBullets = ["bullets", "closing", "chart"].includes(layout);
  const save = () => onSave({
    layout, title: title.trim() || slide.title, subtitle, text, notes,
    bullets: showBullets ? lines(bullets) : [],
    ...(layout === "comparison" ? { left: { title: left.title.trim() || "Antes", bullets: lines(left.bullets) }, right: { title: right.title.trim() || "Después", bullets: lines(right.bullets) } } : {}),
    chart: layout === "chart" ? chart : null,
    metrics: layout === "kpis" ? metrics : null,
    product: usesProduct ? product : "",
    month: usesMonth ? month : "",
  });
  return <Card className="gap-3">
    <CardHeader><CardTitle className="text-base">Editar esta diapositiva</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-3 text-sm">
      <Field label="Diseño"><Dropdown className="w-full" value={layout} onChange={(event) => setLayout(event.target.value as SlideLayout)}>{SLIDE_LAYOUT_KEYS.map((key) => <DropdownOption key={key} value={key}>{SLIDE_LAYOUTS[key].label}</DropdownOption>)}</Dropdown></Field>
      <Field label="Título"><Input value={title} maxLength={LIMITS.title} onChange={(event) => setTitle(event.target.value)} /></Field>
      <Field label="Subtítulo"><Input value={subtitle} maxLength={LIMITS.subtitle} onChange={(event) => setSubtitle(event.target.value)} /></Field>
      {layout === "chart" ? <Field label="Gráfico"><Dropdown className="w-full" value={chart} onChange={(event) => setChart(event.target.value as ChartKind)}>{CHART_KIND_KEYS.map((key) => <DropdownOption key={key} value={key}>{CHART_KINDS[key].label}</DropdownOption>)}</Dropdown></Field> : null}
      {layout === "kpis" ? <fieldset className="flex flex-col gap-1.5"><legend className="mb-1 font-medium">Cifras (hasta 4)</legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1">{METRIC_KEYS.map((key) => <label key={key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={metrics.includes(key)} disabled={!metrics.includes(key) && metrics.length >= LIMITS.metrics} onChange={(event) => setMetrics((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))} />{METRICS[key].label}</label>)}</div>
      </fieldset> : null}
      {usesProduct ? <Field label="Producto"><Dropdown className="w-full" value={product} onChange={(event) => setProduct(event.target.value)}>{chart === "channels" && layout === "chart" ? <DropdownOption value="">Todos</DropdownOption> : null}{state.products.map((item) => <DropdownOption key={item.id} value={item.id}>{item.name}</DropdownOption>)}</Dropdown></Field> : null}
      {usesMonth ? <Field label="Mes (vacío = el de la presentación)"><Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Field> : null}
      {layout !== "comparison" ? <Field label={layout === "chart" ? "Conclusión (vacío = la automática)" : "Texto"}><Textarea rows={3} value={text} maxLength={LIMITS.text} onChange={(event) => setText(event.target.value)} /></Field> : null}
      {showBullets ? <Field label="Puntos (uno por línea)"><Textarea rows={4} value={bullets} onChange={(event) => setBullets(event.target.value)} /></Field> : null}
      {layout === "comparison" ? <>{[["Columna izquierda", left, setLeft], ["Columna derecha", right, setRight]].map(([label, column, setColumn]) => {
        const value = column as typeof left; const set = setColumn as typeof setLeft;
        return <fieldset key={label as string} className="flex flex-col gap-1.5"><legend className="mb-1 font-medium">{label as string}</legend><Input value={value.title} onChange={(event) => set({ ...value, title: event.target.value })} aria-label={`${label} título`} /><Textarea rows={3} value={value.bullets} onChange={(event) => set({ ...value, bullets: event.target.value })} aria-label={`${label} puntos`} /></fieldset>;
      })}</> : null}
      <Field label="Notas para presentar (no se ven en la diapositiva)"><Textarea rows={2} value={notes} maxLength={LIMITS.notes} onChange={(event) => setNotes(event.target.value)} /></Field>
      <Button disabled={busy} onClick={save}>Guardar diapositiva</Button>
    </CardContent>
  </Card>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5"><span className="font-medium">{label}</span>{children}</label>;
}

function ShareDialog({ open, onOpenChange, presentation, busy, demo, onToggle }: { open: boolean; onOpenChange: (open: boolean) => void; presentation: Presentation; busy: boolean; demo: boolean; onToggle: (share: boolean) => void }) {
  const url = presentation.shareUrl;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader>
      <DialogTitle>Compartir «{presentation.title}»</DialogTitle>
      <DialogDescription>Con el link público cualquiera puede verla, sin cuenta. Se ve tal como está guardada, sin tus notas para presentar ni el resto de los datos de tu empresa.</DialogDescription>
    </DialogHeader>
    {url ? <div className="flex flex-col gap-2">
      <div className="flex gap-2"><Input readOnly value={url} aria-label="Link público" onFocus={(event) => event.target.select()} />
        <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(url).then(() => toast.success("Link copiado")).catch(() => toast.error("No se pudo copiar; selecciónalo y cópialo")); }}>Copiar</Button></div>
      <a href={url} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-4">Abrir en una pestaña nueva</a>
      <p className="text-xs text-muted-foreground">Los cambios que hagas se ven en el mismo link. Si lo desactivas, deja de funcionar; al activarlo de nuevo se crea uno distinto.</p>
    </div> : <p className="text-sm text-muted-foreground">{demo ? "En la demostración no se crean links públicos." : "Ahora solo la ve tu equipo dentro de Cozte."}</p>}
    <DialogFooter>
      {url ? <Button variant="outline" disabled={busy} onClick={() => onToggle(false)}>Desactivar link</Button> : <Button disabled={busy || demo} onClick={() => onToggle(true)}>Crear link público</Button>}
    </DialogFooter>
  </DialogContent></Dialog>;
}

/** The same design system Cozte follows, so the person can design a deck the same way. */
function DesignGuide({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const section = (title: string, items: React.ReactNode[]) => <section className="flex flex-col gap-1.5"><h3 className="text-sm font-semibold">{title}</h3><ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">{items.map((item, index) => <li key={index}>{item}</li>)}</ul></section>;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>Guía de diseño</DialogTitle><DialogDescription>Cómo arma Cozte una buena presentación. Úsala para editar la tuya o para pedirle cambios.</DialogDescription></DialogHeader>
    <div className="flex flex-col gap-5">
      {section("La estructura", DECK_STRUCTURE)}
      {section("Cada diseño y cuándo usarlo", SLIDE_LAYOUT_KEYS.map((key) => <><span className="font-medium text-foreground">{SLIDE_LAYOUTS[key].label}:</span> {LAYOUT_GUIDE[key].use} {LAYOUT_GUIDE[key].budget}</>))}
      {section("Qué gráfico responde cada pregunta", CHART_GUIDE.map((item) => <>{item.question} <span className="font-medium text-foreground">{item.charts.map(chartLabel).join(" o ")}</span></>))}
      {section("Estilos", DECK_THEME_KEYS.map((key) => <><span className="font-medium text-foreground">{DECK_THEMES[key].label}:</span> {THEME_GUIDE[key]}</>))}
      {section("Colores con significado", COLOR_MEANING.slice(0, 3))}
      {section("Cómo escribir", WRITING_GUIDE)}
      {section("Antes de presentar, revisa", DECK_CHECKLIST)}
    </div>
  </DialogContent></Dialog>;
}
