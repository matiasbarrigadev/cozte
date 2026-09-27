import { beforeAll, describe, expect, it, vi } from "vitest";

// Runs suppliers (import from typed names, links from purchases and carrier zones, prices, rename, merge and Cozte's tools) against a local D1 bridge when COZTE_BRIDGE_TEST_URL is set.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./fx", () => ({ officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { USD: 1 }, source: "FXRatesAPI" }), quotesFor: () => ({}) }));

import { createCozteTools } from "./cozte-agent-tools";
import { loadBusinessView, recordPurchase, updatePurchase } from "./business";
import { loadSupplier, loadSuppliers, mergeSuppliers, saveSupplier } from "./suppliers";
import { loadZones, saveZone } from "./delivery-zones";
import { dbBatch, dbQuery } from "./db";
import { loadState } from "./state";
import { businessToday } from "@/lib/business";

type Output = Record<string, unknown> & { ok?: boolean; done?: string[]; error?: string; options?: string[]; suppliers?: { name: string; kind: string; sells?: string[]; biggestPriceChange?: { changePercent: number } }[]; prices?: { material: string; first: number; last: number; changePercent: number | null }[] };

const today = businessToday("ARS");

describe.skipIf(!bridgeUrl)("suppliers against D1", { timeout: 90_000 }, () => {
  const principal = { userId: "tester", organizationId: `org-test-${crypto.randomUUID()}`, role: "owner" as const };
  const tools = createCozteTools(principal, crypto.randomUUID());
  let call = 0;
  const run = async (name: keyof typeof tools, input: Record<string, unknown>) =>
    await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Output>)(input, { toolCallId: `call-${++call}` });
  let soyId = "";

  beforeAll(async () => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    await run("readCosts", {});
    await dbBatch([{ sql: "UPDATE organizations SET currency='ARS' WHERE id=?", params: [principal.organizationId] }]);
    expect((await run("saveMaterial", { name: "Soja", purchaseUnit: "kg", price: 1000, supplier: "Granos del Sur" })).ok).toBe(true);
    expect((await run("saveMaterial", { name: "Frascos", purchaseUnit: "unidad", price: 300, supplier: "Vidriería Oeste" })).ok).toBe(true);
    soyId = (await loadState(principal)).materials.find((item) => item.name === "Soja")!.id;
    // Purchases typed before suppliers existed: the same name written two ways, and a carrier zone.
    await dbBatch([
      { sql: "INSERT INTO purchases (id, organization_id, purchased_on, description, supplier, amount_minor, currency, native_amount_milli, kind, area, material_id, quantity_milli, source, actor_id, idempotency_key) VALUES (?, ?, '2026-05-10', 'Soja', 'Granos del Sur', 50000, 'ARS', 50000000, 'material', 'production', ?, 50000, 'user', 'tester', ?)", params: [crypto.randomUUID(), principal.organizationId, soyId, crypto.randomUUID()] },
      { sql: "INSERT INTO purchases (id, organization_id, purchased_on, description, supplier, amount_minor, currency, native_amount_milli, kind, area, source, actor_id, idempotency_key) VALUES (?, ?, '2026-06-02', 'Luz del taller', 'Energía SA', 30000, 'ARS', 30000000, 'expense', 'production', 'user', 'tester', ?)", params: [crypto.randomUUID(), principal.organizationId, crypto.randomUUID()] },
      { sql: "INSERT INTO purchases (id, organization_id, purchased_on, description, supplier, amount_minor, currency, native_amount_milli, kind, area, material_id, quantity_milli, source, actor_id, idempotency_key) VALUES (?, ?, '2026-07-10', 'Soja', 'granos del sur', 55000, 'ARS', 55000000, 'material', 'production', ?, 50000, 'user', 'tester', ?)", params: [crypto.randomUUID(), principal.organizationId, soyId, crypto.randomUUID()] },
      { sql: "INSERT INTO delivery_zones (id, organization_id, name, name_key, mode, carrier, cost_per_order_minor) VALUES (?, ?, 'Interior', 'interior', 'carrier', 'Andreani', 5000)", params: [crypto.randomUUID(), principal.organizationId] },
    ]);
  });

  it("builds suppliers once from purchases, supplies and carrier zones, joining the same name written differently", async () => {
    const { suppliers } = await loadSuppliers(principal);
    expect(suppliers.map((row) => [row.name, row.kind]).sort()).toEqual([["Andreani", "logistics"], ["Energía SA", "services"], ["Vidriería Oeste", "materials"], ["granos del sur", "materials"]]);
    const granos = suppliers.find((row) => row.name === "granos del sur")!;
    expect(granos.stats).toMatchObject({ purchases: 2, spent: 105000 });
    expect(granos.prices[0]).toMatchObject({ name: "Soja", first: 1000, last: 1100 });
    expect(granos.materials).toEqual(["Soja"]);
    expect(suppliers.find((row) => row.name === "Andreani")?.zones).toEqual(["Interior"]);
    expect(suppliers.find((row) => row.name === "Vidriería Oeste")?.materials).toEqual(["Frascos"]);
    expect((await loadZones(principal))).toHaveLength(1);
    expect((await dbQuery<{ n: number }>("SELECT COUNT(*) AS n FROM purchases WHERE organization_id=? AND supplier_id IS NULL", [principal.organizationId]))[0].n).toBe(0);
    expect((await loadSuppliers(principal)).suppliers).toHaveLength(4);
  });

  it("links new purchases and carrier zones to their supplier, and relinks a purchase when its supplier changes", async () => {
    const bought = await recordPurchase(principal, { purchasedOn: today, description: "Soja", supplier: "Granos del Sur", amount: 60000, kind: "material", materialId: soyId, quantity: 50 }, { source: "user", idempotencyKey: crypto.randomUUID() });
    const granos = (await loadSuppliers(principal)).suppliers.find((row) => row.name === "granos del sur")!;
    expect(bought.purchase.supplierId).toBe(granos.id);
    expect(granos.prices[0]).toMatchObject({ first: 1000, last: 1200 });
    expect(granos.prices[0].change).toBeCloseTo(0.2);
    const other = await recordPurchase(principal, { purchasedOn: today, description: "Cinta", supplier: "Embalajes Norte", amount: 8000, kind: "expense", area: "delivery" }, { source: "user", idempotencyKey: crypto.randomUUID() });
    expect((await loadSuppliers(principal)).suppliers.find((row) => row.name === "Embalajes Norte")).toMatchObject({ kind: "services" });
    await updatePurchase(principal, other.id, { supplier: "Cajas y Cintas" }, "user");
    const view = await loadBusinessView(principal, today.slice(0, 7));
    const moved = (await loadSuppliers(principal)).suppliers.find((row) => row.name === "Cajas y Cintas")!;
    expect(view.purchases.find((item) => item.id === other.id)?.supplierId).toBe(moved.id);
    const zone = await saveZone(principal, { name: "Rosario", mode: "carrier", carrier: "Vía Cargo", costPerOrder: 4000 }, "user");
    const cargo = (await loadSuppliers(principal)).suppliers.find((row) => row.name === "Vía Cargo")!;
    expect(cargo).toMatchObject({ kind: "logistics", zones: ["Rosario"] });
    expect((await dbQuery<{ supplier_id: string }>("SELECT supplier_id FROM delivery_zones WHERE id=?", [zone.id]))[0].supplier_id).toBe(cargo.id);
  });

  it("renames a supplier everywhere and merges a duplicate into it", async () => {
    const { suppliers } = await loadSuppliers(principal);
    const granos = suppliers.find((row) => row.name === "granos del sur")!;
    await saveSupplier(principal, { id: granos.id, name: "Granos del Sur SRL", phone: "341 555 0101" }, "user");
    await expect(saveSupplier(principal, { name: "granos del sur srl" }, "user")).rejects.toThrow(/Ya hay un proveedor/);
    const detail = await loadSupplier(principal, granos.id);
    expect(detail.supplier).toMatchObject({ name: "Granos del Sur SRL", phone: "341 555 0101" });
    expect(new Set(detail.purchases.map((item) => item.id)).size).toBe(3);
    expect((await dbQuery<{ supplier: string }>("SELECT DISTINCT supplier FROM purchases WHERE supplier_id=?", [granos.id])).map((row) => row.supplier)).toEqual(["Granos del Sur SRL"]);
    const cajas = suppliers.find((row) => row.name === "Cajas y Cintas")!;
    const embalajes = suppliers.find((row) => row.name === "Embalajes Norte")!;
    await mergeSuppliers(principal, embalajes.id, cajas.id);
    expect((await loadSuppliers(principal)).suppliers.some((row) => row.name === "Embalajes Norte")).toBe(false);
    const andreani = suppliers.find((row) => row.name === "Andreani")!;
    await saveSupplier(principal, { id: andreani.id, name: "Andreani Logística" }, "user");
    expect((await loadZones(principal)).find((item) => item.name === "Interior")?.carrier).toBe("Andreani Logística");
  });

  it("lets Cozte read suppliers with their prices and save one", async () => {
    const list = await run("readSuppliers", { kind: "materials" });
    expect(list.suppliers?.map((row) => row.name)).toEqual(expect.arrayContaining(["Granos del Sur SRL", "Vidriería Oeste"]));
    expect(list.suppliers?.find((row) => row.name === "Granos del Sur SRL")?.biggestPriceChange?.changePercent).toBe(20);
    const bySupply = await run("readSuppliers", { query: "soja" });
    expect(bySupply.suppliers?.map((row) => row.name)).toEqual(["Granos del Sur SRL"]);
    const detail = await run("readSuppliers", { supplier: "granos del sur srl" });
    expect(detail.prices).toEqual([expect.objectContaining({ material: "Soja", first: 1000, last: 1200, changePercent: 20 })]);
    const created = await run("saveSupplier", { name: "Molino Andino", kind: "materials", phone: "261 444 0000", notes: "Pedidos los lunes" });
    expect(created).toMatchObject({ ok: true, done: ["Proveedor creado: Molino Andino"] });
    const again = await run("saveSupplier", { name: "molino andino", contactName: "Rita" });
    expect(again.done).toEqual(["Datos de Molino Andino actualizados"]);
    expect((await run("readSuppliers", { supplier: "Nadie SA" })).ok).toBe(false);
  });
});
