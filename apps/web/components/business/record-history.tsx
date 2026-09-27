"use client";

import * as React from "react";
import type { HistoryEvent } from "@/lib/business";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";

/** Who changed a sale, delivery or purchase, when, and what: newest first. */
export function RecordHistory({ kind, id, title, demo, onClose }: { kind: "sale" | "delivery" | "purchase"; id: string; title: string; demo: boolean; onClose: () => void }) {
  const [events, setEvents] = React.useState<HistoryEvent[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (demo) return;
    let active = true;
    fetch(`/api/business/history?kind=${kind}&id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ events: HistoryEvent[] }> : Promise.reject(new Error()))
      .then((data) => { if (active) setEvents(data.events); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [kind, id, demo]);
  const when = (at: string) => new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(`${at.replace(" ", "T")}${at.endsWith("Z") ? "" : "Z"}`));
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
    <DialogHeader><DialogTitle>Historial</DialogTitle><DialogDescription>{title}: quién lo cambió, cuándo y qué.</DialogDescription></DialogHeader>
    {demo ? <p className="text-sm text-muted-foreground">En la demostración no se guarda el historial. Con tu cuenta, cada cambio queda registrado con quién lo hizo, tú, alguien de tu equipo o Cozte.</p>
      : failed ? <p className="text-sm text-muted-foreground">No se pudo cargar el historial. Intenta de nuevo en un momento.</p>
      : !events ? <TextShimmer className="text-sm">Cargando historial…</TextShimmer>
      : !events.length ? <p className="text-sm text-muted-foreground">Todavía no hay cambios registrados.</p>
      : <ol className="relative flex flex-col gap-4 border-l pl-5">
        {events.map((event) => <li key={event.id} className="relative">
          <span className={cn("absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-background", event.byCozte ? "bg-lime-500" : "bg-foreground/60")} aria-hidden="true" />
          <p className="text-sm font-medium">{event.title}</p>
          <p className="text-xs text-muted-foreground">{when(event.at)} · {event.who}</p>
          {event.lines.length ? <ul className="mt-1 flex flex-col gap-0.5 text-sm">{event.lines.map((line, index) => <li key={index}>{line}</li>)}</ul> : null}
        </li>)}
      </ol>}
  </DialogContent></Dialog>;
}
