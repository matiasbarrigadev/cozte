"use client";

import * as React from "react";

/**
 * When each chat message was written, in the person's own timezone: the time on each message and a separator
 * when the day changes ("Hoy", "Ayer", "jueves 25 de septiembre"), like a messaging app.
 */

const localDay = (date: Date) => date.toLocaleDateString("en-CA");

export function messageTime(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export function messageFullDate(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** The calendar day of a message where the person is, to group messages by day. */
export function messageDay(iso: string): string {
  return localDay(new Date(iso));
}

export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const day = localDay(date);
  if (day === localDay(now)) return "Hoy";
  if (day === localDay(new Date(now.getTime() - 86_400_000))) return "Ayer";
  const label = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}) }).format(date);
  return label.charAt(0).toLocaleUpperCase("es") + label.slice(1);
}

export function DaySeparator({ iso }: { iso: string }) {
  return <div className="flex items-center gap-3 py-1 text-[11px] font-medium text-muted-foreground" role="separator" aria-label={dayLabel(iso)}>
    <span className="h-px flex-1 bg-border" aria-hidden="true" />
    <span className="rounded-full border bg-background px-2.5 py-0.5">{dayLabel(iso)}</span>
    <span className="h-px flex-1 bg-border" aria-hidden="true" />
  </div>;
}

export function MessageTime({ iso, className }: { iso: string; className?: string }) {
  return <time dateTime={iso} title={messageFullDate(iso)} className={className}>{messageTime(iso)}</time>;
}

/** The nearest scrolling ancestor of an element: where the chat keeps its scroll position. */
export function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

export const useIsomorphicLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;
