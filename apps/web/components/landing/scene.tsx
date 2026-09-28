"use client";

import * as React from "react";
import { AnimatedIcon, type AnimatedIconName } from "@/components/animated-icon";
import { CozteLogo } from "@/components/cozte-logo";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";

/**
 * The pieces the landing mockups are made of: a clock that plays a scene while it is on screen (and stands still on a
 * finished frame for people who prefer less motion), the app's window with its sidebar, and a pointer that clicks.
 */

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

const noSubscription = () => () => undefined;
const pinnedFrame = () => {
  const value = Number(new URLSearchParams(window.location.search).get("escena"));
  return Number.isFinite(value) && value > 0 ? value : null;
};

/**
 * Milliseconds into a looping scene of `length` ms, advancing only while the element is visible. With reduced motion
 * it stays on `still`, a frame where everything has happened.
 */
export function useSceneTime(length: number, still: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();
  const [visible, setVisible] = React.useState(false);
  const [time, setTime] = React.useState(0);
  // ?escena=<ms> freezes every scene at that moment: for screenshots and to check a frame.
  const requested = React.useSyncExternalStore(noSubscription, pinnedFrame, () => null);
  const pinned = requested === null ? null : requested % length;
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.15 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    if (!visible || reduced || pinned !== null) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      setTime((current) => (current + Math.min(now - last, 250)) % length);
      last = now;
    }, 80);
    return () => window.clearInterval(timer);
  }, [visible, reduced, length, pinned]);
  return [ref, pinned ?? (reduced ? still : time)];
}

/** 0 before `from`, 1 after `to`, eased in between. */
export function progress(time: number, from: number, to: number): number {
  if (time <= from) return 0;
  if (time >= to) return 1;
  const x = (time - from) / (to - from);
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

/** The part of a text already typed at a moment. */
export const typed = (text: string, time: number, from: number, perChar = 28) => text.slice(0, Math.max(0, Math.floor((time - from) / perChar)));

export const money = (value: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Math.round(value));

const NAV: { id: string; label: string; icon: AnimatedIconName }[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "cozte", label: "Cozte AI", icon: "assistant" },
  { id: "costos", label: "Costos de producción", icon: "costs" },
  { id: "ventas", label: "Ventas", icon: "sales" },
  { id: "entregas", label: "Entregas", icon: "truck" },
  { id: "clientes", label: "Clientes", icon: "users" },
  { id: "proveedores", label: "Proveedores", icon: "boxes" },
  { id: "analisis", label: "Análisis", icon: "chart" },
];

/** The app's window: its address bar and sidebar, as in the real workspace. */
export function AppFrame({ active, path, compact = false, className, children }: { active: string; path: string; compact?: boolean; className?: string; children: React.ReactNode }) {
  return <div className={cn("overflow-hidden rounded-[22px] border border-landing-ink/10 bg-background text-foreground shadow-[0_32px_90px_-30px_rgba(12,29,20,0.45)]", className)}>
    <div className="flex items-center gap-3 border-b bg-card px-4 py-2.5">
      <span className="flex gap-1.5" aria-hidden="true"><span className="size-2.5 rounded-full bg-[#ec6a5e]" /><span className="size-2.5 rounded-full bg-[#f4bf4f]" /><span className="size-2.5 rounded-full bg-[#61c554]" /></span>
      <span className="mx-auto flex min-w-0 max-w-xs flex-1 items-center justify-center gap-1.5 truncate rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground"><span aria-hidden="true">🔒</span>cozte.com/app{path}</span>
      <span className="w-10" aria-hidden="true" />
    </div>
    <div className="flex">
      <aside className={cn("hidden shrink-0 flex-col gap-1 border-r bg-sidebar p-2.5 sm:flex", compact ? "w-14 items-center" : "w-48")} aria-hidden="true">
        <div className={cn("mb-2 flex items-center gap-2 px-1.5 py-1", compact && "justify-center px-0")}>{compact ? <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">c</span> : <><CozteLogo className="text-lg" /><span className="truncate text-[11px] text-muted-foreground">Taller Norte</span></>}</div>
        {NAV.map((item) => <span key={item.id} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px]", compact && "justify-center px-0 py-2", item.id === active ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
          <AnimatedIcon name={item.icon} size={15} />{compact ? null : <span className="truncate">{item.label}</span>}
        </span>)}
      </aside>
      <div className="relative min-w-0 flex-1 bg-background p-3 sm:p-4">{children}</div>
    </div>
  </div>;
}

/** A pointer that glides to a spot (in % of its container) and pulses when it clicks. */
export function Cursor({ x, y, clicking = false, hidden = false }: { x: number; y: number; clicking?: boolean; hidden?: boolean }) {
  return <span className={cn("pointer-events-none absolute z-30 transition-all duration-700 ease-out", hidden && "opacity-0")} style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true">
    {clicking ? <span className="absolute -top-2 -left-2 size-7 animate-ping rounded-full bg-landing-highlight/70" /> : null}
    <svg width="20" height="22" viewBox="0 0 20 22" className="relative drop-shadow-md"><path d="M2 1.5 L2 17.5 L6.4 13.4 L9.3 20 L12.2 18.7 L9.4 12.3 L15.5 12.3 Z" fill="var(--brand-ink)" stroke="white" strokeWidth="1.4" strokeLinejoin="round" /></svg>
  </span>;
}

/** The pulsing dot and shimmering title Cozte shows while it works. */
export function WorkingStatus({ title }: { title: string }) {
  return <span className="flex items-center gap-2" role="status">
    <span className="relative flex size-2 shrink-0" aria-hidden="true"><span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" /><span className="relative inline-flex size-2 rounded-full bg-primary" /></span>
    <span key={title} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-500"><TextShimmer className="text-sm" duration={2.4}>{title}</TextShimmer></span>
  </span>;
}
