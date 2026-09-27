"use client";

import * as React from "react";
import type { LiveStatus } from "@/lib/cozte-turn-activity";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { TextShimmer } from "@/components/ui/text-shimmer";

/** Each phase stays on screen at least this long, so fast tool calls do not flicker. */
const MIN_PHASE_MS = 900;
/** Within a long phase, its titles take turns. */
const ROTATE_MS = 3200;

/**
 * What Cozte is doing while the turn runs, as one animated title that changes with each phase. Nothing written
 * during the turn is final yet, so this takes the place of the answer until the turn ends.
 */
export function CozteLiveStatus({ status }: { status: LiveStatus }) {
  const [shown, setShown] = React.useState(status);
  const since = React.useRef(0);
  React.useEffect(() => {
    if (status.phase === shown.phase) return;
    const wait = Math.max(0, MIN_PHASE_MS - (Date.now() - since.current));
    const timer = window.setTimeout(() => { since.current = Date.now(); setShown(status); }, wait);
    return () => window.clearTimeout(timer);
  }, [status, shown.phase]);
  return <div className="flex min-h-6 items-center gap-2" role="status">
    <span className="relative flex size-2 shrink-0" aria-hidden="true">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
      <span className="relative inline-flex size-2 rounded-full bg-primary" />
    </span>
    <RotatingTitle key={shown.phase} titles={shown.titles} />
    <Elapsed />
  </div>;
}

function RotatingTitle({ titles }: { titles: string[] }) {
  const [index, setIndex] = React.useState(0);
  React.useEffect(() => {
    if (titles.length < 2) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % titles.length), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [titles]);
  const title = titles[index] ?? titles[0];
  return <>
    <span className="sr-only">{titles[0]}</span>
    <span key={title} aria-hidden="true" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-500">
      <TextShimmer className="text-sm" duration={2.4}>{title}</TextShimmer>
    </span>
  </>;
}

/** Seconds since the turn started, shown only once it takes a while. */
function Elapsed() {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return seconds >= 6 ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums" aria-hidden="true">{seconds} s</span> : null;
}

/**
 * The final answer, written out word by word as if it were being generated, once the turn has ended and the text
 * is known to be the one that stays. Answers loaded from history, and people who prefer less motion, see it whole.
 */
export function StreamedAnswer({ text, animate }: { text: string; animate: boolean }) {
  const [shown, setShown] = React.useState(animate ? 0 : text.length);
  React.useEffect(() => {
    if (!animate) return;
    let frame = 0;
    // In a background tab animation frames do not run: the answer is simply there when the person comes back.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.visibilityState === "hidden") {
      const timer = window.setTimeout(() => setShown(text.length), 0);
      return () => window.clearTimeout(timer);
    }
    // Longer answers write faster, so none takes more than a few seconds.
    const duration = Math.min(3200, Math.max(700, text.length * 9));
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const target = Math.round(text.length * progress);
      const boundary = text.slice(target).search(/\s/);
      setShown(progress >= 1 || boundary < 0 ? text.length : target + boundary);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [animate, text]);
  const done = shown >= text.length;
  return <div className={animate ? "animate-in fade-in-0 duration-300" : undefined} aria-busy={!done}>
    <AssistantMarkdown text={done ? text : text.slice(0, shown)} />
  </div>;
}
