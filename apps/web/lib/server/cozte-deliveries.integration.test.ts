import { beforeAll, describe, expect, it, vi } from "vitest";

// Runs sales corrections and deliveries (Cozte's tools and the server functions) against a local D1 bridge when COZTE_BRIDGE_TEST_URL is set.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./fx", () => ({ officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { USD: 1 }, source: "FXRatesAPI" }), quotesFor: () => ({}) }));

import { createCozteTools } from "./cozte-agent-tools";
import { archiveRecord, loadBusinessView, loadDeliveries } from "./business";
import { dbBatch } from "./db";
import { businessToday } from "@/lib/business";

type Output = Record<string, unknown> & { ok?: boolean; done?: string[]; error?: string; ids?: Record<string, string>; delivery?: { id: string; status?: string; date?: string; created?: boolean }; deliveries?: { id: string; date: string; status: string; cost: number; daysFromToday: number }[]; sale?: Record<string, unknown> };

const today = businessToday("ARS");
const shift = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!bridgeUrl)("sales corrections and deliveries against D1", { timeout: 90_000 }, () => {
  const principal = { userId: "tester", organizationId: `org-test-${crypto.randomUUID()}`, role: "owner" as const };
  const tools = createCozteTools(principal, crypto.randomUUID());
  let call = 0;
  const run = async (name: keyof typeof tools, input: Record<string, unknown>) =>
    await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Output>)(input, { toolCallId: `call-${++call}` });
  let deliveredSale = "";
  let upcomingSale = "";
  let pickupSale = "";

  beforeAll(async () => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    await run("readCosts", {});
    await dbBatch([{ sql: "UPDATE organizations SET currency='ARS' WHERE id=?", params: [principal.organizationId] }]);
    expect((await run("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 })).ok).toBe(true);
    expect((await run("saveMaterial", { name: "Soja", purchaseUnit: "kg", price: 1000 })).ok).toBe(true);
    expect((await run("saveRecipe", { product: "Tofu 300g", items: [{ material: "Soja", perLot: 30 }] })).ok).toBe(true);
    expect((await run("saveChannel", { name: "Instagram", commissionPercent: 10, delivery: "Moto propia", deliveryCostPerOrder: 1500, unitsPerOrder: 3 })).ok).toBe(true);
    expect((await run("saveChannel", { name: "Feria", commissionPercent: 0, delivery: "En mano" })).ok).toBe(true);
  });

  it("creates the delivery of a sale by a channel that delivers, and none for a pickup sale", async () => {
    const past = await run("recordSale", { date: shift(-3), channel: "Instagram", items: [{ product: "Tofu 300g", quantity: 3 }], customer: "Ana" });
    expect(past.delivery).toMatchObject({ status: "delivered", date: shift(-3) });
    deliveredSale = past.ids!.sale;
    const upcoming = await run("recordSale", { channel: "Instagram", items: [{ product: "Tofu 300g", quantity: 6 }], customer: "Bruno", delivery: { date: shift(2), address: "Belgrano 88", timeWindow: "9 a 13" } });
    expect(upcoming.delivery).toMatchObject({ status: "pending", date: shift(2) });
    upcomingSale = upcoming.ids!.sale;
    const pickup = await run("recordSale", { channel: "Feria", items: [{ product: "Tofu 300g", quantity: 10 }] });
    expect(pickup.delivery).toBeUndefined();
    pickupSale = pickup.ids!.sale;
  });

  it("lists deliveries closest to today first and filters the open ones", async () => {
    const all = await run("readDeliveries", {});
    expect(all.deliveries?.map((item) => item.daysFromToday)).toEqual([2, -3]);
    const open = await run("readDeliveries", { status: "open" });
    expect(open.deliveries).toHaveLength(1);
    expect(open.deliveries?.[0]).toMatchObject({ status: "Pendiente", cost: 1500 });
  });

  it("changes a delivery, stamps today when delivered, and moves its cost to the sale and the month", async () => {
    const [open] = (await loadDeliveries(principal, today.slice(0, 7))).filter((item) => item.saleId === upcomingSale);
    const failed = await run("updateDelivery", { delivery: open.id, status: "failed", note: "No había nadie" });
    expect(failed.done?.[0]).toContain("No se pudo entregar");
    const rescheduled = await run("updateDelivery", { delivery: open.id, date: shift(4), status: "pending", cost: 2200 });
    expect(rescheduled.done).toEqual(expect.arrayContaining([expect.stringContaining(shift(4)), "Costo de entrega actualizado"]));
    const delivered = await run("updateDelivery", { delivery: open.id, status: "delivered" });
    expect(delivered.ok).toBe(true);
    const [after] = (await loadDeliveries(principal, shift(4).slice(0, 7))).filter((item) => item.id === open.id);
    expect(after).toMatchObject({ status: "delivered", deliveredOn: today, costMinor: 2200, note: "No había nadie" });
    const view = await loadBusinessView(principal, today.slice(0, 7));
    expect(view.sales.find((sale) => sale.id === upcomingSale)?.deliveryCostMinor).toBe(2200);
    expect(view.sales.find((sale) => sale.id === upcomingSale)?.delivery?.status).toBe("delivered");
  });

  it("creates a delivery for a sale that had none and refuses a second one", async () => {
    const created = await run("updateDelivery", { sale: pickupSale, date: shift(1), address: "Mitre 10" });
    expect(created.delivery).toMatchObject({ created: true });
    const again = await run("updateDelivery", { sale: pickupSale, date: shift(1) });
    expect(again).toMatchObject({ ok: false, error: expect.stringContaining("ya tiene una entrega") });
  });

  it("corrects a sale keeping the price charged, and moves it to another channel", async () => {
    const more = await run("updateSale", { sale: deliveredSale, items: [{ product: "Tofu 300g", quantity: 5 }] });
    expect(more.sale).toMatchObject({ total: 10_000, sellingCost: 1_000, deliveryCost: 1_500 });
    const moved = await run("updateSale", { sale: deliveredSale, channel: "Feria", customer: "Ana López" });
    expect(moved.sale).toMatchObject({ channel: "Feria", total: 10_000, sellingCost: 0, deliveryCost: 0 });
    const direct = await run("updateSale", { sale: deliveredSale, channel: "directa" });
    expect(direct.sale).toMatchObject({ channel: "Venta directa" });
  });

  it("voiding a sale takes its delivery with it", async () => {
    await archiveRecord(principal, "sale", pickupSale);
    const list = await loadDeliveries(principal, today.slice(0, 7));
    expect(list.some((item) => item.saleId === pickupSale)).toBe(false);
  });
});
