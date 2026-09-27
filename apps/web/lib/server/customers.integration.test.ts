import { beforeAll, describe, expect, it, vi } from "vitest";

// Runs customers (import from existing sales, links, addresses, merge and Cozte's tools) against a local D1 bridge when COZTE_BRIDGE_TEST_URL is set.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./fx", () => ({ officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { USD: 1 }, source: "FXRatesAPI" }), quotesFor: () => ({}) }));

import { createCozteTools } from "./cozte-agent-tools";
import { loadBusinessView, loadDeliveries, recordSale, saveDelivery, updateSale } from "./business";
import { loadCustomer, loadCustomers, mergeCustomers, saveCustomer } from "./customers";
import { dbBatch } from "./db";
import { businessToday } from "@/lib/business";

type Output = Record<string, unknown> & { ok?: boolean; done?: string[]; error?: string; options?: string[]; customers?: { name: string; status: string; address: string | null }[]; addresses?: { address: string; main: boolean }[]; customerId?: string };

const today = businessToday("ARS");

describe.skipIf(!bridgeUrl)("customers against D1", { timeout: 90_000 }, () => {
  const principal = { userId: "tester", organizationId: `org-test-${crypto.randomUUID()}`, role: "owner" as const };
  const tools = createCozteTools(principal, crypto.randomUUID());
  let call = 0;
  const run = async (name: keyof typeof tools, input: Record<string, unknown>) =>
    await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Output>)(input, { toolCallId: `call-${++call}` });
  let productId = "";
  let channelId = "";

  beforeAll(async () => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    await run("readCosts", {});
    await dbBatch([{ sql: "UPDATE organizations SET currency='ARS' WHERE id=?", params: [principal.organizationId] }]);
    const product = await run("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 });
    productId = (product.ids as Record<string, string>)?.product ?? "";
    expect((await run("saveMaterial", { name: "Soja", purchaseUnit: "kg", price: 1000 })).ok).toBe(true);
    expect((await run("saveRecipe", { product: "Tofu 300g", items: [{ material: "Soja", perLot: 30 }] })).ok).toBe(true);
    const channel = await run("saveChannel", { name: "Instagram", commissionPercent: 10, delivery: "Moto propia", deliveryCostPerOrder: 1500, unitsPerOrder: 3 });
    channelId = (channel.ids as Record<string, string>)?.channel ?? "";
    // Sales recorded before customers existed: only the typed name, and a delivery with its address.
    const saleA = crypto.randomUUID(), saleB = crypto.randomUUID();
    await dbBatch([
      { sql: "INSERT INTO sales (id, organization_id, sold_on, channel_id, channel_name, customer, note, total_minor, selling_cost_minor, delivery_cost_minor, variable_cost_minor, production_cost_minor, source, actor_id, idempotency_key) VALUES (?, ?, ?, NULL, 'Venta directa', 'Almacén Don Pepe', '', 8000, 0, 0, 3000, 3500, 'user', 'tester', ?)", params: [saleA, principal.organizationId, "2026-06-10", crypto.randomUUID()] },
      { sql: "INSERT INTO sales (id, organization_id, sold_on, channel_id, channel_name, customer, note, total_minor, selling_cost_minor, delivery_cost_minor, variable_cost_minor, production_cost_minor, source, actor_id, idempotency_key) VALUES (?, ?, ?, NULL, 'Venta directa', 'almacen don pepe', '', 6000, 0, 0, 2000, 2500, 'user', 'tester', ?)", params: [saleB, principal.organizationId, "2026-07-12", crypto.randomUUID()] },
      { sql: "INSERT INTO deliveries (id, organization_id, sale_id, scheduled_on, status, address, recipient, contact, source, actor_id) VALUES (?, ?, ?, '2026-07-13', 'delivered', 'Belgrano 88, Rosario', 'Pepe', '341 555 0199', 'user', 'tester')", params: [crypto.randomUUID(), principal.organizationId, saleB] },
    ]);
  });

  it("builds customers once from the names already typed, joining the same name written differently", async () => {
    const { customers } = await loadCustomers(principal);
    expect(customers.map((row) => row.name)).toEqual(["almacen don pepe"]);
    expect(customers[0].stats).toMatchObject({ sales: 2, revenue: 14000, lastOn: "2026-07-12" });
    expect(customers[0].addresses[0]).toMatchObject({ address: "Belgrano 88, Rosario", zone: "Rosario", recipient: "Pepe", isDefault: true });
    expect(customers[0].phone).toBe("341 555 0199");
    expect((await loadCustomers(principal)).customers).toHaveLength(1);
  });

  it("links a new sale to its customer and sends its delivery to the customer's default address", async () => {
    const sale = await recordSale(principal, { soldOn: today, channelId, customer: "Almacén Don Pepe", items: [{ productId, quantity: 3 }] }, { source: "user", idempotencyKey: crypto.randomUUID() });
    const { customers } = await loadCustomers(principal);
    expect(customers).toHaveLength(1);
    expect(customers[0].stats.sales).toBe(3);
    const delivery = (await loadDeliveries(principal, today.slice(0, 7))).find((item) => item.saleId === sale.id);
    expect(delivery).toMatchObject({ address: "Belgrano 88, Rosario", recipient: "Pepe" });
  });

  it("keeps a new delivery address in the customer's record, and creates customers for new names", async () => {
    const sale = await recordSale(principal, { soldOn: today, channelId, customer: "Lucía Paz", items: [{ productId, quantity: 3 }], delivery: { address: "Mitre 10, Córdoba", recipient: "Lucía" } }, { source: "user", idempotencyKey: crypto.randomUUID() });
    const delivery = (await loadDeliveries(principal, today.slice(0, 7))).find((item) => item.saleId === sale.id)!;
    await saveDelivery(principal, { id: delivery.id, address: "Colón 1450, Córdoba" }, "user");
    const lucia = (await loadCustomers(principal)).customers.find((row) => row.name === "Lucía Paz")!;
    expect(lucia.addresses.map((item) => [item.address, item.isDefault])).toEqual(expect.arrayContaining([["Mitre 10, Córdoba", true], ["Colón 1450, Córdoba", false]]));
    // Changing a sale's customer points it to that customer.
    await updateSale(principal, sale.id, { customer: "almacen don pepe" }, "user");
    const view = await loadBusinessView(principal, today.slice(0, 7));
    expect(view.sales.find((item) => item.id === sale.id)?.customerId).toBe((await loadCustomers(principal)).customers.find((row) => row.name === "almacen don pepe")!.id);
  });

  it("renames a customer everywhere and merges a duplicate into it", async () => {
    const { customers } = await loadCustomers(principal);
    const pepe = customers.find((row) => row.name === "almacen don pepe")!;
    const lucia = customers.find((row) => row.name === "Lucía Paz")!;
    await saveCustomer(principal, { id: pepe.id, name: "Almacén Don Pepe", notes: "Abre a las 9" }, "user");
    await expect(saveCustomer(principal, { name: "almacén don pepe" }, "user")).rejects.toThrow(/Ya hay un cliente/);
    await mergeCustomers(principal, lucia.id, pepe.id);
    const detail = await loadCustomer(principal, pepe.id);
    expect(detail.customer).toMatchObject({ name: "Almacén Don Pepe", notes: "Abre a las 9" });
    expect(detail.stats.sales).toBe(4);
    expect(detail.customer.addresses.map((item) => item.address)).toEqual(expect.arrayContaining(["Belgrano 88, Rosario", "Mitre 10, Córdoba", "Colón 1450, Córdoba"]));
    expect(detail.sales.every((item) => item.customerId === pepe.id)).toBe(true);
    expect((await loadCustomers(principal)).customers.map((row) => row.name)).toEqual(["Almacén Don Pepe"]);
  });

  it("lets Cozte read customers and save one with an address", async () => {
    const list = await run("readCustomers", {});
    expect(list.customers?.[0]).toMatchObject({ name: "Almacén Don Pepe", address: "Belgrano 88, Rosario" });
    const created = await run("saveCustomer", { name: "Librería Rayuela", phone: "351 444 0000", address: { address: "Caseros 540, Córdoba", recipient: "Marta" } });
    expect(created.ok).toBe(true);
    expect(created.done).toEqual(["Cliente creado: Librería Rayuela", "Dirección agregada a Librería Rayuela"]);
    const detail = await run("readCustomers", { customer: "libreria rayuela" });
    expect(detail.addresses).toEqual([expect.objectContaining({ address: "Caseros 540, Córdoba", main: true })]);
    expect((await run("readCustomers", { customer: "Nadie Nunca" })).ok).toBe(false);
  });
});
