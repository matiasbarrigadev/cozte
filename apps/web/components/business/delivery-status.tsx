import { DELIVERY_STATUS_LABELS, daysFrom, type DeliveryStatus } from "@/lib/business";
import { cn } from "@/lib/utils";

/** One color per state, always with its label: amber waits, blue moves, green is done, red needs action. */
export const DELIVERY_TONE: Record<DeliveryStatus, string> = {
  pending: "bg-amber-100 text-amber-900 ring-amber-300/60 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-400/30",
  on_the_way: "bg-sky-100 text-sky-900 ring-sky-300/60 dark:bg-sky-400/15 dark:text-sky-200 dark:ring-sky-400/30",
  delivered: "bg-emerald-100 text-emerald-900 ring-emerald-300/60 dark:bg-emerald-400/15 dark:text-emerald-200 dark:ring-emerald-400/30",
  failed: "bg-red-100 text-red-900 ring-red-300/60 dark:bg-red-400/15 dark:text-red-200 dark:ring-red-400/30",
  cancelled: "bg-muted text-muted-foreground ring-border",
};

const DOT: Record<DeliveryStatus, string> = { pending: "bg-amber-500", on_the_way: "bg-sky-500", delivered: "bg-emerald-500", failed: "bg-red-500", cancelled: "bg-muted-foreground/50" };

export function DeliveryStatusBadge({ status, className }: { status: DeliveryStatus; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1", DELIVERY_TONE[status], className)}>
    <span className={cn("size-1.5 rounded-full", DOT[status])} aria-hidden="true" />{DELIVERY_STATUS_LABELS[status]}
  </span>;
}

/** "Hoy", "Mañana", "En 3 días", "Hace 2 días": how far a date is from today. */
export function relativeDay(date: string, today: string): string {
  const days = daysFrom(date, today);
  if (days === 0) return "Hoy";
  if (days === 1) return "Mañana";
  if (days === -1) return "Ayer";
  return days > 0 ? `En ${days} días` : `Hace ${-days} días`;
}
