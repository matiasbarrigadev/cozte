import { beforeAll, describe, expect, it, vi } from "vitest";

// Accounting rules end to end against a local D1 bridge when COZTE_BRIDGE_TEST_URL is set: money with cents in a
// currency that uses them, expenses continuing into a new period, a late sale costed at its own date and a purchase in
// another currency converted at its date's rate.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
// Today's rates are fixed; the rates kept for past days are read from D1 as in production.
vi.mock("./fx", async (original) => ({ ...(await original<typeof import("./fx")>()), officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { CLP: 950, ARS: 1000, EUR: 0.9, BRL: 5 }, source: "FXRatesAPI" as const }) }));

import { createCozteTools } from "./cozte-agent-tools";
import { loadBusinessView, recordPurchase, recordSale } from "./business";
import { commitMutation } from "./mutations";
import { dbBatch, dbQuery } from "./db";
import { loadState } from "./state";
import { businessToday } from "@/lib/business";
import { calculateCosts } from "@/lib/domain";

type Output = Record<string, unknown> & { ok?: boolean; ids?: Record<string, string> };

const organization = (currency: string) => {
  const principal = { userId: "tester", organizationId: `org-test-${crypto.randomUUID()}`, role: "owner" as const };
  const tools = createCozteTools(principal, crypto.randomUUID());
  let call = 0;
  const run = async (name: keyof typeof tools, input: Record<string, unknown>) =>
    await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Output>)(input, { toolCallId: `call-${++call}` });
  const setUp = async () => {
    await run("readCosts", {});
    await dbBatch([{ sql: "UPDATE organizations SET currency=? WHERE id=?", params: [currency, principal.organizationId] }]);
  };
  return { principal, run, setUp };
};

describe.skipIf(!bridgeUrl)("accounting rules against D1", { timeout: 90_000 }, () => {
  beforeAll(() => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
  });

  it("keeps cents from the recipe to the sale and the month in a currency that uses them", async () => {
    const { principal, run, setUp } = organization("USD");
    await setUp();
    expect((await run("saveProduct", { name: "Jabón", goodUnitsPerLot: 40, lotsPerMonth: 30, hoursPerLot: 2, salePrice: 4.99, directLaborPerLot: 12.5 })).ok).toBe(true);
    expect((await run("saveMaterial", { name: "Etiqueta", purchaseUnit: "unidad", price: 0.045 })).ok).toBe(true);
    expect((await run("saveRecipe", { product: "Jabón", items: [{ material: "Etiqueta", perLot: 40 }] })).ok).toBe(true);
    const state = await loadState(principal);
    expect(state.products[0].salePriceMinor).toBe(4.99);
    expect(state.materials[0].priceMinor).toBe(0.045);
    // (40 × 0.045 + 12.50) ÷ 40 = 0.3575 → 0.36 a soap, not 0.
    expect(calculateCosts(state)[0].unitMinor).toBe(0.36);
    const sale = await recordSale(principal, { soldOn: businessToday("USD"), items: [{ productId: state.products[0].id, quantity: 3 }], deliveryCost: 2.75 }, { source: "user", idempotencyKey: crypto.randomUUID() });
    expect(sale.sale).toMatchObject({ totalMinor: 14.97, deliveryCostMinor: 2.75, variableCostMinor: 1.08 });
    const view = await loadBusinessView(principal, businessToday("USD").slice(0, 7));
    expect(view.sales[0]).toMatchObject({ totalMinor: 14.97, deliveryCostMinor: 2.75 });
    expect(view.result.contribution).toBe(11.14);
  });

  it("carries the monthly expenses into a new period instead of dropping them", async () => {
    const { principal, run, setUp } = organization("CLP");
    await setUp();
    expect((await run("saveProduct", { name: "Pan", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 4, salePrice: 1500 })).ok).toBe(true);
    for (const [name, amount] of [["Arriendo", 400_000], ["Luz", 120_000], ["Gas", 80_000]] as const) expect((await run("saveExpense", { name, amount, splitBy: "hours" })).ok).toBe(true);
    const before = await loadState(principal);
    const next = `${Number(before.activePeriod.slice(0, 4)) + 1}-01`;
    const confirm = { action: "create-expense", name: "Seguro", period: next, amount: 30_000, currency: "CLP", allocationBasis: "hours", shares: {}, source: "Póliza", acknowledgeImpact: true } as const;
    await commitMutation(principal, { ...confirm, expectedRevision: before.revision, idempotencyKey: crypto.randomUUID() }, { source: "user" });
    const after = await loadState(principal);
    expect(after.activePeriod).toBe(next);
    expect(after.expenses.filter((item) => item.period === next).map((item) => [item.name, item.amountMinor]).sort()).toEqual([["Arriendo", 400_000], ["Gas", 80_000], ["Luz", 120_000], ["Seguro", 30_000]]);
    expect(after.expenses.filter((item) => item.period === before.activePeriod)).toHaveLength(3);
    // Every expense continuing into the new period has its own first version, as a new expense does.
    const versions = await dbQuery<{ count: number }>("SELECT count(*) AS count FROM shared_expense_versions v JOIN shared_expenses e ON e.id=v.expense_id WHERE e.organization_id=? AND e.period=?", [principal.organizationId, next]);
    expect(versions[0].count).toBe(4);
  });

  it("costs a sale typed in late with the cost of the day it happened", async () => {
    const { principal, run, setUp } = organization("CLP");
    await setUp();
    expect((await run("saveProduct", { name: "Queque", goodUnitsPerLot: 10, lotsPerMonth: 8, hoursPerLot: 1, salePrice: 6000 })).ok).toBe(true);
    expect((await run("saveMaterial", { name: "Harina", purchaseUnit: "kg", price: 1000 })).ok).toBe(true);
    expect((await run("saveRecipe", { product: "Queque", items: [{ material: "Harina", perLot: 10 }] })).ok).toBe(true);
    // Those costs were set ten days ago; flour went up today.
    await dbBatch([{ sql: "UPDATE cost_snapshots SET created_at=datetime('now', '-10 days') WHERE organization_id=?", params: [principal.organizationId] }]);
    expect((await run("saveMaterial", { material: "Harina", price: 2000 })).ok).toBe(true);
    const state = await loadState(principal);
    const product = state.products[0].id;
    const today = businessToday("CLP");
    const fiveDaysAgo = new Date(Date.parse(`${today}T12:00:00Z`) - 5 * 86_400_000).toISOString().slice(0, 10);
    const late = await recordSale(principal, { soldOn: fiveDaysAgo, items: [{ productId: product, quantity: 1 }] }, { source: "user", idempotencyKey: crypto.randomUUID() });
    const now = await recordSale(principal, { soldOn: today, items: [{ productId: product, quantity: 1 }] }, { source: "user", idempotencyKey: crypto.randomUUID() });
    // 10 kg × 1 000 ÷ 10 = 1 000 a cake five days ago; 2 000 today.
    expect(late.sale.items[0].unitVariableCostMinor).toBe(1000);
    expect(now.sale.items[0].unitVariableCostMinor).toBe(2000);
  });

  it("converts a purchase in another currency at the rate of its own date, or the invoice's", async () => {
    const { principal, setUp } = organization("CLP");
    await setUp();
    const day = "2025-03-14";
    await dbBatch([{ sql: "INSERT OR REPLACE INTO fx_publications (hour_slot, as_of, rates_json, source) VALUES (?, ?, ?, 'FXRatesAPI')", params: [`${day}T15`, `${day}T15:00:00.000Z`, JSON.stringify({ CLP: 900, ARS: 800, EUR: 0.92, BRL: 5.5 })] }]);
    const dated = await recordPurchase(principal, { purchasedOn: day, description: "Moldes importados", amount: 10, currency: "USD", kind: "expense", area: "production" }, { source: "user", idempotencyKey: crypto.randomUUID() });
    expect(dated.purchase.amountMinor).toBe(9000);
    const invoiced = await recordPurchase(principal, { purchasedOn: day, description: "Moldes con factura", amount: 10, currency: "USD", exchangeRate: 912.5, kind: "expense", area: "production" }, { source: "user", idempotencyKey: crypto.randomUUID() });
    expect(invoiced.purchase.amountMinor).toBe(9125);
    // A day with no rate kept anywhere near: today's rate.
    const old = await recordPurchase(principal, { purchasedOn: "2019-06-01", description: "Molde antiguo", amount: 10, currency: "USD", kind: "expense", area: "production" }, { source: "user", idempotencyKey: crypto.randomUUID() });
    expect(old.purchase.amountMinor).toBe(9500);
  });
});
