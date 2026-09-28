import { describe, expect, it } from "vitest";
import type { Delivery } from "./business";
import type { DeliveryZone } from "./delivery-zones";
import { mapsPlace, mapsRouteLinks, orderedRoute, routeDayLabel, routeSheet, routeText, suggestRouteOrder, whatsappChatLink, windowStart } from "./delivery-routes";

const stop = (id: string, address: string, timeWindow = "", patch: Partial<Delivery> = {}): Delivery => ({
  id, saleId: `s-${id}`, scheduledOn: "2026-09-26", timeWindow, status: "pending", method: "", carrier: "", recipient: id, address, contact: "", tracking: "", note: "", deliveredOn: null,
  zoneId: "z", zoneName: "Centro", routePosition: null, source: "user", costMinor: 0, sale: { soldOn: "2026-09-25", channelId: null, channelName: "Tienda", customer: id, totalMinor: 0, items: "2 × Libreta" }, ...patch,
});
const zone = (id: string, mode: DeliveryZone["mode"], carrier = ""): DeliveryZone => ({ id, name: id, mode, carrier, areas: [], costPerOrderMinor: 0, weekdays: [], leadDays: 0, isFallback: false, notes: "" });

describe("delivery routes", () => {
  it("reads when a time window starts", () => {
    expect(["9 a 13", "10:30 a 12", "14 a 18", "Mañana", "tarde", "antes de las 12", "", "cuando puedas"].map(windowStart)).toEqual([9, 10.5, 14, 9, 15, 9, null, null]);
  });

  it("suggests morning first, neighborhood by neighborhood, and fits stops without a window where their neighborhood already goes", () => {
    const order = suggestRouteOrder([
      stop("tarde-nunoa", "Irarrázaval 2100, Ñuñoa", "15 a 19"),
      stop("libre-provi", "Providencia 900, Providencia"),
      stop("manana-provi", "Providencia 1450, Providencia", "9 a 13"),
      stop("libre-nunoa", "Irarrázaval 500, Ñuñoa"),
      stop("libre-centro", "Merced 220, Santiago Centro"),
      stop("manana-condes", "Apoquindo 3400, Las Condes", "10 a 12"),
    ]).map((item) => item.id);
    expect(order).toEqual(["manana-provi", "libre-provi", "manana-condes", "libre-centro", "tarde-nunoa", "libre-nunoa"]);
  });

  it("keeps a saved order and puts new stops after it", () => {
    const order = orderedRoute([stop("a", "A 1, X"), stop("b", "B 1, X", "", { routePosition: 1 }), stop("c", "C 1, X", "", { routePosition: 0 })]).map((item) => item.id);
    expect(order).toEqual(["c", "b", "a"]);
  });

  it("builds a day's sheet by zone with today's late stops and the failed ones apart", () => {
    const zones = [zone("moto", "own", "Tomás"), zone("starken", "carrier", "Starken"), zone("retiro", "pickup")];
    const sheet = routeSheet([
      stop("hoy", "A 1, X", "", { zoneId: "moto" }),
      stop("atrasada", "B 2, X", "", { zoneId: "moto", scheduledOn: "2026-09-24" }),
      stop("correo", "C 3, Y", "", { zoneId: "starken", status: "on_the_way" }),
      stop("retira", "", "17 a 19", { zoneId: "retiro" }),
      stop("sinzona", "D 4, Z", "", { zoneId: null }),
      stop("otra", "E 5, X", "", { zoneId: "moto", scheduledOn: "2026-09-27" }),
      stop("fallo", "F 6, X", "", { zoneId: "moto", status: "failed", scheduledOn: "2026-09-25" }),
      stop("lista", "G 7, X", "", { zoneId: "moto", status: "delivered" }),
    ], "2026-09-26", "2026-09-26", zones);
    expect(sheet.groups.map((group) => [group.title, group.mode, group.stops.map((item) => item.id)])).toEqual([
      ["moto", "own", ["hoy", "atrasada"]], ["Centro", "none", ["sinzona"]], ["starken", "carrier", ["correo"]], ["retiro", "pickup", ["retira"]],
    ]);
    expect(sheet.groups[0].stops.find((item) => item.id === "atrasada")?.late).toBe(true);
    expect(sheet.toReschedule.map((item) => item.id)).toEqual(["fallo"]);
    expect(routeSheet([stop("atrasada", "B 2, X", "", { scheduledOn: "2026-09-24" })], "2026-09-27", "2026-09-26", zones).groups).toEqual([]);
  });

  it("links the whole route in Google Maps, in legs of ten stops, and writes it for WhatsApp", () => {
    expect(mapsPlace("Merced 220, Santiago Centro", "Chile")).toBe("Merced 220, Santiago Centro, Chile");
    expect(mapsPlace("Belgrano 88, Rosario, Argentina", "Argentina")).toBe("Belgrano 88, Rosario, Argentina");
    const [link] = mapsRouteLinks(["A 1, X", "B 2, X", "C 3, X"], "Taller 5, X");
    expect(link).toBe("https://www.google.com/maps/dir/?api=1&origin=Taller%205%2C%20X&destination=C%203%2C%20X&waypoints=A%201%2C%20X%7CB%202%2C%20X&travelmode=driving");
    const legs = mapsRouteLinks(Array.from({ length: 12 }, (_, index) => `Calle ${index + 1}`));
    expect(legs).toHaveLength(2);
    expect(legs[0]).not.toContain("origin=");
    expect(legs[1]).toContain("origin=Calle%2010");
    const group = { key: "z", zone: null, mode: "own" as const, title: "Centro", carrier: "Tomás", stops: [{ ...stop("Lucía", "A 1, X", "9 a 13", { contact: "+56 9 5555 0142", note: "Timbre 3B" }), late: false }] };
    expect(routeText(group, routeDayLabel("2026-09-26", "2026-09-26"), ["https://maps"])).toBe("Ruta Centro · hoy, sábado 26/09 · Tomás\n1. Lucía — A 1, X · 9 a 13 · +56 9 5555 0142 · 2 × Libreta · Nota: Timbre 3B\nMapa: https://maps");
    expect(whatsappChatLink("+56 9 5555 0142", "Hola")).toBe("https://wa.me/56955550142?text=Hola");
    expect(whatsappChatLink("Depósito", "Hola")).toBeNull();
  });
});
