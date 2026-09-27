"use client";

import { daysFrom, isOpenDelivery, type Delivery } from "@/lib/business";
import type { DomainState } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { todayFor, useBusinessView, useMoney } from "./business-ui";
import { useDeliveries } from "./deliveries-section";
import { DeliveryStatusBadge, relativeDay } from "./delivery-status";

/**
 * The day at a glance, first thing on the dashboard: what has to be delivered today, what is late or failed,
 * and what was sold today. Each block opens its section.
 */
export function TodayCard({ state, demo, onOpen }: { state: DomainState; demo: boolean; onOpen: (section: "ventas" | "entregas") => void }) {
  const today = todayFor(demo);
  const month = today.slice(0, 7);
  const { data } = useDeliveries(month, demo, state.revision);
  const { view } = useBusinessView(month, demo, state);
  const money = useMoney(state.organization.currency);
  if (!data || !view) return null;
  const open = data.deliveries.filter((item) => isOpenDelivery(item.status));
  const dueToday = open.filter((item) => daysFrom(item.scheduledOn, today) === 0);
  const needsAction = open.filter((item) => item.status === "failed" || daysFrom(item.scheduledOn, today) < 0);
  const soldToday = view.sales.filter((sale) => sale.soldOn === today);
  const upcoming = open.filter((item) => { const days = daysFrom(item.scheduledOn, today); return days > 0 && days <= 7; });
  const who = (item: Delivery) => item.recipient || item.sale.customer || item.sale.channelName;
  const dateLabel = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${today}T12:00:00Z`));
  return <Card>
    <CardHeader>
      <CardTitle>Hoy</CardTitle>
      <CardDescription className="first-letter:uppercase">{dateLabel}: lo que hay que entregar, lo que necesita atención y lo que vendiste.</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-3 md:grid-cols-3">
      <Block title="Para entregar hoy" count={dueToday.length} empty={upcoming.length ? `Nada para hoy. ${upcoming.length} en los próximos 7 días.` : "Nada para hoy."} onOpen={() => onOpen("entregas")} action="Ver entregas">
        {dueToday.slice(0, 3).map((item) => <li key={item.id} className="flex items-center justify-between gap-2"><span className="truncate">{who(item)}{item.timeWindow ? <span className="text-muted-foreground"> · {item.timeWindow}</span> : null}</span><DeliveryStatusBadge status={item.status} /></li>)}
      </Block>
      <Block title="Necesitan atención" count={needsAction.length} tone={needsAction.length ? "alert" : undefined} empty="Ninguna atrasada ni con problema." onOpen={() => onOpen("entregas")} action="Resolver">
        {needsAction.slice(0, 3).map((item) => <li key={item.id} className="flex items-center justify-between gap-2"><span className="truncate">{who(item)}</span><span className="shrink-0 text-xs text-red-700 dark:text-red-300">{item.status === "failed" ? "No se pudo entregar" : relativeDay(item.scheduledOn, today)}</span></li>)}
      </Block>
      <Block title="Vendido hoy" count={soldToday.length} empty="Todavía no registraste ventas hoy." onOpen={() => onOpen("ventas")} action="Ver ventas" value={soldToday.length ? money(soldToday.reduce((sum, sale) => sum + sale.totalMinor, 0)) : undefined}>
        {soldToday.slice(0, 3).map((sale) => <li key={sale.id} className="flex items-center justify-between gap-2"><span className="truncate">{sale.customer || sale.channelName}</span><span className="shrink-0 tabular-nums">{money(sale.totalMinor)}</span></li>)}
      </Block>
    </CardContent>
  </Card>;
}

function Block({ title, count, value, tone, empty, onOpen, action, children }: { title: string; count: number; value?: string; tone?: "alert"; empty: string; onOpen: () => void; action: string; children: React.ReactNode }) {
  return <section className={cn("flex flex-col gap-2 rounded-xl border p-3", tone === "alert" && "border-red-200 bg-red-50/60 dark:border-red-400/30 dark:bg-red-500/5")}>
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <span className={cn("text-2xl font-semibold tabular-nums", tone === "alert" && "text-red-700 dark:text-red-300")}>{value ?? count}</span>
    </div>
    {count ? <ul className="flex flex-col gap-1.5 text-sm">{children}</ul> : <p className="text-sm text-muted-foreground">{empty}</p>}
    <Button type="button" variant="ghost" size="sm" className="mt-auto self-start px-2" onClick={onOpen}>{action} →</Button>
  </section>;
}
