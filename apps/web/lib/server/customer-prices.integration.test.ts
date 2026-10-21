import { beforeAll, describe, expect, it, vi } from "vitest";

// Price agreements with customers, end to end against a local D1 bridge when COZTE_BRIDGE_TEST_URL is set: a customer's
// usual channel, a share below its price and fixed prices, used by every sale made for them, from the panel or Cozte.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./fx", async (original) => ({ ...(await original<typeof import("./fx")>()), officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { CLP: 950 }, source: "FXRatesAPI" as const }) }));

import { createCozteTools } from "./cozte-agent-tools";
import { recordSale, saveChannel } from "./business";
import { loadCustomers, saveCustomer } from "./customers";
import { dbBatch } from "./db";
import { loadState } from "./state";
import { businessToday } from "@/lib/business";
import { directoryFromCustomers } from "@/lib/customers";

type Output = Record<string, unknown> & { ok?: boolean; done?: string[]; pricing?: { channel: string | null; adjustmentPercent: number; agreedPrices: { product: string; unitPrice: number }[] } };

describe.skipIf(!bridgeUrl)("customer price agreements against D1", { timeout: 90_000 }, () => {
  const principal = { userId: "tester", organizationId: `org-test-${crypto.randomUUID()}`, role: "owner" as const };
  const tools = createCozteTools(principal, crypto.randomUUID());
  let call = 0;
  const run = async (name: keyof typeof tools, input: Record<string, unknown>) =>
    await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Output>)(input, { toolCallId: `call-${++call}` });
  const today = () => businessToday("CLP");
  let small = "";
  let large = "";
  let wholesale = "";

  beforeAll(async () => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    await run("readCosts", {});
    await dbBatch([{ sql: "UPDATE organizations SET currency='CLP' WHERE id=?", params: [principal.organizationId] }]);
    expect((await run("saveProduct", { name: "Cartel chico", goodUnitsPerLot: 1, lotsPerMonth: 20, hoursPerLot: 3, salePrice: 30000 })).ok).toBe(true);
    expect((await run("saveProduct", { name: "Cartel grande", goodUnitsPerLot: 1, lotsPerMonth: 10, hoursPerLot: 5, salePrice: 50000 })).ok).toBe(true);
    const products = (await loadState(principal)).products;
    small = products.find((product) => product.name === "Cartel chico")!.id;
    large = products.find((product) => product.name === "Cartel grande")!.id;
    wholesale = (await saveChannel(principal, { name: "Mayorista", priceAdjustmentPercent: -20 })).id;
  });

  it("keeps a customer's channel and agreement, and lists them for the forms", async () => {
    const saved = await saveCustomer(principal, { name: "Vida Sana", defaultChannelId: wholesale, priceAdjustmentPercent: -5, prices: [{ productId: small, unitPrice: 20000 }] }, "user");
    expect(saved.done).toEqual(["Cliente creado: Vida Sana", "Canal habitual: Mayorista", "Precio -5 % sobre el del canal", "1 precio acordado"]);
    const { customers } = await loadCustomers(principal);
    const entry = directoryFromCustomers(customers, { customers: [], recipients: [], addresses: [], carriers: [] }).customers.find((item) => item.name === "Vida Sana");
    expect(entry).toMatchObject({ id: saved.id, defaultChannelId: wholesale, priceAdjustmentBps: -500, prices: [{ productId: small, unitPriceMinor: 20000 }] });
    await expect(saveCustomer(principal, { id: saved.id, defaultChannelId: "no-existe" }, "user")).rejects.toThrow(/canal no existe/);
  });

  it("prices a sale for the customer with their channel and agreement, unless a price is given", async () => {
    const sale = await recordSale(principal, { soldOn: today(), customer: "vida sana", items: [{ productId: small, quantity: 2 }, { productId: large, quantity: 1 }] }, { source: "user", idempotencyKey: crypto.randomUUID() });
    expect(sale.sale.channelName).toBe("Mayorista");
    // The small sign at its agreed price; the large one at the wholesale price (−20 %) less their 5 %: 50 000 × 0.8 × 0.95.
    expect(sale.sale.items.map((item) => [item.productId, item.unitPriceMinor])).toEqual([[small, 20000], [large, 38000]]);
    expect(sale.agreedPrices).toBe(true);
    const typed = await recordSale(principal, { soldOn: today(), customer: "Vida Sana", channelId: null, items: [{ productId: small, quantity: 1, unitPrice: 25000 }] }, { source: "user", idempotencyKey: crypto.randomUUID() });
    expect(typed.sale).toMatchObject({ channelName: "Venta directa", totalMinor: 25000 });
    const other = await recordSale(principal, { soldOn: today(), customer: "Otro cliente", items: [{ productId: small, quantity: 1 }] }, { source: "user", idempotencyKey: crypto.randomUUID() });
    expect(other.sale).toMatchObject({ channelName: "Venta directa", totalMinor: 30000 });
  });

  it("lets Cozte save an agreement and sell with it", async () => {
    const saved = await run("saveCustomer", { name: "Café Central", channel: "Mayorista", prices: [{ product: "Cartel grande", unitPrice: 35000 }] });
    expect(saved.done).toEqual(expect.arrayContaining(["Canal habitual: Mayorista", "1 precio acordado"]));
    expect((await run("readCustomers", { customer: "Café Central" })).pricing).toEqual({ channel: "Mayorista", adjustmentPercent: 0, agreedPrices: [{ product: "Cartel grande", unitPrice: 35000 }] });
    const sold = await run("recordSale", { customer: "Café Central", items: [{ product: "Cartel grande", quantity: 2 }] });
    expect(sold.done?.join(" ")).toMatch(/por Mayorista, total 70000 CLP/);
    expect(sold.done).toContain("Con los precios acordados con Café Central");
  });
});
