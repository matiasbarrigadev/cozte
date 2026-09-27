import { describe, expect, it } from "vitest";
import { matchZone, nextDeliveryDay, parseAreas, placesByZone, weekdaysFromNames, weekdaysText, zoneCost, zoneDeliveryFields, zoneTallies, type DeliveryZone } from "./delivery-zones";

const zone = (name: string, patch: Partial<DeliveryZone> = {}): DeliveryZone => ({ id: name, name, mode: "own", carrier: "", areas: [], costPerOrderMinor: 0, weekdays: [], leadDays: 0, isFallback: false, notes: "", ...patch });

describe("delivery zones", () => {
  const centro = zone("Córdoba ciudad", { areas: ["Córdoba", "Nueva Córdoba"], carrier: "Moto (Tomás)", costPerOrderMinor: 1800, weekdays: [2, 4, 6] });
  const rosario = zone("Rosario", { mode: "carrier", carrier: "Andreani", costPerOrderMinor: 4200, leadDays: 2 });
  const resto = zone("Resto del país", { mode: "carrier", carrier: "Correo Argentino", costPerOrderMinor: 5000, isFallback: true });
  const retiro = zone("Retiro", { mode: "pickup", areas: ["Córdoba"] });
  const zones = [retiro, centro, rosario, resto];

  it("finds the zone of an address by its city or neighborhood, after the street", () => {
    expect(matchZone(zones, { address: "Av. Colón 1450, Córdoba" })?.name).toBe("Córdoba ciudad");
    expect(matchZone(zones, { address: "Belgrano 88, Rosario" })?.name).toBe("Rosario");
    expect(matchZone(zones, { address: "Obispo Trejo 300, Nueva Córdoba, Córdoba" })?.name).toBe("Córdoba ciudad");
    expect(matchZone(zones, { address: "Rosario 500, Mendoza" })?.name).toBe("Resto del país");
    expect(matchZone(zones, { address: "Caseros 540", zone: "cordoba" })?.name).toBe("Córdoba ciudad");
    expect(matchZone(zones, { address: "" })).toBeNull();
    expect(matchZone([centro], { address: "Mitre 10, Salta" })).toBeNull();
  });

  it("schedules on the zone's next day after its lead days", () => {
    // 2026-09-27 is a Sunday: Córdoba goes out Tuesday, Thursday and Saturday.
    expect(nextDeliveryDay(centro, "2026-09-27")).toBe("2026-09-29");
    expect(nextDeliveryDay(centro, "2026-09-29")).toBe("2026-09-29");
    expect(nextDeliveryDay(rosario, "2026-09-27")).toBe("2026-09-29");
    expect(nextDeliveryDay(zone("Todos"), "2026-09-27")).toBe("2026-09-27");
  });

  it("gives each delivery its method, carrier and cost", () => {
    expect(zoneDeliveryFields(rosario)).toEqual({ method: "Transportista", carrier: "Andreani" });
    expect(zoneDeliveryFields(retiro)).toEqual({ method: "Retiro en el local", carrier: "" });
    expect([zoneCost(centro), zoneCost(retiro), zoneCost(zone("Sin costo"))]).toEqual([1800, 0, null]);
  });

  it("reads days and areas as a person writes them", () => {
    expect(weekdaysFromNames(["martes", "Jueves", "sáb", "sabado", 2])).toEqual([2, 4, 6]);
    expect([weekdaysText([2, 4, 6]), weekdaysText([]), weekdaysText([1, 2, 3, 4, 5]), weekdaysText([6])]).toEqual(["mar, jue y sáb", "Todos los días", "De lunes a viernes", "Los sábados"]);
    expect(parseAreas("Córdoba, nueva córdoba\nCordoba; Alta Córdoba")).toEqual(["Córdoba", "nueva córdoba", "Alta Córdoba"]);
  });

  it("tallies each zone's deliveries and lists the places no zone covers", () => {
    const tallies = zoneTallies([
      { zoneId: "Rosario", status: "delivered", scheduledOn: "2026-09-10", deliveredOn: "2026-09-10", costMinor: 4200 },
      { zoneId: "Rosario", status: "delivered", scheduledOn: "2026-09-12", deliveredOn: "2026-09-14", costMinor: 4200 },
      { zoneId: null, status: "pending", scheduledOn: "2026-09-20", costMinor: 0 },
    ], "2026-09-27");
    expect(tallies.get("Rosario")).toMatchObject({ total: 2, delivered: 2, onTime: 1, late: 1, cost: 8400 });
    expect(tallies.get("")).toMatchObject({ open: 1, late: 1 });
    const places = [{ zone: "Córdoba", address: "Colón 1, Córdoba" }, { zone: "Mendoza", address: "Mitre 1, Mendoza" }, { zone: "", address: "Las Heras 5, Mendoza" }, { zone: "", address: "San Juan 9" }];
    const grouped = placesByZone(places, zones);
    expect(grouped.get("Córdoba ciudad")).toEqual([{ name: "Córdoba", count: 1 }]);
    expect(grouped.get("Resto del país")).toEqual([{ name: "Mendoza", count: 2 }]);
    expect(placesByZone(places, [centro]).get("")).toEqual([{ name: "Mendoza", count: 2 }]);
  });
});
