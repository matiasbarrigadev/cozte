import { beforeAll, describe, expect, it, vi } from "vitest";

// What customers owe, end to end against a local D1 bridge when COZTE_BRIDGE_TEST_URL is set: a sale recorded as owed,
// a deposit, collecting it from the panel or from Cozte, a corrected sale that stays paid, and the customer's debt.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./fx", async (original) => ({ ...(await original<typeof import("./fx")>()), officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { CLP: 950 }, source: "FXRatesAPI" as const }) }));

import { createCozteTools } from "./cozte-agent-tools";
import { loadBusinessView, recordSale, updateSale } from "./business";
import { loadCustomers } from "./customers";
import { dbBatch } from "./db";
import { loadState } from "./state";
import { businessToday, salePayment } from "@/lib/business";

type Output = Record<string, unknown> & { ok?: boolean; done?: string[]; ids?: Record<string, string>; owed?: { total: number; sales: number } };

describe.skipIf(!bridgeUrl)("what customers owe, against D1", { timeout: 90_000 }, () => {
  const principal = { userId: "tester", organizationId: `org-test-${crypto.randomUUID()}`, role: "owner" as const };
  const tools = createCozteTools(principal, crypto.randomUUID());
  let call = 0;
  const run = async (name: keyof typeof tools, input: Record<string, unknown>) =>
    await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Output>)(input, { toolCallId: `call-${++call}` });
  const today = () => businessToday("CLP");
  let productId = "";

  beforeAll(async () => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    await run("readCosts", {});
    await dbBatch([{ sql: "UPDATE organizations SET currency='CLP' WHERE id=?", params: [principal.organizationId] }]);
    expect((await run("saveProduct", { name: "Cartel", goodUnitsPerLot: 1, lotsPerMonth: 20, hoursPerLot: 3, salePrice: 30000 })).ok).toBe(true);
    productId = (await loadState(principal)).products[0].id;
  });

  it("records a sale as paid unless told otherwise, and lists the ones owed from any month", async () => {
    const paid = await recordSale(principal, { soldOn: today(), items: [{ productId, quantity: 1 }], paymentMethod: "cash" }, { source: "user", idempotencyKey: crypto.randomUUID() });
    expect(paid.sale).toMatchObject({ totalMinor: 30000, paidMinor: 30000, paymentMethod: "cash", paidOn: today() });
    // Owed, from an earlier month: it still shows up as owed this month.
    const earlier = `${String(Number(today().slice(0, 4)) - 1)}-12-15`;
    const owed = await recordSale(principal, { soldOn: earlier, items: [{ productId, quantity: 2 }], customer: "Librería Sur", paidAmount: 0 }, { source: "user", idempotencyKey: crypto.randomUUID() });
    expect(owed.sale).toMatchObject({ totalMinor: 60000, paidMinor: 0, paidOn: null });
    const deposit = await recordSale(principal, { soldOn: today(), items: [{ productId, quantity: 1 }], customer: "Librería Sur", paidAmount: 10000, paymentMethod: "transfer" }, { source: "user", idempotencyKey: crypto.randomUUID() });
    expect(salePayment(deposit.sale)).toEqual({ status: "partial", owedMinor: 20000 });
    const view = await loadBusinessView(principal, today().slice(0, 7));
    expect(view.owed.map((sale) => sale.id)).toEqual([owed.id, deposit.id]);
    expect(view.receivable).toEqual({ totalMinor: 80000, sales: 2, oldestOn: earlier });
    expect(view.sales.find((sale) => sale.id === paid.id)).toMatchObject({ paidMinor: 30000, paymentMethod: "cash" });
    const sur = (await loadCustomers(principal)).customers.find((customer) => customer.name === "Librería Sur");
    expect(sur?.stats.owed).toBe(80000);
  });

  it("collects a sale in full or in parts, and keeps a paid sale paid when it is corrected", async () => {
    const view = await loadBusinessView(principal, today().slice(0, 7));
    const [oldest, deposit] = view.owed;
    expect(await updateSale(principal, deposit.id, { paidAmount: 25000 }, "user")).toMatchObject({ paidMinor: 25000, paidOn: null });
    expect(await updateSale(principal, deposit.id, { markPaid: true, paymentMethod: "debit" }, "user")).toMatchObject({ paidMinor: 30000, paymentMethod: "debit", paidOn: today() });
    // A paid sale with one more unit stays paid at its new total.
    expect(await updateSale(principal, deposit.id, { items: [{ productId, quantity: 2 }] }, "user")).toMatchObject({ totalMinor: 60000, paidMinor: 60000 });
    // From Cozte: the owed sale is paid; the receipt says so and nothing is owed any more.
    const collected = await run("updateSale", { sale: oldest.id, markPaid: true, paymentMethod: "transfer" });
    expect(collected.done?.join(" ")).toMatch(/Cobrada en transferencia/);
    const after = await run("readBusiness", {});
    expect(after.owed).toMatchObject({ total: 0, sales: 0 });
  });

  it("records an owed sale from Cozte and says what is owed", async () => {
    const recorded = await run("recordSale", { items: [{ product: "Cartel", quantity: 1 }], customer: "Ana", paidAmount: 0 });
    expect(recorded.done?.join(" ")).toMatch(/Por cobrar: debe 30000 CLP/);
    expect((await run("readBusiness", {})).owed).toMatchObject({ total: 30000, sales: 1 });
  });
});
