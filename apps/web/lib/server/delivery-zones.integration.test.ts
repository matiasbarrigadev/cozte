import { beforeAll, describe, expect, it, vi } from "vitest";

// Runs delivery zones (assignment from the customer's address, cost and day, changes and Cozte's tools) against a local D1 bridge when COZTE_BRIDGE_TEST_URL is set.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./fx", () => ({ officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { USD: 1 }, source: "FXRatesAPI" }), quotesFor: () => ({}) }));

import { createCozteTools } from "./cozte-agent-tools";
import { loadBusinessView, loadDeliveries, recordSale, saveDelivery } from "./business";
import { saveCustomer, saveCustomerAddress } from "./customers";
import { archiveZone, loadZones, saveZone } from "./delivery-zones";
import { dbBatch } from "./db";
import { businessToday } from "@/lib/business";
import { summarizeMonth } from "@/lib/business-analytics";
import { buildBusinessView } from "@/lib/business";
import { loadState } from "./state";
import { loadBusinessRecords } from "./business";

type Output = Record<string, unknown> & { ok?: boolean; done?: string[]; error?: string; options?: string[]; zones?: { name: string; mode: string; customersIn?: string[] }[]; placesWithoutZone?: string[]; deliveries?: { id: string; zone?: string }[] };

const today = businessToday("ARS");
const month = today.slice(0, 7);
const addDays = (date: string, count: number) => new Date(Date.parse(`${date}T12:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!bridgeUrl)("delivery zones against D1", { timeout: 90_000 }, () => {
  const principal = { userId: "tester", organizationId: `org-test-${crypto.randomUUID()}`, role: "owner" as const };
  const tools = createCozteTools(principal, crypto.randomUUID());
  let call = 0;
  const run = async (name: keyof typeof tools, input: Record<string, unknown>) =>
    await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Output>)(input, { toolCallId: `call-${++call}` });
  let productId = "";
  let channelId = "";
  let centro = "";
  let resto = "";

  beforeAll(async () => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    await run("readCosts", {});
    await dbBatch([{ sql: "UPDATE organizations SET currency='ARS' WHERE id=?", params: [principal.organizationId] }]);
    const product = await run("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 });
    productId = (product.ids as Record<string, string>)?.product ?? "";
    expect((await run("saveMaterial", { name: "Soja", purchaseUnit: "kg", price: 1000 })).ok).toBe(true);
    expect((await run("saveRecipe", { product: "Tofu 300g", items: [{ material: "Soja", perLot: 30 }] })).ok).toBe(true);
    const channel = await run("saveChannel", { name: "Instagram", commissionPercent: 10, delivery: "Moto propia", deliveryCostPerOrder: 1500, unitsPerOrder: 3 });
    channelId = (channel.ids as Record<string, string>)?.channel ?? "";
    // A delivery already open before any zone exists.
    await recordSale(principal, { soldOn: today, channelId, customer: "Almacén Norte", items: [{ productId, quantity: 3 }], delivery: { address: "Colón 1450, Córdoba", scheduledOn: addDays(today, 1) } }, { source: "user", idempotencyKey: crypto.randomUUID() });
  });

  it("creates zones and puts the open deliveries without a zone into the one they fall in", async () => {
    const created = await saveZone(principal, { name: "Córdoba ciudad", mode: "own", carrier: "Moto (Tomás)", areas: "Córdoba, Nueva Córdoba", costPerOrder: 1800, weekdays: ["martes", "jueves", "sábado"] }, "user");
    centro = created.id;
    expect(created).toMatchObject({ created: true, assigned: 1 });
    expect(created.done).toEqual(["Zona creada: Córdoba ciudad (reparto propio)", "1 entrega abierta quedó en Córdoba ciudad"]);
    resto = (await saveZone(principal, { name: "Resto del país", mode: "carrier", carrier: "Andreani", costPerOrder: 5000, leadDays: 2, isFallback: true }, "user")).id;
    await expect(saveZone(principal, { name: "cordoba  CIUDAD" }, "user")).rejects.toThrow(/Ya hay una zona/);
    const zones = await loadZones(principal);
    expect(zones.map((zone) => [zone.name, zone.weekdays, zone.isFallback])).toEqual([["Córdoba ciudad", [2, 4, 6], false], ["Resto del país", [], true]]);
    const open = (await loadDeliveries(principal, month)).find((item) => item.sale.customer === "Almacén Norte")!;
    expect(open).toMatchObject({ zoneId: centro, zoneName: "Córdoba ciudad", method: "Moto propia", costMinor: 1500 });
  });

  it("gives a new sale's delivery the zone of the customer's address, with its day, carrier and cost", async () => {
    const sale = await recordSale(principal, { soldOn: today, channelId, customer: "Lucía Paz", items: [{ productId, quantity: 3 }], delivery: { address: "Mitre 10, Mendoza" } }, { source: "user", idempotencyKey: crypto.randomUUID() });
    expect(sale.sale.deliveryCostMinor).toBe(5000);
    const delivery = (await loadDeliveries(principal, month)).find((item) => item.saleId === sale.id)
      ?? (await loadDeliveries(principal, addDays(today, 2).slice(0, 7))).find((item) => item.saleId === sale.id)!;
    expect(delivery).toMatchObject({ zoneId: resto, method: "Transportista", carrier: "Andreani", scheduledOn: addDays(today, 2), costMinor: 5000 });
    // A cost given for the sale wins over the zone's.
    const priced = await recordSale(principal, { soldOn: today, channelId, customer: "Lucía Paz", deliveryCost: 900, items: [{ productId, quantity: 3 }] }, { source: "user", idempotencyKey: crypto.randomUUID() });
    expect(priced.sale.deliveryCostMinor).toBe(900);
  });

  it("moves a delivery to another zone by hand or by its new address, applying that zone's cost", async () => {
    const sale = await recordSale(principal, { soldOn: today, channelId, customer: "Bar Sur", items: [{ productId, quantity: 3 }], delivery: { address: "San Martín 5, Salta", scheduledOn: today } }, { source: "user", idempotencyKey: crypto.randomUUID() });
    const find = async () => (await loadDeliveries(principal, month)).find((item) => item.saleId === sale.id)!;
    expect((await find()).zoneId).toBe(resto);
    const moved = await saveDelivery(principal, { id: (await find()).id, address: "Obispo Trejo 300, Nueva Córdoba, Córdoba" }, "user");
    expect(moved.done).toContain("Zona: Córdoba ciudad (costo de la zona aplicado)");
    expect(await find()).toMatchObject({ zoneId: centro, carrier: "Moto (Tomás)", costMinor: 1800 });
    await saveDelivery(principal, { id: (await find()).id, zoneId: null }, "user");
    expect((await find()).zoneId).toBeNull();
    // Analysis: each zone's deliveries and cost in the month.
    const [state, records] = await Promise.all([loadState(principal), loadBusinessRecords(principal, month)]);
    const summary = summarizeMonth(buildBusinessView(state, records, month), month, today);
    expect(summary.byZone.find((zone) => zone.key === centro)).toMatchObject({ name: "Córdoba ciudad", total: 1, cost: 1500 });
    expect(summary.byZone.find((zone) => zone.key === "")).toMatchObject({ name: "Sin zona" });
    expect(summary.byCarrier.map((carrier) => carrier.name)).toEqual(expect.arrayContaining(["Andreani"]));
    expect((await loadBusinessView(principal, month)).sales.find((item) => item.id === sale.id)?.delivery?.zoneId).toBeNull();
  });

  it("lets Cozte read zones with the places without one, create and change a zone and move a delivery", async () => {
    const customer = await saveCustomer(principal, { name: "Librería Funes" }, "user");
    await saveCustomerAddress(principal, { customerId: customer.id, address: "Hipólito Yrigoyen 900, Funes" }, "user");
    await archiveZone(principal, resto);
    const read = await run("readDeliveries", { status: "all" });
    expect(read.zones?.map((zone) => zone.name)).toEqual(["Córdoba ciudad"]);
    expect(read.placesWithoutZone).toEqual(expect.arrayContaining(["Funes (1)", "Mendoza (1)"]));
    // An open delivery the fallback zone holds moves to a new zone that covers its place.
    const general = await saveZone(principal, { name: "Todo el país", mode: "carrier", carrier: "Correo", costPerOrder: 6000, isFallback: true }, "user");
    const held = await recordSale(principal, { soldOn: today, channelId, customer: "Kiosco Oroño", items: [{ productId, quantity: 3 }], delivery: { address: "Oroño 100, Rosario" } }, { source: "user", idempotencyKey: crypto.randomUUID() });
    expect(held.sale.delivery?.zoneId).toBe(general.id);
    const created = await run("saveDeliveryZone", { name: "Rosario y Funes", mode: "carrier", carrier: "Vía Cargo", areas: ["Rosario", "Funes"], costPerOrder: 4200, weekdays: ["lunes", "jueves"], leadDays: 1 });
    expect(created).toMatchObject({ ok: true, done: ["Zona creada: Rosario y Funes (transportista)", "1 entrega abierta quedó en Rosario y Funes"] });
    expect((await loadDeliveries(principal, month)).find((item) => item.saleId === held.id)).toMatchObject({ zoneName: "Rosario y Funes", carrier: "Vía Cargo", method: "Transportista", costMinor: 6000 });
    expect(created.zone).toMatchObject({ mode: "Transportista", days: "lun y jue", costPerOrder: 4200 });
    const changed = await run("saveDeliveryZone", { zone: "rosario y funes", costPerOrder: 4500 });
    expect(changed).toMatchObject({ ok: true, done: ["Zona actualizada: Rosario y Funes"] });
    expect((await loadZones(principal)).find((zone) => zone.name === "Rosario y Funes")).toMatchObject({ costPerOrderMinor: 4500, carrier: "Vía Cargo", weekdays: [1, 4] });
    const target = (await loadDeliveries(principal, month)).find((item) => item.sale.customer === "Almacén Norte")!;
    const moved = await run("updateDelivery", { delivery: target.id, zone: "Rosario y Funes" });
    expect(moved.ok).toBe(true);
    expect((await loadDeliveries(principal, month)).find((item) => item.id === target.id)).toMatchObject({ zoneName: "Rosario y Funes", costMinor: 4500 });
    expect((await run("updateDelivery", { delivery: target.id, zone: "Marte" })).ok).toBe(false);
  });
});
