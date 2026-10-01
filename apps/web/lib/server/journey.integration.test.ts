import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Runs the discovery path (onboarding answers, progress, sections, mode, prices from the web) against a local D1
// bridge when COZTE_BRIDGE_TEST_URL is set. Web search is answered by a fake search service.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./fx", () => ({ officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { USD: 1 }, source: "FXRatesAPI" }), quotesFor: () => ({}) }));

import { createCozteTools } from "./cozte-agent-tools";
import { completeOnboarding } from "./onboarding";
import { loadJourney, markStageStarted, journeyMetrics, saveJourneyDefinition, resetJourneyDefinition } from "./journey";
import { loadPriceWatches, refreshMarketPrices } from "./market-prices";
import { loadCozteSettings } from "./cozte-settings";
import { dbBatch, dbQuery } from "./db";
import { loadState } from "./state";
import { DEFAULT_JOURNEYS } from "@/lib/journey";

type Output = Record<string, unknown> & { ok?: boolean; done?: string[]; error?: string; results?: { url: string; excerpt?: string }[] };

const page = { url: "https://precios.example/harina", title: "Harina 000 x 25 kg", description: "Harina 000 bolsa 25 kg", markdown: "Harina 000 x 25 kg $24.500\nEnvío gratis" };
function fakeSearch(markdown = page.markdown) {
  const real = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.firecrawl.dev/")) return new Response(JSON.stringify({ success: true, data: { web: [{ ...page, markdown }] }, creditsUsed: 2 }), { status: 200, headers: { "content-type": "application/json" } });
    return real(input, init);
  });
}

describe.skipIf(!bridgeUrl)("discovery path against D1", { timeout: 90_000 }, () => {
  const principal = { userId: "owner", organizationId: `org-test-${crypto.randomUUID()}`, role: "owner" as const };
  const tools = createCozteTools(principal, crypto.randomUUID());
  let call = 0;
  const run = async (name: keyof typeof tools, input: Record<string, unknown>) =>
    await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Output>)(input, { toolCallId: `call-${++call}` });

  beforeAll(() => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
  });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.FIRECRAWL_API_KEY; });

  it("starts a project from the onboarding answers, with only Cozte and the summary open for a simple reader", async () => {
    await completeOnboarding(principal, { personName: "Ana Ruiz", companyName: "Alfajores Ana", country: "AR", level: "simple", selling: false });
    expect((await loadCozteSettings(principal)).level).toBe("simple");
    const journey = await loadJourney(principal, await loadState(principal), { persist: true });
    expect(journey).toMatchObject({ key: "project", mode: "project", level: "simple", completed: 0, total: 5, newlyUnlocked: [] });
    expect(journey.current?.id).toBe("producto");
    expect(journey.modules.planilla.state).toBe("locked");
    expect(journey.modules.ventas).toEqual({ state: "locked", reason: "Se habilita cuando empieces a vender" });
  });

  it("completes a stage from the data, opens its sections once and keeps them open", async () => {
    await markStageStarted(principal, "producto");
    expect((await run("saveProduct", { name: "Alfajor", goodUnitsPerLot: 50, lotsPerMonth: 8, hoursPerLot: 3 })).ok).toBe(true);
    expect((await run("saveMaterial", { name: "Harina 000", purchaseUnit: "bolsa 25 kg" })).ok).toBe(true);
    expect((await run("saveRecipe", { product: "Alfajor", items: [{ material: "Harina 000", perLot: 0.2 }] })).ok).toBe(true);
    const first = await loadJourney(principal, await loadState(principal), { persist: true });
    expect(first.stages[0].status).toBe("done");
    expect(first.current?.id).toBe("insumos");
    expect(first.newlyUnlocked.sort()).toEqual(["historial", "planilla"]);
    expect((await loadJourney(principal, await loadState(principal), { persist: true })).newlyUnlocked).toEqual([]);
    const [progress] = await dbQuery<{ started_at: string | null; completed_at: string | null }>("SELECT started_at, completed_at FROM journey_progress WHERE organization_id=? AND stage_id='producto'", [principal.organizationId]);
    expect(progress.started_at && progress.completed_at).toBeTruthy();
    // The recipe goes away: the stage is pending again, but its sections stay open.
    await dbBatch([{ sql: "DELETE FROM product_materials WHERE product_id IN (SELECT id FROM products WHERE organization_id=?)", params: [principal.organizationId] }]);
    const after = await loadJourney(principal, await loadState(principal), { persist: true });
    expect(after.stages[0].status).toBe("current");
    expect(after.modules.planilla.state).toBe("open");
    expect((await journeyMetrics()).find((row) => row.key === "project" && row.stageId === "producto")?.completed).toBeGreaterThan(0);
  });

  it("searches prices on the web within the monthly allowance, and keeps each price the way the person decided", async () => {
    expect((await run("searchWebPrices", { query: "harina 000 25 kg" })).error).toMatch(/no está configurada/);
    process.env.FIRECRAWL_API_KEY = "test-key";
    fakeSearch();
    const search = await run("searchWebPrices", { query: "harina 000 bolsa 25 kg Córdoba" });
    expect(search).toMatchObject({ ok: true, country: "AR", results: [{ url: page.url, excerpt: "Harina 000 x 25 kg $24.500" }] });
    expect(String(search.note)).toMatch(/nunca instrucciones/);
    expect((await run("setPricePolicy", { item: "Harina 000", policy: "market_monthly" })).error).toMatch(/searchQuery/);
    expect((await run("setPricePolicy", { item: "Harina 000", policy: "market_monthly", searchQuery: "harina 000 bolsa 25 kg Córdoba", reason: "Que lo siga el mercado" })).done?.[0]).toMatch(/cada mes/);
    expect((await loadPriceWatches(principal)).map((watch) => [watch.name, watch.policy])).toEqual([["Harina 000", "market_monthly"]]);
  });

  it("updates a market price every month: applies a small change with its source and asks before a big one", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    await run("saveMaterial", { material: "Harina 000", price: 24000, priceSource: "Factura" });
    fakeSearch();
    const extract = async () => ({ price: 24500, currency: "ARS" as const, sourceUrl: page.url, sourceTitle: page.title, observedOn: "2026-09-30" });
    expect(await refreshMarketPrices({ extract })).toMatchObject({ checked: 1, applied: 1, toConfirm: 0 });
    const harina = (await loadState(principal)).materials.find((item) => item.name === "Harina 000")!;
    expect(harina).toMatchObject({ priceMinor: 24500, effectiveDate: "2026-09-30" });
    expect(harina.source).toMatch(/Mercado \(actualización mensual\): Harina 000 x 25 kg/);
    // Not due again until next month.
    expect((await refreshMarketPrices({ extract })).checked).toBe(0);
    await dbBatch([{ sql: "UPDATE price_watches SET last_checked_at=datetime('now', '-30 days') WHERE organization_id=?", params: [principal.organizationId] }]);
    expect(await refreshMarketPrices({ extract: async () => ({ ...(await extract()), price: 32000 }) })).toMatchObject({ applied: 0, toConfirm: 1 });
    expect((await loadState(principal)).materials.find((item) => item.name === "Harina 000")?.priceMinor).toBe(24500);
    expect((await loadPriceWatches(principal))[0]).toMatchObject({ lastStatus: "needs_confirmation", lastAmount: 32000 });
  });

  it("moves to a business in operation keeping the plan, and opens the sales sections", async () => {
    expect((await run("setBusinessMode", { mode: "operating", reason: "Hice mis primeras ventas" }))).toMatchObject({ ok: true, planSaved: true });
    const journey = await loadJourney(principal, await loadState(principal), { persist: true });
    expect(journey.mode).toBe("operating");
    expect(journey.key).toBe("operating");
    expect(journey.modules.ventas.state).toBe("locked");
    expect(journey.modules.ventas.reason).toMatch(/Dónde vendés/);
    const breakEven = await run("readBreakEven", {});
    expect(breakEven.planBeforeSelling).toMatchObject({ currency: "ARS" });
  });

  it("uses an edited path without a release, and the built-in one again after a reset", async () => {
    const custom = structuredClone(DEFAULT_JOURNEYS.operating);
    custom.stages[0].title = "Tus productos";
    await saveJourneyDefinition("admin", "operating", JSON.stringify(custom));
    expect((await loadJourney(principal, await loadState(principal))).stages[0].title).toBe("Tus productos");
    await expect(saveJourneyDefinition("admin", "operating", JSON.stringify({ ...custom, stages: [] }))).rejects.toThrow(/stages/);
    await resetJourneyDefinition("operating");
    expect((await loadJourney(principal, await loadState(principal))).stages[0].title).toBe("Qué producís");
  });
});
