import { beforeAll, describe, expect, it, vi } from "vitest";

// Runs route sheets (saved order, rescheduling, origin and Cozte's planRoute) against a local D1 bridge when COZTE_BRIDGE_TEST_URL is set.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./fx", () => ({ officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { USD: 1 }, source: "FXRatesAPI" }), quotesFor: () => ({}) }));

import { createCozteTools } from "./cozte-agent-tools";
import { loadDeliveries, recordSale, saveDelivery } from "./business";
import { saveZone } from "./delivery-zones";
import { loadRouteOrigin, saveRouteOrder, saveRouteOrigin } from "./delivery-routes";
import { dbBatch } from "./db";
import { businessToday } from "@/lib/business";

type Output = Record<string, unknown> & { ok?: boolean; done?: string[]; routes?: { zone: string; stops: { n: number; recipient: string; address: string }[]; mapsLinks: string[] }[]; carriers?: { carrier: string; packages: number }[]; toReschedule?: string[]; notFound?: string[] };

const today = businessToday("ARS");
const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!bridgeUrl)("delivery routes against D1", { timeout: 90_000 }, () => {
  const principal = { userId: "tester", organizationId: `org-test-${crypto.randomUUID()}`, role: "owner" as const };
  const tools = createCozteTools(principal, crypto.randomUUID());
  let call = 0;
  const run = async (name: keyof typeof tools, input: Record<string, unknown>) =>
    await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Output>)(input, { toolCallId: `call-${++call}` });
  let productId = "";
  const sell = async (customer: string, address: string, timeWindow = "", scheduledOn = tomorrow) => recordSale(principal, { soldOn: today, customer, items: [{ productId, quantity: 2 }], delivery: { address, timeWindow, scheduledOn } }, { source: "user", idempotencyKey: crypto.randomUUID() });

  beforeAll(async () => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    await run("readCosts", {});
    await dbBatch([{ sql: "UPDATE organizations SET currency='ARS', country='AR', city='Córdoba' WHERE id=?", params: [principal.organizationId] }]);
    const product = await run("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 });
    productId = (product.ids as Record<string, string>)?.product ?? "";
    await saveZone(principal, { name: "Córdoba", mode: "own", carrier: "Moto (Tomás)", areas: "Córdoba, Nueva Córdoba, Alta Córdoba" }, "user");
    await saveZone(principal, { name: "Interior", mode: "carrier", carrier: "Andreani", isFallback: true, costPerOrder: 5000 }, "user");
    await sell("Bar Tarde", "Colón 900, Alta Córdoba", "15 a 19");
    await sell("Kiosco Libre", "Obispo Trejo 300, Nueva Córdoba");
    await sell("Almacén Mañana", "Rondeau 200, Nueva Córdoba", "9 a 12");
    await sell("Lucía Paz", "Mitre 10, Mendoza");
  });

  it("keeps a route's order on its deliveries and drops it when one moves to another day", async () => {
    const list = (await loadDeliveries(principal, tomorrow.slice(0, 7))).filter((item) => item.scheduledOn === tomorrow && item.zoneName === "Córdoba");
    expect(list.every((item) => item.routePosition === null)).toBe(true);
    const ids = list.map((item) => item.id).reverse();
    expect((await saveRouteOrder(principal, ids, "user")).done).toEqual(["Orden de la ruta guardado (3 paradas)"]);
    const saved = await loadDeliveries(principal, tomorrow.slice(0, 7));
    expect(ids.map((id) => saved.find((item) => item.id === id)?.routePosition)).toEqual([0, 1, 2]);
    await saveDelivery(principal, { id: ids[0], scheduledOn: today }, "user");
    expect((await loadDeliveries(principal, tomorrow.slice(0, 7))).find((item) => item.id === ids[0])?.routePosition).toBeNull();
    await saveDelivery(principal, { id: ids[0], scheduledOn: tomorrow }, "user");
    await saveRouteOrigin(principal, "Duarte Quirós 100, Córdoba");
    expect(await loadRouteOrigin(principal)).toBe("Duarte Quirós 100, Córdoba");
  });

  it("lets Cozte arrange tomorrow's route, put someone first and hand back the map", async () => {
    const planned = await run("planRoute", { date: tomorrow });
    expect(planned.ok).toBe(true);
    expect(planned.routes?.[0].stops.map((stop) => stop.recipient)).toEqual(["Almacén Mañana", "Kiosco Libre", "Bar Tarde"]);
    expect(planned.routes?.[0].mapsLinks[0]).toContain("origin=Duarte%20Qui");
    expect(planned.routes?.[0].mapsLinks[0]).toContain("Argentina");
    expect(planned.carriers).toEqual([expect.objectContaining({ carrier: "Andreani", packages: 1 })]);
    const first = await run("planRoute", { date: tomorrow, first: ["bar tarde"], last: ["Almacén Mañana"], origin: "" });
    expect(first.routes?.[0].stops.map((stop) => stop.recipient)).toEqual(["Bar Tarde", "Kiosco Libre", "Almacén Mañana"]);
    expect(first.routes?.[0].mapsLinks[0]).not.toContain("origin=");
    const saved = (await loadDeliveries(principal, tomorrow.slice(0, 7))).filter((item) => item.zoneName === "Córdoba").sort((a, b) => (a.routePosition ?? 9) - (b.routePosition ?? 9));
    expect(saved.map((item) => item.recipient)).toEqual(["Bar Tarde", "Kiosco Libre", "Almacén Mañana"]);
    expect((await run("planRoute", { date: tomorrow, first: ["Nadie Nunca"] })).notFound).toEqual(["Nadie Nunca"]);
  });
});
