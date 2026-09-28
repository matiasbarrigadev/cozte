import { customerKey, zoneFromAddress } from "./customers";
import type { DeliveryStatus } from "./business";

/**
 * Delivery zones: how each area is delivered, what an order costs there, which days it goes out and how long it takes.
 * Pure functions shared by the server and the demo: the zone of an address, the next day a zone delivers and what
 * each zone's deliveries cost and how they went.
 */

export type ZoneMode = "own" | "carrier" | "pickup";
export const ZONE_MODES: ZoneMode[] = ["own", "carrier", "pickup"];

export const ZONE_MODE_LABELS: Record<ZoneMode, string> = { own: "Reparto propio", carrier: "Transportista", pickup: "Retiro en el local" };
export const ZONE_MODE_HINTS: Record<ZoneMode, string> = {
  own: "Lo llevan ustedes: una moto, un auto o alguien del equipo",
  carrier: "Lo lleva una empresa de envíos o un repartidor de afuera",
  pickup: "El cliente lo pasa a buscar: no hay costo de envío",
};

export type DeliveryZone = {
  id: string;
  name: string;
  mode: ZoneMode;
  /** Who takes the orders: the driver or the courier company. */
  carrier: string;
  /** Neighborhoods, towns or cities the zone covers. */
  areas: string[];
  costPerOrderMinor: number;
  /** Weekdays it goes out, 1 Monday … 7 Sunday; empty means any day. */
  weekdays: number[];
  /** Days from the sale until it can go out. */
  leadDays: number;
  /** The zone for every address no other zone covers. */
  isFallback: boolean;
  notes: string;
};

export const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const WEEKDAY_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** Weekdays from their stored text ("1,3,5"), valid and in order. */
export const parseWeekdays = (text: string): number[] => [...new Set(text.split(",").map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort((a, b) => a - b);

/** Weekdays from how a person writes them ("lunes", "mié", "sabado"), in order. */
export function weekdaysFromNames(names: (string | number)[]): number[] {
  const days = names.map((name) => {
    if (typeof name === "number") return name;
    const key = customerKey(name).slice(0, 2);
    if (!key) return 0;
    return WEEKDAY_NAMES.findIndex((day) => customerKey(day).startsWith(key)) + 1;
  });
  return parseWeekdays(days.join(","));
}

/** The areas a zone covers from a comma or line separated text, without repeats. */
export function parseAreas(text: string): string[] {
  const seen = new Set<string>();
  return text.split(/[,\n;]/).map((part) => part.trim().slice(0, 60)).filter((part) => {
    const key = customerKey(part);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
}

/** "Todos los días", "De lunes a viernes" or "lun, mié y vie". */
export function weekdaysText(weekdays: number[]): string {
  const days = parseWeekdays(weekdays.join(","));
  if (!days.length || days.length === 7) return "Todos los días";
  if (days.join() === "1,2,3,4,5") return "De lunes a viernes";
  if (days.join() === "1,2,3,4,5,6") return "De lunes a sábado";
  if (days.length === 1) return `Los ${WEEKDAY_NAMES[days[0] - 1]}${days[0] <= 5 ? "" : "s"}`;
  const names = days.map((day) => WEEKDAY_SHORT[day - 1]);
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** How long a zone takes, in words. */
export const leadText = (leadDays: number) => leadDays <= 0 ? "Sale el mismo día" : leadDays === 1 ? "Sale al día siguiente" : `Sale ${leadDays} días después`;

const addDays = (isoDate: string, count: number) => new Date(Date.parse(`${isoDate}T12:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
const isoWeekday = (isoDate: string) => ((new Date(`${isoDate}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** The first day a zone can deliver an order sold on a day: after its lead days, on one of its weekdays. */
export function nextDeliveryDay(zone: Pick<DeliveryZone, "weekdays" | "leadDays">, from: string): string {
  let date = addDays(from, Math.max(0, zone.leadDays));
  if (!zone.weekdays.length) return date;
  for (let step = 0; step < 7 && !zone.weekdays.includes(isoWeekday(date)); step++) date = addDays(date, 1);
  return date;
}

/**
 * The zone of an address: the one whose name or areas equal the address's zone (its neighborhood or city), else the
 * one with an area named in the address after the street, else the fallback zone. Pickup zones are only chosen by hand.
 * Without an address there is no zone.
 */
export function matchZone<T extends Pick<DeliveryZone, "name" | "areas" | "isFallback" | "mode">>(zones: T[], place: { zone?: string | null; address?: string | null }): T | null {
  const address = place.address?.trim() ?? "";
  const zoneText = place.zone?.trim() || zoneFromAddress(address);
  if (!address && !zoneText) return null;
  const candidates = zones.filter((zone) => zone.mode !== "pickup");
  const keysOf = (zone: T) => [zone.name, ...zone.areas].map(customerKey).filter((key) => key.length >= 3);
  const zoneKey = customerKey(zoneText);
  const exact = zoneKey ? candidates.find((zone) => keysOf(zone).includes(zoneKey)) : undefined;
  if (exact) return exact;
  // After the street: "Belgrano 88, Rosario" is in Rosario, not in a zone called Belgrano.
  const text = ` ${customerKey([address.split(",").slice(1).join(" "), zoneText].join(" "))} `;
  let best: { zone: T; length: number } | null = null;
  for (const zone of candidates) for (const key of keysOf(zone)) if (text.includes(` ${key} `) && (!best || key.length > best.length)) best = { zone, length: key.length };
  return best?.zone ?? candidates.find((zone) => zone.isFallback) ?? null;
}

/** What a delivery takes from its zone: its method and who takes it. */
export const zoneDeliveryFields = (zone: Pick<DeliveryZone, "mode" | "carrier">) => ({ method: ZONE_MODE_LABELS[zone.mode], carrier: zone.mode === "pickup" ? "" : zone.carrier });

/** What delivering an order costs in a zone; null keeps the channel's usual cost (a zone without a cost set). */
export const zoneCost = (zone: Pick<DeliveryZone, "mode" | "costPerOrderMinor">): number | null => zone.mode === "pickup" ? 0 : zone.costPerOrderMinor > 0 ? zone.costPerOrderMinor : null;

export type DeliveryTally = { total: number; delivered: number; onTime: number; late: number; open: number; failed: number; cancelled: number; cost: number };

export const emptyTally = (): DeliveryTally => ({ total: 0, delivered: 0, onTime: 0, late: 0, open: 0, failed: 0, cancelled: 0, cost: 0 });

/**
 * Adds a delivery to a tally. Delivered on the day or before counts as on time (without a recorded day too); an open
 * one past its day counts as late. A cancelled delivery adds no cost: it did not go out.
 */
export function tallyDelivery(tally: DeliveryTally, delivery: { status: DeliveryStatus; scheduledOn: string; deliveredOn?: string | null }, cost: number, today: string): DeliveryTally {
  tally.total += 1;
  if (delivery.status !== "cancelled") tally.cost += cost;
  if (delivery.status === "delivered") {
    tally.delivered += 1;
    if (!delivery.deliveredOn || delivery.deliveredOn <= delivery.scheduledOn) tally.onTime += 1;
    else tally.late += 1;
  } else if (delivery.status === "cancelled") tally.cancelled += 1;
  else if (delivery.status === "failed") tally.failed += 1;
  else {
    tally.open += 1;
    if (delivery.scheduledOn < today) tally.late += 1;
  }
  return tally;
}

/** Each zone's deliveries tallied, keyed by zone id ("" for the ones without a zone). */
export function zoneTallies(deliveries: { zoneId: string | null; status: DeliveryStatus; scheduledOn: string; deliveredOn?: string | null; costMinor: number }[], today: string): Map<string, DeliveryTally> {
  const tallies = new Map<string, DeliveryTally>();
  for (const delivery of deliveries) {
    const key = delivery.zoneId ?? "";
    tallies.set(key, tallyDelivery(tallies.get(key) ?? emptyTally(), delivery, delivery.costMinor, today));
  }
  return tallies;
}

/**
 * Where customers receive (their addresses' neighborhood or city), grouped by the zone each place falls in, with how
 * many addresses each has; key "" holds the places no zone covers: the zones worth creating.
 */
export function placesByZone(places: { zone: string; address: string }[], zones: Pick<DeliveryZone, "id" | "name" | "areas" | "isFallback" | "mode">[]): Map<string, { name: string; count: number }[]> {
  const found = new Map<string, Map<string, { name: string; count: number }>>();
  for (const place of places) {
    const name = place.zone.trim() || zoneFromAddress(place.address);
    const key = customerKey(name);
    if (!key) continue;
    const zoneId = matchZone(zones, { zone: name, address: place.address })?.id ?? "";
    const group = found.get(zoneId) ?? new Map<string, { name: string; count: number }>();
    const entry = group.get(key) ?? { name, count: 0 };
    entry.count += 1;
    group.set(key, entry);
    found.set(zoneId, group);
  }
  return new Map([...found].map(([zoneId, group]) => [zoneId, [...group.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es"))]));
}
