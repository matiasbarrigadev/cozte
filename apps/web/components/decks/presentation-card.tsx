"use client";

import * as React from "react";
import { toast } from "sonner";
import type { Presentation } from "@/lib/decks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AnimatedIcon } from "@/components/animated-icon";
import { ScaledSlide } from "./deck-slide";
import { DeckPlayer } from "./deck-player";
import { serverPresentations } from "./presentations-api";

/** A deck Cozte created or changed, shown in the chat: its cover, and buttons to open, present or copy its link. */
export function PresentationCard({ id, revision, onOpen }: { id: string; revision: number; onOpen?: (id: string) => void }) {
  const [presentation, setPresentation] = React.useState<Presentation | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [presenting, setPresenting] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    serverPresentations.get(id).then((loaded) => { if (active) setPresentation(loaded); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [id, revision]);
  if (failed) return <p className="text-xs text-muted-foreground">La presentación ya no está disponible.</p>;
  if (!presentation) return <div className="aspect-video w-full max-w-xl animate-pulse rounded-xl bg-background/60" />;
  const cover = presentation.deck.slides[0];
  return <section aria-label={`Presentación ${presentation.title}`} className="flex w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-card text-card-foreground">
    {cover ? <button type="button" onClick={() => setPresenting(true)} aria-label="Ver la presentación" className="block"><ScaledSlide slide={cover} index={0} total={presentation.deck.slides.length} deck={presentation.deck} title={presentation.title} theme={presentation.theme} /></button> : null}
    <div className="flex flex-wrap items-center justify-between gap-2 p-3">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold">{presentation.title}</h3>
        <p className="text-[11px] text-muted-foreground">{presentation.deck.slides.length} diapositivas{presentation.shareUrl ? " · con link público" : ""}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setPresenting(true)}><AnimatedIcon name="panel" data-icon="inline-start" size={14} />Ver</Button>
        {onOpen ? <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onOpen(id)}><AnimatedIcon name="edit" data-icon="inline-start" size={14} />Editar</Button> : null}
        {presentation.shareUrl ? <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { void navigator.clipboard.writeText(presentation.shareUrl!).then(() => toast.success("Link copiado")).catch(() => toast.error("No se pudo copiar el link")); }}>Copiar link</Button> : <Badge variant="outline" className="text-[10px]">Privada</Badge>}
      </div>
    </div>
    {presenting ? <DeckPlayer presentation={presentation} onClose={() => setPresenting(false)} showNotes /> : null}
  </section>;
}
