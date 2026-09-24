import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ dbBatch: vi.fn().mockResolvedValue([]) }));
vi.mock("./state", () => ({ loadState: vi.fn() }));
vi.mock("./production-profile", () => ({ loadProductionProfile: vi.fn() }));

import { demoState } from "../demo";
import { assertSqlBindings } from "../sql-bindings";
import { dbBatch } from "./db";
import { loadState } from "./state";
import { loadProductionProfile } from "./production-profile";
import { commitMutation, mutationSchema } from "./mutations";

describe("product creation transaction", () => {
  beforeEach(() => {
    vi.mocked(loadState).mockResolvedValue(structuredClone(demoState));
    vi.mocked(loadProductionProfile).mockResolvedValue({ confirmedRevision: null } as unknown as Awaited<ReturnType<typeof loadProductionProfile>>);
    vi.mocked(dbBatch).mockClear();
  });

  it("binds warnings and context in every calculated cost snapshot", async () => {
    const input = mutationSchema.parse({
      action: "create-product", expectedRevision: demoState.revision, idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
      name: "Tofu 500 g", lotUnits: 112, salePriceMinor: 1500, salesVariableMinor: 0, laborLotMinor: 8000, productionHoursMilli: 24000,
    });
    await commitMutation({ userId: "owner", organizationId: demoState.organization.id, role: "owner" }, input, { source: "cozte" });
    const statements = vi.mocked(dbBatch).mock.calls[0][0];
    expect(() => assertSqlBindings(statements)).not.toThrow();
    const snapshots = statements.filter((statement) => statement.sql.startsWith("INSERT INTO cost_snapshots"));
    expect(snapshots).toHaveLength(demoState.products.length + 1);
    for (const snapshot of snapshots) {
      expect(JSON.parse(String(snapshot.params?.[8]))).toBeInstanceOf(Array);
      expect(JSON.parse(String(snapshot.params?.[9]))).toHaveProperty("product");
    }
  });

  it.each([
    { action: "create-products", products: [
      { name: "Tofu 300 g", lotUnits: 93, salePriceMinor: 900, salesVariableMinor: 0, laborLotMinor: 8000, productionHoursMilli: 24000 },
      { name: "Tofu 500 g", lotUnits: 112, salePriceMinor: 1500, salesVariableMinor: 0, laborLotMinor: 8000, productionHoursMilli: 24000 },
    ] },
    { action: "create-material", name: "Soja", supplier: "CEAPE", purchaseUnit: "kg", category: "Materia prima", price: 1200, currency: "CLP", source: "Factura" },
    { action: "create-expense", name: "Electricidad nueva", period: demoState.activePeriod, amount: 2000, currency: "CLP", allocationBasis: "hours", shares: {}, category: "Servicios", source: "Factura" },
    { action: "create-category", name: "Servicios extra" },
    { action: "set-component", productId: "dura", materialId: "papel", quantityMilli: 12000 },
    { action: "bulk-prices", materials: [{ id: "papel", amount: 9500, currency: "CLP" }], expenses: [], source: "Factura", effectiveDate: "2026-09-24", expectedFxRates: {} },
  ])("keeps every binding aligned for $action", async (change) => {
    const input = mutationSchema.parse({ ...change, expectedRevision: demoState.revision, idempotencyKey: crypto.randomUUID() });
    await commitMutation({ userId: "owner", organizationId: demoState.organization.id, role: "owner" }, input, { source: "cozte" });
    expect(() => assertSqlBindings(vi.mocked(dbBatch).mock.calls[0][0])).not.toThrow();
  });
});
