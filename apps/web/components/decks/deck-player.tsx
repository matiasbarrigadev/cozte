"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { Presentation } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { PrintDeck, ScaledSlide } from "./deck-slide";

/** Prints only the deck, one slide per page, so the browser's "Save as PDF" gives a clean file. */
export function usePrintDeck() {
  const [printing, setPrinting] = React.useState(false);
  React.useEffect(() => {
    if (!printing) return;
    const root = document.documentElement;
    root.classList.add("deck-printing");
    const done = () => { root.classList.remove("deck-printing"); setPrinting(false); };
    window.addEventListener("afterprint", done, { once: true });
    // Let the printable copy mount before opening the dialog.
    const timer = window.setTimeout(() => window.print(), 150);
    return () => { window.clearTimeout(timer); window.removeEventListener("afterprint", done); root.classList.remove("deck-printing"); };
  }, [printing]);
  return { printing, print: () => setPrinting(true) };
}

export function PrintPortal({ presentation, active }: { presentation: Presentation; active: boolean }) {
  if (!active || typeof document === "undefined") return null;
  return createPortal(<div className="deck-print-root" style={{ display: "none" }}><PrintDeck deck={presentation.deck} title={presentation.title} theme={presentation.theme} /></div>, document.body);
}

type Props = {
  presentation: Presentation;
  initialIndex?: number;
  /** Present mode inside the app: an overlay that closes with Escape. Without it, the player is the whole page. */
  onClose?: () => void;
  showNotes?: boolean;
};

/** Slides one at a time, fitted to the screen: arrows, swipe, full screen, every slide at a glance and PDF. */
export function DeckPlayer({ presentation, initialIndex = 0, onClose, showNotes = false }: Props) {
  const slides = presentation.deck.slides;
  const [index, setIndex] = React.useState(Math.min(initialIndex, slides.length - 1));
  const [overview, setOverview] = React.useState(false);
  const [notesOpen, setNotesOpen] = React.useState(false);
  const stage = React.useRef<HTMLDivElement>(null);
  const swipe = React.useRef<number | null>(null);
  const { printing, print } = usePrintDeck();
  const current = Math.min(index, slides.length - 1);
  const go = React.useCallback((next: number) => setIndex(Math.max(0, Math.min(slides.length - 1, next))), [slides.length]);

  const toggleFullscreen = React.useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen?.().catch(() => {});
  }, []);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
      if (["ArrowRight", "PageDown", " ", "Enter"].includes(event.key)) { event.preventDefault(); go(current + 1); }
      else if (["ArrowLeft", "PageUp", "Backspace"].includes(event.key)) { event.preventDefault(); go(current - 1); }
      else if (event.key === "Home") go(0);
      else if (event.key === "End") go(slides.length - 1);
      else if (event.key.toLowerCase() === "f") toggleFullscreen();
      else if (event.key === "Escape" && !document.fullscreenElement) { if (overview) setOverview(false); else onClose?.(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, go, onClose, overview, slides.length, toggleFullscreen]);

  const slide = slides[current];
  const notes = showNotes ? slide?.notes : undefined;
  return <div ref={stage} className={cn("flex flex-col bg-[#0d120f] text-white", onClose ? "fixed inset-0 z-50" : "min-h-dvh")} role="region" aria-roledescription="presentación" aria-label={presentation.title}>
    <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        {onClose ? <button type="button" onClick={onClose} className="rounded-full px-3 py-1.5 text-white/80 hover:bg-white/10 hover:text-white">← Salir</button>
          : <Link href="https://cozte.com" className="flex shrink-0 items-center gap-2 font-semibold text-white/90 hover:text-white"><span className="cozte-logo-mark" aria-hidden="true" style={{ width: 22, height: 16 }} />Cozte</Link>}
        <span className="truncate text-white/70">{presentation.title}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {showNotes && slides.some((item) => item.notes) ? <PlayerButton active={notesOpen} onClick={() => setNotesOpen((open) => !open)}>Notas</PlayerButton> : null}
        <PlayerButton active={overview} onClick={() => setOverview((open) => !open)}>Todas</PlayerButton>
        <PlayerButton onClick={print}>PDF</PlayerButton>
        <PlayerButton onClick={toggleFullscreen} label="Pantalla completa (F)">⛶</PlayerButton>
      </div>
    </header>

    {overview ? <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 lg:grid-cols-4">
      {slides.map((item, position) => <button key={item.id} type="button" onClick={() => { go(position); setOverview(false); }} className={cn("overflow-hidden rounded-lg text-left ring-2 transition", position === current ? "ring-lime-300" : "ring-transparent hover:ring-white/40")} aria-label={`Ir a la diapositiva ${position + 1}: ${item.title}`}>
        <ScaledSlide slide={item} index={position} total={slides.length} deck={presentation.deck} title={presentation.title} theme={presentation.theme} />
      </button>)}
    </div> : <div className="relative flex min-h-0 flex-1 flex-col"
      onPointerDown={(event) => { swipe.current = event.clientX; }}
      onPointerUp={(event) => { if (swipe.current === null) return; const delta = event.clientX - swipe.current; swipe.current = null; if (Math.abs(delta) > 50) go(current + (delta < 0 ? 1 : -1)); }}>
      {slide ? <ScaledSlide fit="contain" className="min-h-0 flex-1 px-2 sm:px-6" slide={slide} index={current} total={slides.length} deck={presentation.deck} title={presentation.title} theme={presentation.theme} /> : null}
      <button type="button" aria-label="Anterior" onClick={() => go(current - 1)} disabled={current === 0} className="absolute inset-y-0 left-0 w-1/5 cursor-w-resize opacity-0 disabled:cursor-default" />
      <button type="button" aria-label="Siguiente" onClick={() => go(current + 1)} disabled={current === slides.length - 1} className="absolute inset-y-0 right-0 w-1/5 cursor-e-resize opacity-0 disabled:cursor-default" />
      {notesOpen && notes ? <div className="mx-auto mb-2 w-full max-w-4xl rounded-lg bg-white/10 px-4 py-3 text-sm leading-relaxed text-white/90">{notes}</div> : null}
    </div>}

    <footer className="flex shrink-0 items-center justify-center gap-4 px-4 py-3">
      <PlayerButton onClick={() => go(current - 1)} disabled={current === 0} label="Anterior">←</PlayerButton>
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {slides.map((item, position) => <span key={item.id} className={cn("h-1.5 rounded-full transition-all", position === current ? "w-6 bg-lime-300" : "w-1.5 bg-white/30")} />)}
      </div>
      <span className="min-w-14 text-center text-sm tabular-nums text-white/70" aria-live="polite">{current + 1} / {slides.length}</span>
      <PlayerButton onClick={() => go(current + 1)} disabled={current === slides.length - 1} label="Siguiente">→</PlayerButton>
    </footer>
    <PrintPortal presentation={presentation} active={printing} />
  </div>;
}

function PlayerButton({ children, onClick, disabled, active, label }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean; label?: string }) {
  return <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} aria-pressed={active}
    className={cn("rounded-full px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent", active && "bg-white/15 text-white")}>{children}</button>;
}
