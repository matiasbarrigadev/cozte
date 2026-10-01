"use client";

import * as React from "react";
import { BUSINESS_MODE_LABELS, MODULES, type JourneyView, type ModuleAccess, type ModuleKey, type StageView } from "@/lib/journey";
import { AnimatedIcon } from "@/components/animated-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The discovery path, to read and explore: each stage with its state, and what it is about when opened. Nothing here
 * talks to Cozte for the person; Cozte leads the current stage in the conversation, with what was already said.
 */

function ProgressBar({ journey }: { journey: JourneyView }) {
  return <div className="flex gap-1" role="progressbar" aria-label="Avance del recorrido" aria-valuemin={0} aria-valuemax={journey.total} aria-valuenow={journey.completed}>
    {journey.stages.map((stage) => <span key={stage.id} className={cn("h-1.5 flex-1 rounded-full", stage.status === "done" ? "bg-primary" : stage.status === "current" ? "bg-primary/35" : "bg-muted")} />)}
  </div>;
}

/** One stage: its state at a glance, and when opened, why it matters, what Cozte will ask and what it opens. */
function StageItem({ stage, index, open, onToggle }: { stage: StageView; index: number; open: boolean; onToggle: () => void }) {
  return <li className={cn("rounded-lg border", stage.status === "current" && "border-primary/40 bg-accent/30")}>
    <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 p-3 text-left">
      <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", stage.status === "done" ? "bg-primary text-primary-foreground" : "border")} aria-hidden="true">
        {stage.status === "done" ? <AnimatedIcon name="check" size={14} /> : index + 1}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{stage.title}<span className="sr-only">{stage.status === "done" ? " (completa)" : stage.status === "current" ? " (en curso)" : " (pendiente)"}</span></span>
        <span className="text-xs text-muted-foreground">{stage.status === "done" ? "Completa" : stage.status === "current" ? "En curso" : "Pendiente"}{stage.unlocks.length ? ` · abre ${stage.unlocks.map((module) => MODULES[module].label).join(", ")}` : ""}</span>
      </span>
      <span className={cn("mt-1 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden="true">›</span>
    </button>
    {open ? <div className="flex flex-col gap-2 border-t px-3 py-3 text-xs">
      <p>{stage.why}</p>
      {stage.status === "done" && stage.lesson ? <p className="rounded-md bg-muted/60 px-2 py-1.5"><span className="font-medium">Aprendiste: {stage.lesson.title}.</span> {stage.lesson.text}</p> : null}
      {stage.status !== "done" ? <div className="flex flex-col gap-1">
        <p className="font-medium">Lo que vas a ver con Cozte</p>
        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">{stage.interview.map((item) => <li key={item}>{item}</li>)}</ul>
      </div> : null}
      {stage.status !== "done" && stage.missing.length ? <p className="text-muted-foreground">Para completarla falta: {stage.missing.join(" · ").toLocaleLowerCase("es")}.</p> : null}
    </div> : null}
  </li>;
}

export function JourneyStages({ journey }: { journey: JourneyView }) {
  const [open, setOpen] = React.useState<string | null>(journey.current?.id ?? null);
  return <ol className="flex flex-col gap-2">
    {journey.stages.map((stage, index) => <StageItem key={stage.id} stage={stage} index={index} open={open === stage.id} onToggle={() => setOpen((current) => current === stage.id ? null : stage.id)} />)}
    <li className="flex items-start gap-3 rounded-lg border border-dashed p-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-muted-foreground" aria-hidden="true"><AnimatedIcon name="chart" size={13} /></span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="text-sm font-medium">Al final: {journey.finale.title}</span><span className="text-xs text-muted-foreground">{journey.finale.why}</span></span>
    </li>
  </ol>;
}

/** The sections already open and those still waiting, with what opens each one. */
export function JourneyModules({ journey }: { journey: JourneyView }) {
  const entries = (Object.keys(journey.modules) as ModuleKey[]).filter((module) => module !== "asistente" && module !== "dashboard");
  const waiting = entries.filter((module) => journey.modules[module].state === "locked" || journey.modules[module].badge);
  const open = entries.filter((module) => !waiting.includes(module));
  return <div className="flex flex-col gap-2 text-xs">
    {waiting.length ? <div className="flex flex-col gap-1.5">
      <p className="font-medium">Por abrir</p>
      <ul className="flex flex-col gap-1">{waiting.map((module) => <li key={module} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5">
        <span className="flex items-center gap-1.5"><AnimatedIcon name="lock" size={12} className="shrink-0 text-muted-foreground" />{MODULES[module].label}</span>
        <span className="truncate text-right text-muted-foreground">{(journey.modules[module].reason ?? journey.modules[module].badge ?? "").replace(/^Se habilita /, "").replace(/^Falta: /, "")}</span>
      </li>)}</ul>
    </div> : null}
    {open.length ? <div className="flex flex-col gap-1.5">
      <p className="font-medium">Abiertas</p>
      <p className="flex flex-wrap gap-1">{open.map((module) => <Badge key={module} variant="secondary" className="font-normal">{MODULES[module].label}</Badge>)}</p>
    </div> : null}
  </div>;
}

/** Instead of the board, until the first stage is complete: the whole path and the sections it will open. */
export function JourneyPanel({ journey }: { journey: JourneyView }) {
  return <Card className="flex h-[calc(100dvh-13rem)] min-h-[30rem] w-full min-w-0 flex-col gap-0 overflow-hidden py-0 lg:h-[calc(100dvh-11rem)]">
    <CardHeader className="shrink-0 gap-2 border-b px-4 py-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tu recorrido · {BUSINESS_MODE_LABELS[journey.mode]}</p>
      <h2 className="text-base font-semibold">{journey.completed} de {journey.total} etapas{journey.current ? ` · ahora: ${journey.current.title}` : ""}</h2>
      <ProgressBar journey={journey} />
      <CardDescription>Cozte te guía etapa por etapa en el chat. Cuando completes la primera, acá también vas a poder fijar widgets.</CardDescription>
    </CardHeader>
    <CardContent className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
      <JourneyStages journey={journey} />
      <JourneyModules journey={journey} />
    </CardContent>
  </Card>;
}

/** On top of the board once the first stage is complete: how far the path is, and what is still to open. */
export function JourneyProgress({ journey }: { journey: JourneyView }) {
  const [expanded, setExpanded] = React.useState(false);
  const waiting = (Object.keys(journey.modules) as ModuleKey[]).filter((module) => journey.modules[module].state === "locked" || journey.modules[module].badge).length;
  return <section aria-label="Tu recorrido" className="flex flex-col gap-2 rounded-xl border bg-background p-3">
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Recorrido · {journey.completed} de {journey.total}</p>
        <p className="text-sm font-medium">{journey.current ? `Ahora: ${journey.current.title}` : journey.finale.title}</p>
        <p className="text-xs text-muted-foreground">{waiting ? `${waiting} sección${waiting === 1 ? "" : "es"} por abrir` : "Todas las secciones abiertas"}</p>
      </div>
      <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Ocultar" : "Ver etapas"}</Button>
    </div>
    <ProgressBar journey={journey} />
    {expanded ? <div className="flex flex-col gap-3 pt-1"><JourneyStages journey={journey} /><JourneyModules journey={journey} /></div> : null}
  </section>;
}

/** In Resumen: the path and its sections, with a way to the conversation (nothing is sent for the person). */
export function JourneySummary({ journey, onOpenCozte }: { journey: JourneyView; onOpenCozte: () => void }) {
  return <Card>
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tu recorrido · {BUSINESS_MODE_LABELS[journey.mode]}</p>
        <h2 className="text-lg font-semibold tracking-tight">{journey.current ? `${journey.completed} de ${journey.total}: ahora «${journey.current.title}»` : journey.finale.title}</h2>
        <CardDescription>{journey.current ? journey.current.why : journey.finale.why}</CardDescription>
      </div>
      <Button type="button" onClick={onOpenCozte}><AnimatedIcon name="assistant" data-icon="inline-start" />Ir a Cozte AI</Button>
    </CardHeader>
    <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3"><ProgressBar journey={journey} /><JourneyStages journey={journey} /></div>
      <JourneyModules journey={journey} />
    </CardContent>
  </Card>;
}

/** A section the path has not opened yet: what it will show, what opens it, and the way to Cozte. */
export function LockedModule({ module, access, journey, onOpenCozte, onExplore }: { module: ModuleKey; access: ModuleAccess; journey: JourneyView; onOpenCozte: () => void; onExplore: () => void }) {
  const stage = journey.stages.find((item) => item.id === access.stageId);
  return <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border border-dashed bg-card p-8 text-center" aria-label={`${MODULES[module].label}, todavía cerrada`}>
    <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><AnimatedIcon name="lock" size={22} /></span>
    <div className="flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{MODULES[module].label}</h1>
      <p className="text-sm text-muted-foreground">{MODULES[module].what}</p>
    </div>
    <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">{access.reason}{stage ? `: ${stage.why}` : "."}</p>
    <div className="flex flex-wrap justify-center gap-2">
      <Button type="button" onClick={onOpenCozte}><AnimatedIcon name="assistant" data-icon="inline-start" />Ir a Cozte AI</Button>
      <Button type="button" variant="ghost" onClick={onExplore}>Ver igual</Button>
    </div>
  </section>;
}
