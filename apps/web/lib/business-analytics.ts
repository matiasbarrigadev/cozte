import { AREA_LABELS, type BusinessView, type PurchaseKind } from "./business";
import { COST_AREAS, type CostArea } from "./domain";
import { emptyTally, tallyDelivery, type DeliveryTally } from "./delivery-zones";

/**
 * The business month by month, for the analysis section: how much came in, what each sale cost, the structure, the
 * result, where the sales came from and how deliveries went. Pure: the same summary on the server and in the demo.
 */

export type MonthSummary = {
  month: string;
  revenue: number;
  /** What each sale cost: materials and labor, commissions and fees, delivery. */
  production: number;
  selling: number;
  delivery: number;
  /** What the sales left to cover the month's fixed costs. */
  contribution: number;
  /** Monthly fixed costs, supplies used up in the month and the month's share of investments. */
  fixed: number;
  result: number;
  breakEven: number | null;
  sales: number;
  units: number;
  fixedByArea: Record<CostArea, number>;
  byChannel: { key: string; name: string; revenue: number; sales: number }[];
  byProduct: { key: string; name: string; revenue: number; units: number }[];
  /** Revenue by weekday, Monday first. */
  byWeekday: number[];
  purchases: Record<PurchaseKind, number>;
  /** The month's fixed costs item by item, for the structure map. */
  expenses: { area: CostArea; name: string; amount: number }[];
  deliveries: DeliveryTally;
  /** The month's deliveries by zone and by who took them, most deliveries first. */
  byZone: ({ key: string; name: string } & DeliveryTally)[];
  byCarrier: ({ key: string; name: string } & DeliveryTally)[];
};

const round = (value: number) => Math.round(value * 100) / 100;

/** The months that end with `last`, oldest first. */
export function monthsBack(last: string, count: number): string[] {
  const [year, month] = last.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** Relative change from a previous value; null when there is nothing to compare with. */
export function change(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

const weekday = (isoDate: string) => (new Date(`${isoDate}T12:00:00Z`).getUTCDay() + 6) % 7;

export function summarizeMonth(view: BusinessView, month: string, today: string): MonthSummary {
  const result = view.result;
  const sales = view.sales.filter((sale) => sale.soldOn.startsWith(month));
  const byChannel = new Map<string, { key: string; name: string; revenue: number; sales: number }>();
  const byProduct = new Map<string, { key: string; name: string; revenue: number; units: number }>();
  const byWeekday = Array.from({ length: 7 }, () => 0);
  let units = 0;
  for (const sale of sales) {
    const channel = byChannel.get(sale.channelId ?? "directa") ?? { key: sale.channelId ?? "directa", name: sale.channelName, revenue: 0, sales: 0 };
    channel.revenue += sale.totalMinor;
    channel.sales += 1;
    byChannel.set(channel.key, channel);
    byWeekday[weekday(sale.soldOn)] += sale.totalMinor;
    for (const item of sale.items) {
      const quantity = item.quantityMilli / 1000;
      const product = byProduct.get(item.productId) ?? { key: item.productId, name: item.productName, revenue: 0, units: 0 };
      product.revenue += item.unitPriceMinor * quantity;
      product.units += quantity;
      byProduct.set(item.productId, product);
      units += quantity;
    }
  }
  const purchases: Record<PurchaseKind, number> = { material: 0, expense: 0, fixed_payment: 0, investment: 0 };
  for (const purchase of view.purchases) if (purchase.purchasedOn.startsWith(month)) purchases[purchase.kind] += purchase.amountMinor;
  const expenses = view.structure.areas.flatMap((area) => [
    ...area.expenses.map((item) => ({ area: area.area, name: item.name, amount: item.monthlyAmount })),
    ...area.investments.filter((item) => item.monthlyShare > 0).map((item) => ({ area: area.area, name: `${item.description} (inversión)`, amount: item.monthlyShare })),
  ]).filter((item) => item.amount > 0);
  if (result.oneOffTotal > 0) for (const area of COST_AREAS) if (result.oneOffByArea[area] > 0) expenses.push({ area, name: `Gastos del mes · ${AREA_LABELS[area]}`, amount: result.oneOffByArea[area] });
  const deliveries = emptyTally();
  const byZone = new Map<string, { key: string; name: string } & DeliveryTally>();
  const byCarrier = new Map<string, { key: string; name: string } & DeliveryTally>();
  for (const sale of sales) {
    const delivery = sale.delivery;
    if (!delivery) continue;
    tallyDelivery(deliveries, delivery, sale.deliveryCostMinor, today);
    const zoneKey = delivery.zoneId ?? "";
    tallyDelivery(byZone.get(zoneKey) ?? byZone.set(zoneKey, { key: zoneKey, name: delivery.zoneName || "Sin zona", ...emptyTally() }).get(zoneKey)!, delivery, sale.deliveryCostMinor, today);
    const carrier = delivery.carrier?.trim() || "Sin indicar";
    const carrierKey = carrier.toLowerCase();
    tallyDelivery(byCarrier.get(carrierKey) ?? byCarrier.set(carrierKey, { key: carrierKey, name: carrier, ...emptyTally() }).get(carrierKey)!, delivery, sale.deliveryCostMinor, today);
  }
  const byCount = <T extends DeliveryTally>(list: T[]) => list.sort((a, b) => b.total - a.total || b.cost - a.cost).map((item) => ({ ...item, cost: round(item.cost) }));
  const sortByRevenue = <T extends { revenue: number }>(list: T[]) => list.sort((a, b) => b.revenue - a.revenue).map((item) => ({ ...item, revenue: round(item.revenue) }));
  return {
    month,
    revenue: round(result.revenue),
    production: round(result.variableProductionCost),
    selling: round(result.sellingCost),
    delivery: round(result.deliveryCost),
    contribution: round(result.contribution),
    fixed: round(result.fixedTotal + result.oneOffTotal + result.investmentsShare),
    result: round(result.result),
    breakEven: result.breakEvenRevenue === null ? null : round(result.breakEvenRevenue),
    sales: result.sales,
    units: round(units),
    fixedByArea: { ...result.fixedByArea },
    byChannel: sortByRevenue([...byChannel.values()]),
    byProduct: sortByRevenue([...byProduct.values()]),
    byWeekday: byWeekday.map(round),
    purchases,
    expenses: expenses.sort((a, b) => b.amount - a.amount),
    deliveries: { ...deliveries, cost: round(deliveries.cost) },
    byZone: byCount([...byZone.values()]),
    byCarrier: byCount([...byCarrier.values()]),
  };
}

export type BusinessAnalysis = { currency: string; today: string; months: MonthSummary[] };

export type Insight = { tone: "good" | "bad" | "info"; text: string };

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthName = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
const percent = (ratio: number) => `${Math.abs(Math.round(ratio * 100))} %`;

/**
 * What stands out in a month, in plain words and with the engine's numbers: the result, how sales moved, the
 * channel that changed most, the product that sold most, how much the fixed costs took and how deliveries went.
 */
export function analysisInsights(months: MonthSummary[], focus: number, money: (value: number) => string): Insight[] {
  const current = months[focus];
  const previous = focus > 0 ? months[focus - 1] : undefined;
  if (!current || (!current.revenue && !current.fixed)) return [{ tone: "info", text: "Todavía no hay ventas ni gastos registrados en este mes." }];
  const insights: Insight[] = [];
  if (current.revenue) {
    insights.push(current.result >= 0
      ? { tone: "good", text: `Quedó una ganancia de ${money(current.result)}: de cada $100 vendidos quedaron $${Math.round((current.result / current.revenue) * 100)}.` }
      : { tone: "bad", text: `El mes cerró con una pérdida de ${money(-current.result)}.${current.breakEven ? ` Para no perder hacía falta vender ${money(current.breakEven)}.` : ""}` });
  }
  if (previous?.revenue) {
    const ratio = change(current.revenue, previous.revenue)!;
    insights.push({ tone: ratio >= 0 ? "good" : "bad", text: `Las ventas ${ratio >= 0 ? "subieron" : "bajaron"} ${percent(ratio)} frente a ${monthName(previous.month)} (${money(previous.revenue)} → ${money(current.revenue)}).` });
    const moves = current.byChannel.map((channel) => ({ name: channel.name, delta: channel.revenue - (previous.byChannel.find((item) => item.key === channel.key)?.revenue ?? 0) }))
      .concat(previous.byChannel.filter((channel) => !current.byChannel.some((item) => item.key === channel.key)).map((channel) => ({ name: channel.name, delta: -channel.revenue })))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    if (moves[0] && Math.abs(moves[0].delta) > 0) insights.push({ tone: moves[0].delta >= 0 ? "good" : "bad", text: `${moves[0].name} fue el canal que más cambió: vendió ${money(Math.abs(moves[0].delta))} ${moves[0].delta >= 0 ? "más" : "menos"} que en ${monthName(previous.month)}.` });
  }
  const top = current.byProduct[0];
  if (top && current.revenue) insights.push({ tone: "info", text: `${top.name} fue el ${percent(top.revenue / current.revenue)} de lo vendido (${Math.round(top.units)} unidades).` });
  if (current.revenue) insights.push({ tone: current.fixed / current.revenue > 0.5 ? "bad" : "info", text: `Los gastos fijos se llevaron el ${percent(current.fixed / current.revenue)} de las ventas (${money(current.fixed)}).` });
  if (current.deliveries.delivered) {
    const onTime = current.deliveries.onTime / current.deliveries.delivered;
    insights.push({ tone: onTime >= 0.9 ? "good" : onTime < 0.75 ? "bad" : "info", text: `${percent(onTime)} de las entregas llegaron a tiempo${current.deliveries.late ? `; ${current.deliveries.late} llegaron o van tarde` : ""}.` });
  }
  const zones = current.byZone.filter((zone) => zone.key && zone.delivered >= 2);
  const slowest = zones.map((zone) => ({ zone, rate: zone.onTime / zone.delivered })).sort((a, b) => a.rate - b.rate)[0];
  if (zones.length > 1 && slowest && slowest.rate < 0.8) insights.push({ tone: "bad", text: `${slowest.zone.name} es la zona que más se atrasa: llegó a tiempo el ${percent(slowest.rate)} de sus entregas.` });
  return insights.slice(0, 5);
}
