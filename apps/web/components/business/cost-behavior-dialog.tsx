"use client";

import * as React from "react";
import { DRIVER_LABELS } from "@/lib/break-even";
import type { BehaviorGroup } from "@/lib/cost-behavior";
import type { CostBehavior, VariableDriver } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** What changes when a person decides how an expense behaves (the update-expense-behavior change, without its action). */
export type BehaviorChange = { id: string; behavior: CostBehavior; driver?: VariableDriver; variablePercent?: number; note?: string };
export type BehaviorTarget = { id: string; name: string; amount: number; behavior: CostBehavior; driver: VariableDriver | null; variablePercent: number; note: string };

const PILL_TONES: Record<BehaviorGroup, string> = {
  variable: "bg-[color-mix(in_oklab,var(--data-4)_14%,transparent)] text-[var(--data-4)]",
  fixed: "bg-muted text-muted-foreground",
  mixed: "bg-[color-mix(in_oklab,var(--data-2)_16%,transparent)] text-[var(--data-2)]",
};

/** A cost's type as a small label: a button when the person can change it, plain text otherwise (supplies). */
export function CostTypePill({ group, label, onClick, title, className }: { group: BehaviorGroup; label: string; onClick?: () => void; title?: string; className?: string }) {
  const classes = cn("inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium", PILL_TONES[group], className);
  return onClick
    ? <button type="button" onClick={onClick} title={title} className={cn(classes, "hover:ring-1 hover:ring-foreground/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none")}>{label}</button>
    : <span title={title} className={classes}>{label}</span>;
}

/** How an expense moves with production: fixed, variable (with what) or mixed (which part), and why. */
export function CostBehaviorDialog({ item, money, onClose, onSave }: { item: BehaviorTarget; money: (value: number) => string; onClose: () => void; onSave: (change: BehaviorChange) => Promise<void> }) {
  const [behavior, setBehavior] = React.useState<CostBehavior>(item.behavior);
  const [driver, setDriver] = React.useState<VariableDriver>(item.driver ?? "lot");
  const [percent, setPercent] = React.useState(item.behavior === "mixed" ? item.variablePercent : 50);
  const [note, setNote] = React.useState(item.note);
  const [busy, setBusy] = React.useState(false);
  const options: { value: CostBehavior; title: string; hint: string }[] = [
    { value: "fixed", title: "Fijo", hint: "Lo pagás igual aunque produzcas más o menos (alquiler, sueldos, contador)" },
    { value: "variable", title: "Variable", hint: "Si producís más, gastás más (el gas de cada tanda, envases, pago por pieza)" },
    { value: "mixed", title: "Mixto", hint: "Tiene una parte fija y otra que crece con la producción (la luz con un consumo base)" },
  ];
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
    <DialogHeader><DialogTitle>{item.name}</DialogTitle><DialogDescription>{money(item.amount)} al mes. ¿Cómo se comporta cuando producís más?</DialogDescription></DialogHeader>
    <div className="flex flex-col gap-3">
      <div className="grid gap-2" role="radiogroup" aria-label="Cómo se comporta">
        {options.map((option) => <button key={option.value} type="button" role="radio" aria-checked={behavior === option.value} aria-label={`${option.title}: ${option.hint}`} onClick={() => setBehavior(option.value)}
          className={cn("rounded-lg border p-3 text-left", behavior === option.value ? "border-foreground bg-muted/60 ring-1 ring-foreground" : "hover:bg-muted/40")}>
          <span className="block text-sm font-medium">{option.title}</span><span className="block text-xs text-muted-foreground">{option.hint}</span>
        </button>)}
      </div>
      {behavior !== "fixed" ? <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Crece con…</p>
        <div className="flex flex-wrap gap-1.5">{(["unit", "lot", "hour"] as VariableDriver[]).map((value) => <button key={value} type="button" aria-pressed={driver === value} onClick={() => setDriver(value)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", driver === value ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>{DRIVER_LABELS[value]}</button>)}</div>
      </div> : null}
      {behavior === "mixed" ? <label className="flex flex-col gap-1 text-sm"><span>Parte que crece: <strong>{percent} %</strong> ({money(item.amount * percent / 100)} al mes)</span><input type="range" min={1} max={99} value={percent} onChange={(event) => setPercent(Number(event.target.value))} className="accent-[var(--primary)]" /></label> : null}
      <label className="flex flex-col gap-1 text-sm"><span>¿Por qué? <span className="text-muted-foreground">(queda como supuesto visible)</span></span><Input value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="Ej. solo se usa al cocinar cada tanda" /></label>
    </div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={busy} onClick={async () => { setBusy(true); try { await onSave({ id: item.id, behavior, ...(behavior !== "fixed" ? { driver } : {}), ...(behavior === "mixed" ? { variablePercent: percent } : {}), note: note.trim() }); } finally { setBusy(false); } }}>{busy ? "Guardando…" : "Guardar"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
