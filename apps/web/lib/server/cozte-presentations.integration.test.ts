import { beforeAll, describe, expect, it, vi } from "vitest";

// Runs Cozte's presentation tools against a local D1 bridge when COZTE_BRIDGE_TEST_URL is set.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./fx", () => ({ officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { USD: 1 }, source: "FXRatesAPI" }), quotesFor: () => ({}) }));

import { createCozteTools } from "./cozte-agent-tools";
import { dbBatch } from "./db";
import { loadSharedPresentation } from "./presentations";

type Output = Record<string, unknown> & { ok?: boolean; done?: string[]; error?: string; presentationId?: string; revision?: number; publicUrl?: string | null; slides?: { number: number; title: string; chart?: { kind: string; conclusion: string | null }; figures?: string[] }[] };

describe.skipIf(!bridgeUrl)("Cozte presentations against D1", { timeout: 90_000 }, () => {
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
    await dbBatch([{ sql: "UPDATE organizations SET currency='ARS', name='Tofu Sur' WHERE id=?", params: [principal.organizationId] }]);
    expect((await run("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 })).ok).toBe(true);
    expect((await run("saveMaterial", { name: "Soja", purchaseUnit: "kg", price: 1000 })).ok).toBe(true);
    expect((await run("saveRecipe", { product: "Tofu 300g", items: [{ material: "Soja", perLot: 30 }] })).ok).toBe(true);
    expect((await run("saveExpense", { name: "Luz", amount: 200000, splitBy: "hours" })).ok).toBe(true);
    expect((await run("saveChannel", { name: "Feria", commissionPercent: 0 })).ok).toBe(true);
    expect((await run("recordSale", { channel: "Feria", items: [{ product: "Tofu 300g", quantity: 40 }] })).ok).toBe(true);
  });

  it("creates a sales deck from the template with the engine's figures", async () => {
    const created = await run("createPresentation", { title: "Ventas del mes", template: "ventas", month });
    expect(created).toMatchObject({ ok: true, title: "Ventas del mes", done: [expect.stringContaining("creada")] });
    expect(created.slides?.[0].title).toBe("Ventas del mes");
    expect(created.slides?.[1].figures?.[0]).toContain("80.000");
    expect(created.slides?.find((slide) => slide.chart?.kind === "sales-by-channel")?.chart?.conclusion).toContain("Feria");
  });

  it("edits, undoes and keeps every version", async () => {
    const edited = await run("editPresentation", { changes: [
      { action: "add", slide: { layout: "section", title: "Vendimos 40 tofus en la feria" }, position: 2 },
      { action: "update", slide: 4, set: { text: "La feria es nuestro canal principal." } },
      { action: "settings", theme: "noche" },
    ] });
    expect(edited).toMatchObject({ ok: true, theme: "noche" });
    expect(edited.slides?.[1].title).toBe("Vendimos 40 tofus en la feria");
    const undone = await run("editPresentation", { undo: true });
    expect(undone).toMatchObject({ ok: true, theme: "cozte" });
    expect(undone.slides?.[1].title).not.toBe("Vendimos 40 tofus en la feria");
    const invalid = await run("editPresentation", { changes: [{ action: "remove", slide: 40 }] });
    expect(invalid).toMatchObject({ ok: false, error: expect.stringContaining("No existe") });
  });

  it("shares with a public link that shows only the deck, and closes it for good", async () => {
    const shared = await run("sharePresentation", { presentation: "Ventas del mes", public: true });
    const token = shared.publicUrl?.split("/p/")[1];
    expect(token).toBeTruthy();
    const open = await loadSharedPresentation(token!);
    expect(open?.title).toBe("Ventas del mes");
    const closed = await run("sharePresentation", { public: false });
    expect(closed.publicUrl).toBeNull();
    expect(await loadSharedPresentation(token!)).toBeNull();
  });

  it("lists and reads decks by title", async () => {
    const list = await run("readPresentation", {});
    expect(list.ok).toBe(true);
    const read = await run("readPresentation", { presentation: "ventas" });
    expect(read.slides?.length).toBeGreaterThan(3);
  });
});
