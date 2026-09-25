import { beforeAll, describe, expect, it, vi } from "vitest";

// Runs the business tools (channels, purchases, sales, month) against a local D1 bridge when COZTE_BRIDGE_TEST_URL is set.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./fx", () => ({ officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { USD: 1 }, source: "FXRatesAPI" }), quotesFor: () => ({}) }));

import { createCozteTools } from "./cozte-agent-tools";
import { dbBatch, dbQuery } from "./db";
import { loadState } from "./state";

type Output = Record<string, unknown> & { ok?: boolean; done?: string[]; ids?: Record<string, string> };

describe.skipIf(!bridgeUrl)("Cozte business tools against D1", { timeout: 60_000 }, () => {
  const principal = { userId: "tester", organizationId: `org-test-${crypto.randomUUID()}`, role: "owner" as const };
  const tools = createCozteTools(principal, crypto.randomUUID());
  const month = new Date().toISOString().slice(0, 7);
  let call = 0;
  const run = async (name: keyof typeof tools, input: Record<string, unknown>) =>
    await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Output>)(input, { toolCallId: `call-${++call}` });

  beforeAll(async () => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    await run("readCosts", {});
    await dbBatch([{ sql: "UPDATE organizations SET currency='ARS' WHERE id=?", params: [principal.organizationId] }]);
    expect((await run("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 })).ok).toBe(true);
    expect((await run("saveMaterial", { name: "Soja", purchaseUnit: "kg", price: 1000 })).ok).toBe(true);
    expect((await run("saveRecipe", { product: "Tofu 300g", items: [{ material: "Soja", perLot: 30 }] })).ok).toBe(true);
    expect((await run("saveExpense", { name: "Luz", amount: 200000, splitBy: "hours" })).ok).toBe(true);
  });

  it("keeps company expenses by area out of the unit cost", async () => {
    const admin = await run("saveExpense", { name: "Contador", amount: 100000, area: "admin" });
    expect(admin).toMatchObject({ ok: true, done: [expect.stringContaining("Administración")] });
    const state = await loadState(principal);
    expect(state.expenses.find((item) => item.name === "Contador")?.area).toBe("admin");
    // 300 soy + 100 electricity per unit; the accountant is not in the product.
    expect((admin.costs as { unitCost: number }[])[0].unitCost).toBe(400);
  });

  it("creates a channel and reports what each unit leaves in it", async () => {
    const channel = await run("saveChannel", { name: "Instagram", delivery: "Moto propia", commissionPercent: 10, deliveryCostPerOrder: 400, unitsPerOrder: 4 });
    expect(channel).toMatchObject({ ok: true, perUnit: [{ product: "Tofu 300g", price: 2000, productionCost: 400, sellingCost: 200, deliveryCost: 100, leftPerUnit: 1300 }] });
    // Saving the same name again updates it instead of failing.
    expect(await run("saveChannel", { name: "Instagram", commissionPercent: 12 })).toMatchObject({ ok: true, done: ["Canal Instagram actualizado"] });
  });

  it("classifies purchases: supplies update their price, investments spread, fixed payments link", async () => {
    const soy = await run("recordPurchase", { description: "Soja 50 kg", supplier: "CEAPE", total: 60000, kind: "material", material: "Soja", quantity: 50 });
    expect(soy).toMatchObject({ ok: true, done: expect.arrayContaining([expect.stringContaining("Precio de Soja actualizado a 1200")]) });
    expect((await loadState(principal)).materials.find((item) => item.name === "Soja")?.priceMinor).toBe(1200);
    expect(await run("recordPurchase", { description: "Cinta de embalaje", total: 3500, kind: "expense", area: "delivery" })).toMatchObject({ ok: true });
    expect(await run("recordPurchase", { description: "Balanza digital", total: 45000, kind: "investment", area: "production", usefulLifeMonths: 60 })).toMatchObject({ ok: true, monthlyShare: 750 });
    expect(await run("recordPurchase", { description: "Pago de luz", total: 230000, kind: "fixed_payment", expense: "Luz" })).toMatchObject({ ok: true });
    // Missing facts are asked, never guessed.
    expect(await run("recordPurchase", { description: "Taladro", total: 80000, kind: "investment" })).toMatchObject({ ok: false, needs: expect.arrayContaining([expect.stringContaining("meses"), expect.stringContaining("área")]) });
  });

  it("records a sale with the channel rules and reads the month", async () => {
    const sale = await run("recordSale", { channel: "Instagram", items: [{ product: "Tofu 300g", quantity: 12 }] });
    // 12 × 2000 = 24 000; commission 12 % = 2 880; one delivery 400; soy now 360 per unit.
    expect(sale).toMatchObject({ ok: true, sale: { total: 24000, sellingCost: 2880, deliveryCost: 400, materialsAndLaborOfItems: 4320 } });
    const monthView = await run("readBusiness", { month });
    expect(monthView).toMatchObject({ ok: true, result: { sales: 1, revenue: 24000, oneOffTotal: 3500, purchasedMaterials: 60000, fixedPayments: [{ expenseName: "Luz", paid: 230000 }] } });
    const saleId = sale.ids!.sale;
    expect(await run("voidRecord", { kind: "sale", id: saleId, reason: "Cargada dos veces" })).toMatchObject({ ok: true });
    const rows = await dbQuery<{ archived_at: string | null }>("SELECT archived_at FROM sales WHERE id=?", [saleId]);
    expect(rows[0].archived_at).not.toBeNull();
    expect(await run("readBusiness", { month })).toMatchObject({ result: { sales: 0 } });
  });

  it("leaves a workshop investment out of the unit cost until the person decides, then applies the choice", async () => {
    const drill = await run("recordPurchase", { description: "Prensa de tofu", total: 120000, kind: "investment", area: "production", usefulLifeMonths: 60 });
    expect(drill).toMatchObject({ ok: true, includedInUnitCost: false, note: expect.stringContaining("asesórala") });
    const before = (await loadState(principal)).investments!.find((item) => item.name === "Prensa de tofu")!;
    expect(before.includeInUnitCost).toBe(false);
    const decided = await run("setInvestmentCost", { investment: "Prensa de tofu", includeInUnitCost: true });
    // 120 000 over 60 months = 2 000 a month, over 2 000 units = 1 more per unit.
    const tofu = (decided.costs as { product: string; unitCost: number; unitCostBefore: number }[]).find((item) => item.product === "Tofu 300g")!;
    expect(tofu.unitCost - tofu.unitCostBefore).toBe(1);
    expect(await run("setInvestmentCost", { investment: "Prensa de tofu", includeInUnitCost: true })).toMatchObject({ ok: true, unchanged: true });
    // Voiding it takes it back out of the cost first.
    const purchaseId = drill.ids!.purchase;
    expect(await run("voidRecord", { kind: "purchase", id: purchaseId, reason: "Prueba" })).toMatchObject({ ok: true });
    const after = await loadState(principal);
    expect(after.investments!.some((item) => item.id === purchaseId)).toBe(false);
    const snapshots = await dbQuery<{ context_json: string }>("SELECT context_json FROM cost_snapshots WHERE organization_id=? ORDER BY created_at DESC LIMIT 1", [principal.organizationId]);
    expect(snapshots[0].context_json).not.toContain("investment:");
  });
});
