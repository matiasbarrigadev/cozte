import { beforeAll, describe, expect, it, vi } from "vitest";

// Runs the real tools against a local D1 bridge (wrangler dev) when COZTE_BRIDGE_TEST_URL is set.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./fx", () => ({ officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { USD: 1 }, source: "FXRatesAPI" }), quotesFor: () => ({}) }));

import { createCozteTools } from "./cozte-agent-tools";
import { dbBatch } from "./db";

type Output = Record<string, unknown> & { ok?: boolean };

describe.skipIf(!bridgeUrl)("Cozte tools against D1", { timeout: 60_000 }, () => {
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
  });

  it("builds the tofu workshop from conversation facts and costs it", async () => {
    expect((await run("saveProduct", { name: "Tofu 500g", goodUnitsPerLot: 112, lotsPerMonth: 23, hoursPerLot: 6 })).ok).toBe(true);
    // Commercial data is optional: an unknown sale price must not block the production cost.
    expect((await run("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 93, lotsPerMonth: 23, hoursPerLot: 6, salePrice: null })).ok).toBe(true);

    // Parallel writes in one step must not fail each other on the revision check.
    const materials = await Promise.all([
      run("saveMaterial", { name: "Soja orgánica", purchaseUnit: "kg", price: 1293, priceSource: "Estimación de la persona" }),
      run("saveMaterial", { name: "Cloruro de magnesio", purchaseUnit: "kg", price: 2100 }),
      run("saveMaterial", { name: "Tela de filtrado", purchaseUnit: "m2", price: 348 }),
      run("saveMaterial", { name: "Bolsa", purchaseUnit: "unidad", price: 59 }),
      run("saveMaterial", { name: "Etiqueta", purchaseUnit: "unidad", price: 240 }),
    ]);
    expect(materials.map((item) => item.ok ? true : item)).toEqual([true, true, true, true, true]);

    const recipe = await run("saveRecipe", { product: "tofu 300 g", items: [
      { material: "soja organica", quantity: 0.2097, per: "unit" },
      { material: "cloruro", quantity: 7, per: "unit", unit: "g" },
      { material: "tela", quantity: 0.0105, per: "unit" },
      { material: "bolsa", quantity: 1, per: "unit" },
      { material: "etiqueta", quantity: 1, per: "unit" },
    ] });
    expect(recipe.ok).toBe(true);
    expect(recipe.saved).toContain("Cloruro de magnesio: 0.651 kg por lote (7 g × 93 unidades)");

    expect((await run("saveExpense", { name: "Mano de obra", amount: 1600000, splitBy: "hours" })).ok).toBe(true);
    expect((await run("saveExpense", { name: "Gas", amount: 110000, splitBy: "hours" })).ok).toBe(true);
    const light = await run("saveExpense", { name: "Luz", amount: 4200000, frequency: "annual", splitBy: "units" });
    expect(light.done).toEqual(["Gasto Luz creado: 350000 ARS al mes (4200000 al año = 350000 al mes)"]);

    const detail = await run("readCosts", { product: "Tofu 300g" });
    // Materials 54.730 per lot + shared 1.013.780 per month / 23 lots = 44.077 per lot → 98.807 / 93 units.
    expect(detail).toMatchObject({ ok: true, unitCost: 1062, status: "complete", lotCost: 98807 });
    const overview = await run("readCosts", {});
    const products = overview.products as { name: string; cost: { status: string } }[];
    expect(products.find((item) => item.name === "Tofu 500g")?.cost.status).toBe("estimated");
  });

  it("asks instead of guessing and keeps removals for human review", async () => {
    const ambiguous = await run("saveRecipe", { product: "tofu", items: [{ material: "bolsa", quantity: 1, per: "unit" }] });
    expect(ambiguous).toMatchObject({ ok: false, options: ["Tofu 300g", "Tofu 500g"] });
    const unknownUnit = await run("saveRecipe", { product: "Tofu 500g", items: [{ material: "Etiqueta", quantity: 1, per: "unit", unit: "rollo" }] });
    expect(unknownUnit.ok).toBe(false);
    const missing = await run("saveExpense", { name: "Alquiler", amount: 300000 });
    expect(missing).toMatchObject({ ok: false, needs: ["cómo repartirlo entre productos (horas, unidades o porcentajes)"] });
    const removal = await run("removeItem", { kind: "material", item: "Bolsa", reason: "Ya no se usa" });
    expect(removal).toMatchObject({ ok: true, pendingReview: true });
    expect((await run("readCosts", {})).materials).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Bolsa" })]));
  });

  it("updates existing records by name and remembers decisions", async () => {
    const price = await run("saveMaterial", { material: "soja", price: 1500, priceSource: "Factura 123", priceDate: "2026-09-24" });
    expect(price.ok).toBe(true);
    expect((price.impact as { product: string; unitCost: number; unitCostBefore: number }[])[0]).toMatchObject({ product: "Tofu 300g", unitCostBefore: 1062 });
    const percentages = await run("saveExpense", { expense: "Gas", splitBy: "percentages", percentages: [{ product: "Tofu 500g", percent: 66.7 }, { product: "Tofu 300g", percent: 33.3 }] });
    expect(percentages.ok).toBe(true);
    const note = await run("saveNote", { text: "El fundador no cobra sueldo fijo: no se incluye como costo de producción." });
    expect(note.ok).toBe(true);
    const overview = await run("readCosts", {});
    expect(overview.notes).toEqual([expect.objectContaining({ text: expect.stringContaining("fundador") })]);
    const scenario = await run("simulate", { materialPrices: [{ material: "Soja orgánica", price: 1800 }] });
    expect((scenario.products as { change: number }[]).some((item) => item.change > 0)).toBe(true);
  });
});
