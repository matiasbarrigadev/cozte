import { beforeAll, describe, expect, it, vi } from "vitest";

// Runs the break-even (each expense's behavior, the sales mix and Cozte's tools) against a local D1 bridge when COZTE_BRIDGE_TEST_URL is set.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./fx", () => ({ officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { USD: 1 }, source: "FXRatesAPI" }), quotesFor: () => ({}) }));

import { createCozteTools } from "./cozte-agent-tools";
import { loadBreakEven, loadSalesMix, saveSalesMix } from "./break-even";
import { commitMutation } from "./mutations";
import { dbBatch } from "./db";
import { loadState } from "./state";

type Product = { product: string; variableCostPerUnit: number; leavesPerUnit: number; unitsToBreakEven: number; unitsForTarget?: number; soldThisMonth: number };
type Output = Record<string, unknown> & { ok?: boolean; done?: string[]; error?: string; options?: string[]; products?: Product[]; breakEven?: { totalUnits: number; totalRevenue: number } | null; target?: { totalUnits: number } | null; fixed?: { total: number; items: { name: string; behavior: string }[] }; assumptions?: string[]; suggestions?: string[] };

describe.skipIf(!bridgeUrl)("break-even against D1", { timeout: 90_000 }, () => {
  const principal = { userId: "tester", organizationId: `org-test-${crypto.randomUUID()}`, role: "owner" as const };
  const tools = createCozteTools(principal, crypto.randomUUID());
  let call = 0;
  const run = async (name: keyof typeof tools, input: Record<string, unknown>) =>
    await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Output>)(input, { toolCallId: `call-${++call}` });

  beforeAll(async () => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    await run("readCosts", {});
    await dbBatch([{ sql: "UPDATE organizations SET currency='ARS' WHERE id=?", params: [principal.organizationId] }]);
    expect((await run("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 })).ok).toBe(true);
    expect((await run("saveProduct", { name: "Tofu 500g", goodUnitsPerLot: 100, lotsPerMonth: 10, hoursPerLot: 5, salePrice: 3000 })).ok).toBe(true);
    expect((await run("saveMaterial", { name: "Soja", purchaseUnit: "kg", price: 1000 })).ok).toBe(true);
    expect((await run("saveRecipe", { product: "Tofu 300g", items: [{ material: "Soja", perUnit: 0.3 }] })).ok).toBe(true);
    expect((await run("saveRecipe", { product: "Tofu 500g", items: [{ material: "Soja", perUnit: 0.5 }] })).ok).toBe(true);
    for (const [name, amount] of [["Alquiler", 200_000], ["Sueldo", 800_000], ["Gas de la garrafa", 60_000], ["Envases", 30_000]] as const) expect((await run("saveExpense", { name, amount, splitBy: "hours" })).ok).toBe(true);
  });

  it("starts with every expense fixed, and says which ones usually grow with production", async () => {
    const result = await run("readBreakEven", {});
    expect(result.fixed?.total).toBe(1_090_000);
    expect(result.assumptions).toContain("Envases: fijo (sin revisar)");
    expect(result.suggestions?.join(" ")).toMatch(/Envases/);
    expect(result.products?.map((product) => [product.product, product.variableCostPerUnit])).toEqual([["Tofu 300g", 300], ["Tofu 500g", 500]]);
  });

  it("moves what grows with production into each unit, and keeps it when the month changes", async () => {
    const gas = await run("setCostBehavior", { expense: "gas", behavior: "variable", grows: "lot", reason: "Solo se usa al cocinar cada tanda" });
    expect(gas).toMatchObject({ ok: true, done: ["Gas de la garrafa: crece con cada tanda"] });
    expect(gas.products?.map((product) => product.variableCostPerUnit)).toEqual([320, 520]);
    const envases = await run("setCostBehavior", { expense: "Envases", behavior: "variable", grows: "unit", reason: "Uno por cada tofu" });
    expect(envases.ok).toBe(true);
    expect((await run("setCostBehavior", { expense: "Alquiler", behavior: "mixed", grows: "hour", reason: "Una parte" })).error).toMatch(/variablePercent/);
    expect((await run("setCostBehavior", { expense: "Sueldo", behavior: "variable", reason: "Por pieza" })).error).toMatch(/con qué crece/);
    expect((await run("setCostBehavior", { expense: "Marketing", behavior: "fixed", reason: "Siempre igual" })).ok).toBe(false);

    const state = await loadState(principal);
    expect(state.expenses.find((item) => item.name === "Gas de la garrafa")).toMatchObject({ behavior: "variable", variableDriver: "lot", variableShareBps: 10000, behaviorNote: "Solo se usa al cocinar cada tanda" });
    const next = `${Number(state.activePeriod.slice(0, 4)) + 1}-01`;
    await commitMutation(principal, { action: "create-expense", name: "Seguro", period: next, amount: 10_000, currency: "ARS", allocationBasis: "hours", shares: {}, source: "Póliza", acknowledgeImpact: true, expectedRevision: state.revision, idempotencyKey: crypto.randomUUID() }, { source: "user" });
    const carried = (await loadState(principal)).expenses.filter((item) => item.period === next);
    expect(carried.find((item) => item.name === "Gas de la garrafa")).toMatchObject({ behavior: "variable", variableDriver: "lot", behaviorNote: "Solo se usa al cocinar cada tanda" });
    expect(carried.find((item) => item.name === "Seguro")).toMatchObject({ behavior: "fixed" });
  });

  it("saves the mix Cozte hears and says how many of each to sell, and for a profit goal", async () => {
    const result = await run("setSalesMix", { shares: [{ product: "Tofu 300g", percent: 60 }, { product: "Tofu 500g", percent: 40 }], targetProfit: 210_000, reason: "Vende 3 de 300g por cada 2 de 500g" });
    expect(result.ok).toBe(true);
    expect(result.done?.[0]).toMatch(/elegida.*por unidades; meta de ganancia 210000/i);
    // Fixed: rent + salary + insurance = 1.010.000. The 300g leaves 1.670 (2.000 − 300 soy − 20 gas − 10 packaging), the
    // 500g 2.470: 1.990 weighted, so 507,5 units, 60 % and 40 % of them rounded up.
    expect(result.breakEven).toEqual({ totalUnits: 509, totalRevenue: 1_222_000 });
    expect(result.products?.map((product) => [product.product, product.leavesPerUnit, product.unitsToBreakEven, product.unitsForTarget])).toEqual([["Tofu 300g", 1670, 305, 368], ["Tofu 500g", 2470, 204, 246]]);
    expect(await loadSalesMix(principal)).toMatchObject({ basis: "units", source: "manual", shares: { }, targetProfitMinor: 210_000, note: "Vende 3 de 300g por cada 2 de 500g" });
    expect(Object.values((await loadSalesMix(principal)).shares).sort()).toEqual([4000, 6000]);
  });

  it("follows what sells when the mix comes from the month's sales, and counts this month's sales", async () => {
    await saveSalesMix(principal, { source: "equal" }, "user");
    expect((await loadBreakEven(principal)).plan.mix.used).toBe("equal");
    expect((await run("recordSale", { items: [{ product: "Tofu 300g", quantity: 30 }, { product: "Tofu 500g", quantity: 10 }] })).ok).toBe(true);
    const { plan } = await loadBreakEven(principal);
    expect(plan.products.map((product) => product.soldUnits)).toEqual([30, 10]);
    await expect(saveSalesMix(principal, { source: "manual", shares: { nope: 50 } }, "user")).rejects.toThrow(/qué parte/);
    await expect(saveSalesMix({ ...principal, role: "viewer" }, { source: "equal" }, "user")).rejects.toThrow(/permiso/);
  });
});
