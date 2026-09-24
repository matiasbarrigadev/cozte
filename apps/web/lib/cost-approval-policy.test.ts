import { describe, expect, it } from "vitest";
import { mutationNeedsHumanReview } from "./cost-approval-policy";
import type { Mutation } from "./server/mutations";

const common = { expectedRevision: 4, idempotencyKey: "00000000-0000-4000-8000-000000000001" };

describe("cost approval policy", () => {
  it("creates products directly without human review", () => {
    const product: Mutation = { ...common, action: "create-product", name: "Galleta 2", lotUnits: 100, salePriceMinor: 1000, salesVariableMinor: 0, laborLotMinor: 200, productionHoursMilli: 1000 };
    const products: Mutation = { ...common, action: "create-products", products: [
      { name: "Galleta 2", lotUnits: 100, salePriceMinor: 1000, salesVariableMinor: 0, laborLotMinor: 200, productionHoursMilli: 1000 },
      { name: "Galleta 3", lotUnits: 100, salePriceMinor: 1200, salesVariableMinor: 0, laborLotMinor: 200, productionHoursMilli: 1000 },
    ] };
    expect(mutationNeedsHumanReview(product)).toBe(false);
    expect(mutationNeedsHumanReview(products)).toBe(false);
  });

  it("requires UI approval before removing a product or material", () => {
    expect(mutationNeedsHumanReview({ ...common, action: "delete-product", id: "product" })).toBe(true);
    expect(mutationNeedsHumanReview({ ...common, action: "delete-material", id: "material" })).toBe(true);
  });

  it("applies ordinary changes directly even when they affect evaluated products", () => {
    const ordinaryChanges: Mutation[] = [
      { ...common, action: "create-material", name: "Cacao", supplier: "", purchaseUnit: "kg" },
      { ...common, action: "create-expense", name: "Electricidad", period: "2026-09", amount: 1000, currency: "ARS", allocationBasis: "units", shares: {}, source: "Factura" },
      { ...common, action: "create-category", name: "Servicios" },
      { ...common, action: "update-product", id: "product", name: "Galleta", lotUnits: 100, salePriceMinor: 1000, salesVariableMinor: 0, laborLotMinor: 200, productionHoursMilli: 1000 },
      { ...common, action: "set-component", productId: "product", materialId: "material", quantityMilli: 750 },
      { ...common, action: "bulk-prices", materials: [{ id: "used", amount: 150, currency: "ARS" }], expenses: [{ id: "expense", amount: 1500, currency: "ARS" }], expectedFxRates: {}, source: "Factura", effectiveDate: "2026-09-22" },
      { ...common, action: "update-expense-allocation", id: "expense", basis: "hours", shares: {} },
      { ...common, action: "update-expense-meta", id: "expense", field: "period", value: "2026-09" },
      { ...common, action: "update-material-meta", id: "used", field: "name", value: "Harina integral" },
    ];
    for (const mutation of ordinaryChanges) expect(mutationNeedsHumanReview(mutation), mutation.action).toBe(false);
  });
});
