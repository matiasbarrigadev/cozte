"use client";

import { BUSINESS_MODE_LABELS, MODULES, type JourneyView, type ModuleAccess, type ModuleKey, type StageView } from "@/lib/journey";
import { AnimatedIcon } from "@/components/animated-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Tells the server a stage was started (for the path's metrics); never blocks the conversation. */
export function noteStageStarted(stageId: string) {
  void fetch("/api/journey/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageId }) }).catch(() => undefined);
}

/**
 * The discovery path: each stage with its state and why it matters, the current one ready to start with Cozte, and
 * the numbers it leads to. A stage is done when the company's data says so, never because Cozte said it.
 */
export function JourneyCard({ journey, demo = false, compact = false, onStart, onFinale }: { journey: JourneyView; demo?: boolean; compact?: boolean; onStart: (stage: StageView) => void; onFinale: (prompt: string) => void }) {
  const next = journey.current;
  return <section aria-label="Tu recorrido" className={cn("flex w-full flex-col gap-4 rounded-2xl border bg-card p-4 text-left shadow-xs md:p-5", compact && "max-w-2xl")}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tu recorrido · {BUSINESS_MODE_LABELS[journey.mode]}</p>
        <h2 className="text-lg font-semibold tracking-tight">{next ? `${journey.completed} de ${journey.total}: sigue «${next.title}»` : journey.finale.title}</h2>
        <p className="text-sm text-muted-foreground">{next ? next.why : journey.finale.why}</p>
      </div>
      {next ? <Button type="button" disabled={demo} onClick={() => onStart(next)}><AnimatedIcon name="sparkles" data-icon="inline-start" />{journey.completed ? "Seguir" : "Empezar"}</Button>
        : <Button type="button" disabled={demo} onClick={() => onFinale(journey.finale.prompt)}><AnimatedIcon name="sparkles" data-icon="inline-start" />Ver mis números</Button>}
    </div>
    <div className="flex gap-1" role="progressbar" aria-label="Avance del recorrido" aria-valuemin={0} aria-valuemax={journey.total} aria-valuenow={journey.completed}>
      {journey.stages.map((stage) => <span key={stage.id} className={cn("h-1.5 flex-1 rounded-full", stage.status === "done" ? "bg-primary" : stage.status === "current" ? "bg-primary/35" : "bg-muted")} />)}
    </div>
    <ol className={cn("grid gap-2", !compact && "md:grid-cols-2")}>
      {journey.stages.map((stage, index) => <li key={stage.id} className={cn("flex items-start gap-3 rounded-lg border p-3", stage.status === "current" && "border-primary/40 bg-accent/30")}>
        <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", stage.status === "done" ? "bg-primary text-primary-foreground" : "border")} aria-hidden="true">
          {stage.status === "done" ? <AnimatedIcon name="check" size={14} /> : index + 1}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-medium">{stage.title}<span className="sr-only">{stage.status === "done" ? " (completa)" : stage.status === "current" ? " (en curso)" : " (pendiente)"}</span></p>
          <p className="text-xs text-muted-foreground">{stage.status === "done" && stage.lesson ? `Concepto: ${stage.lesson.title}. ${stage.lesson.text}` : stage.why}</p>
          {stage.status !== "done" && stage.missing.length ? <p className="text-xs text-muted-foreground">Falta: {stage.missing.join(" · ").toLocaleLowerCase("es")}</p> : null}
          {stage.unlocks.length ? <p className="flex flex-wrap gap-1 pt-0.5">{stage.unlocks.map((module) => <Badge key={module} variant={stage.status === "done" ? "secondary" : "outline"} className="text-[11px] font-normal">{stage.status === "done" ? "" : "Abre "}{MODULES[module].label}</Badge>)}</p> : null}
          {stage.status === "pending" ? <Button type="button" size="sm" variant="ghost" className="mt-0.5 h-7 w-fit px-2 text-xs" disabled={demo} onClick={() => onStart(stage)}>Hacerlo ahora →</Button> : null}
        </div>
      </li>)}
      <li className="flex items-start gap-3 rounded-lg border border-dashed p-3">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-muted-foreground" aria-hidden="true"><AnimatedIcon name="chart" size={13} /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-medium">Al final: {journey.finale.title}</p>
          <p className="text-xs text-muted-foreground">{journey.finale.why}</p>
        </div>
      </li>
    </ol>
  </section>;
}

/** A section the path has not opened yet: what it will show, what opens it, and a way to get there with Cozte. */
export function LockedModule({ module, access, journey, onStart, onExplore }: { module: ModuleKey; access: ModuleAccess; journey: JourneyView; onStart: (stage: StageView) => void; onExplore: () => void }) {
  const stage = journey.stages.find((item) => item.id === access.stageId);
  return <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border border-dashed bg-card p-8 text-center" aria-label={`${MODULES[module].label}, todavía cerrada`}>
    <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><AnimatedIcon name="lock" size={22} /></span>
    <div className="flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{MODULES[module].label}</h1>
      <p className="text-sm text-muted-foreground">{MODULES[module].what}</p>
    </div>
    <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">{access.reason}{stage ? `: ${stage.why}` : "."}</p>
    <div className="flex flex-wrap justify-center gap-2">
      {stage ? <Button type="button" onClick={() => onStart(stage)}><AnimatedIcon name="sparkles" data-icon="inline-start" />Resolverlo con Cozte</Button> : null}
      <Button type="button" variant="ghost" onClick={onExplore}>Ver igual</Button>
    </div>
  </section>;
}
