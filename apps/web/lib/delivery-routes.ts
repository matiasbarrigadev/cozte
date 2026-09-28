import type { Delivery } from "./business";
import { customerKey, zoneFromAddress } from "./customers";
import type { DeliveryZone, ZoneMode } from "./delivery-zones";

/**
 * Route sheets: a day's open deliveries grouped by zone, in the order they are best driven (time windows first, then
 * neighborhood by neighborhood), with Google Maps links for the whole route and a text to send by WhatsApp. No paid
 * maps service: the order is a heuristic the person or Cozte can change, and it is kept on each delivery.
 */

/** The hour a time window starts, from how a person writes it ("9 a 13", "10:30", "tarde"); null when it says nothing. */
export function windowStart(text: string): number | null {
  const clean = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  if (!clean) return null;
  const hour = clean.match(/(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?/);
  if (hour) {
    const value = Number(hour[1]) + Number(hour[2] ?? 0) / 60;
    if (value <= 23.99) return /antes de/.test(clean) ? Math.max(0, value - 3) : value;
  }
  if (/manana|temprano/.test(clean)) return 9;
  if (/mediodia/.test(clean)) return 12;
  if (/tarde/.test(clean)) return 15;
  if (/noche/.test(clean)) return 19;
  return null;
}

type Orderable = Pick<Delivery, "id" | "address" | "timeWindow">;

const areaOf = (stop: Orderable) => customerKey(zoneFromAddress(stop.address));
const streetOf = (stop: Orderable) => customerKey(stop.address.split(",")[0].replace(/\d+/g, ""));
const numberOf = (stop: Orderable) => Number(stop.address.split(",")[0].match(/\d+/)?.[0] ?? 0);

/**
 * The suggested order of a route: stops with a morning window first and afternoon ones last, each part neighborhood
 * by neighborhood; stops without a window join the part that already goes to their neighborhood (or go in between).
 */
export function suggestRouteOrder<T extends Orderable>(stops: T[]): T[] {
  const byPlace = (a: T, b: T) => areaOf(a).localeCompare(areaOf(b)) || streetOf(a).localeCompare(streetOf(b)) || numberOf(a) - numberOf(b);
  const timed = (list: T[]) => list.sort((a, b) => (windowStart(a.timeWindow) ?? 12) - (windowStart(b.timeWindow) ?? 12) || byPlace(a, b));
  const morning = timed(stops.filter((stop) => (windowStart(stop.timeWindow) ?? 99) < 12));
  const afternoon = timed(stops.filter((stop) => { const start = windowStart(stop.timeWindow); return start !== null && start >= 12; }));
  const middle: T[] = [];
  for (const stop of stops.filter((item) => windowStart(item.timeWindow) === null).sort(byPlace)) {
    const area = areaOf(stop);
    const target = area && morning.some((item) => areaOf(item) === area) ? morning : area && afternoon.some((item) => areaOf(item) === area) ? afternoon : middle;
    const after = target === middle ? -1 : target.map((item) => areaOf(item)).lastIndexOf(area);
    if (after < 0) target.push(stop); else target.splice(after + 1, 0, stop);
  }
  return [...morning, ...middle, ...afternoon];
}

/** A route in its saved order; stops without a place yet go after, in the suggested order. */
export function orderedRoute<T extends Orderable & { routePosition: number | null }>(stops: T[]): T[] {
  const placed = stops.filter((stop) => stop.routePosition !== null).sort((a, b) => a.routePosition! - b.routePosition!);
  return [...placed, ...suggestRouteOrder(stops.filter((stop) => stop.routePosition === null))];
}

export type RouteStop = Delivery & { late: boolean };
export type RouteGroup = { key: string; zone: DeliveryZone | null; mode: ZoneMode | "none"; title: string; carrier: string; stops: RouteStop[] };

const OPEN = new Set(["pending", "on_the_way"]);

/**
 * A day's route sheet: its open deliveries (and, for today, the late ones still open) grouped by zone. Own delivery
 * and deliveries without a zone come in route order; carrier ones by recipient; pickups by time window. Deliveries
 * that could not be delivered are listed apart, to reschedule.
 */
export function routeSheet(deliveries: Delivery[], date: string, today: string, zones: DeliveryZone[]): { groups: RouteGroup[]; toReschedule: Delivery[] } {
  const stops = deliveries.filter((item) => OPEN.has(item.status) && (item.scheduledOn === date || (date === today && item.scheduledOn < today)));
  const byZone = new Map<string, RouteStop[]>();
  for (const item of stops) byZone.set(item.zoneId ?? "", [...(byZone.get(item.zoneId ?? "") ?? []), { ...item, late: item.scheduledOn < today }]);
  const modeOrder: Record<RouteGroup["mode"], number> = { own: 0, none: 1, carrier: 2, pickup: 3 };
  const groups = [...byZone].map(([key, list]): RouteGroup => {
    const zone = zones.find((item) => item.id === key) ?? null;
    const mode = zone?.mode ?? "none";
    const ordered = mode === "carrier" ? [...list].sort((a, b) => (a.recipient || a.sale.customer).localeCompare(b.recipient || b.sale.customer, "es"))
      : mode === "pickup" ? [...list].sort((a, b) => (windowStart(a.timeWindow) ?? 12) - (windowStart(b.timeWindow) ?? 12))
      : orderedRoute(list);
    return { key: key || "none", zone, mode, title: zone?.name ?? list[0]?.zoneName ?? "Sin zona", carrier: zone?.carrier || [...new Set(list.map((item) => item.carrier).filter(Boolean))].join(", "), stops: ordered };
  }).sort((a, b) => modeOrder[a.mode] - modeOrder[b.mode] || b.stops.length - a.stops.length || a.title.localeCompare(b.title, "es"));
  const toReschedule = deliveries.filter((item) => item.status === "failed" && item.scheduledOn <= date);
  return { groups, toReschedule };
}

/** An address as Google Maps should read it: with the country when it does not say it. */
export function mapsPlace(address: string, country = ""): string {
  const clean = address.trim();
  return country && !customerKey(clean).includes(customerKey(country)) ? `${clean}, ${country}` : clean;
}

export const mapsSearchLink = (address: string, country = "") => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsPlace(address, country))}`;

/** Directions to one stop, from wherever the driver is. */
export const mapsDirectionsLink = (address: string, country = "") => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsPlace(address, country))}&travelmode=driving`;

/**
 * Google Maps links for a whole route, in legs of up to ten stops (Maps takes nine stops in between). The first leg
 * starts from the route's origin, or from wherever the driver opens it when there is none.
 */
export function mapsRouteLinks(addresses: string[], origin = "", country = ""): string[] {
  const places = addresses.map((address) => address.trim()).filter(Boolean).map((address) => mapsPlace(address, country));
  const links: string[] = [];
  let from = origin.trim() ? mapsPlace(origin, country) : "";
  for (let index = 0; index < places.length; index += 10) {
    const leg = places.slice(index, index + 10);
    const destination = leg[leg.length - 1];
    const waypoints = leg.slice(0, -1);
    const params = [...(from ? [`origin=${encodeURIComponent(from)}`] : []), `destination=${encodeURIComponent(destination)}`, ...(waypoints.length ? [`waypoints=${waypoints.map(encodeURIComponent).join("%7C")}`] : []), "travelmode=driving"];
    links.push(`https://www.google.com/maps/dir/?api=1&${params.join("&")}`);
    from = destination;
  }
  return links;
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** "hoy, sábado 26/09", "mañana, lunes 28/09" or "martes 29/09". */
export function routeDayLabel(date: string, today: string): string {
  const day = new Date(`${date}T12:00:00Z`);
  const plain = `${WEEKDAYS[day.getUTCDay()]} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
  const diff = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  return diff === 0 ? `hoy, ${plain}` : diff === 1 ? `mañana, ${plain}` : diff === -1 ? `ayer, ${plain}` : plain;
}

/** The route as text to send the driver or the carrier by WhatsApp: each stop with what they need, and the map. */
export function routeText(group: RouteGroup, dayLabel: string, links: string[]): string {
  const heading = group.mode === "carrier" ? `Despacho para ${group.carrier || group.title} · ${dayLabel}` : group.mode === "pickup" ? `Retiros · ${dayLabel}` : `Ruta ${group.title} · ${dayLabel}${group.carrier ? ` · ${group.carrier}` : ""}`;
  const lines = group.stops.map((stop, index) => {
    const details = [stop.address || "Sin dirección", stop.timeWindow, stop.contact, stop.sale.items, stop.tracking && `Seguimiento ${stop.tracking}`, stop.note && `Nota: ${stop.note}`].filter(Boolean).join(" · ");
    return `${index + 1}. ${stop.recipient || stop.sale.customer || "Cliente"}${stop.late ? " (atrasada)" : ""} — ${details}`;
  });
  const maps = links.length === 1 ? [`Mapa: ${links[0]}`] : links.map((link, index) => `Mapa, tramo ${index + 1}: ${link}`);
  return [heading, ...lines, ...(group.mode === "carrier" || group.mode === "pickup" ? [] : maps)].join("\n");
}

export const whatsappShareLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** A chat with a customer's phone, when the contact looks like one. */
export function whatsappChatLink(contact: string, text: string): string | null {
  const digits = contact.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "").replace(/^\+/, "");
  return digits.length >= 8 ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}
