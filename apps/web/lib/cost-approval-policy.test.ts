import { describe, expect, it } from "vitest";
import type { DomainState } from "./domain";
import { mutationNeedsHumanReview } from "./cost-approval-policy";
import { emptyProductionProfile } from "./production-profile";
import type { Mutation } from "./server/mutations";

const state: DomainState = {
  revision: 4,
  activePeriod: "2026-09",
  organization: { id: "org", name: "Taller", currency: "CLP" },
  products: [{ id: "product", name: "Galleta", lotUnits: 100, salePriceMinor: 1000, salesVariableMinor: 0, laborLotMinor: 200, productionHoursMilli: 1000, version: 1 }],
  materials: [{ id: "used", name: "Harina", supplier: "", purchaseUnit: "kg", category: "Materia prima", priceMinor: 100, source: null, effectiveDate: null, version: 1 }, { id: "unused", name: "Cacao", supplier: "", purchaseUnit: "kg", category: "Materia prima", priceMinor: 200, source: null, effectiveDate: null, version: 1 }],
  components: [{ productId: "product", materialId: "used", quantityMilli: 500 }],
  expenses: [{ id: "expense", name: "Electricidad", period: "2026-09", amountMinor: 1000, allocationBasis: "units", category: "Servicios", version: 1 }],
  categories: [{ id: "category", name: "Materia prima" }],
};

const common = { expectedRevision: 4, idempotencyKey: "00000000-0000-4000-8000-000000000001" };
const evaluatedProfile = {
  ...emptyProductionProfile,
  site: { name: "Planta", location: "Santiago" },
  stages: [{ name: "Producción", notes: "" }],
  categories: [{ name: "Materia prima" }, { name: "Servicios" }],
  products: [
    { name: "Galleta", finishedUnit: "unidad", goodUnitsPerBatch: 10, startedUnitsPerBatch: null, normalScrapUnitsPerBatch: null, batchesPerMonth: 1, hoursPerBatch: null },
    { name: "En armado", finishedUnit: "unidad", goodUnitsPerBatch: null, startedUnitsPerBatch: null, normalScrapUnitsPerBatch: null, batchesPerMonth: null, hoursPerBatch: null },
  ],
  inputs: [{ name: "Harina", category: "Materia prima", purchaseUnit: "kg", consumptionUnit: "kg", unitsPerPurchase: 1, usage: [{ product: "Galleta", quantityPerBatch: 1 }], pricePerPurchaseMinor: 100, evidence: { quality: "measured" as const, source: "Factura", asOf: "2026-09-20" } }],
  recurringCosts: [{ name: "Electricidad", category: "Servicios", frequency: "monthly" as const, amountMinor: 1000, allocation: "manual_percentage" as const, shares: [{ product: "Galleta", percent: 100 }, { product: "En armado", percent: 0 }], evidence: { quality: "measured" as const, source: "Factura", asOf: "2026-09-20" } }],
};

describe("cost approval policy", () => {
  it("lets Cozte save setup that does not affect a completed product without approval", () => {
    expect(mutationNeedsHumanReview(state, { ...common, action: "create-material", name: "Cacao", supplier: "", purchaseUnit: "kg" })).toBe(false);
    expect(mutationNeedsHumanReview(state, { ...common, action: "create-category", name: "Servicios" })).toBe(false);
    expect(mutationNeedsHumanReview(state, { ...common, action: "bulk-prices", materials: [{ id: "unused", amount: 250, currency: "CLP" }], expenses: [], expectedFxRates: {}, source: "Factura", effectiveDate: "2026-09-22" })).toBe(false);
  });

  it("requires review when a change creates or affects a completed product", () => {
    const product: Mutation = { ...common, action: "create-product", name: "Galleta 2", lotUnits: 100, salePriceMinor: 1000, salesVariableMinor: 0, laborLotMinor: 200, productionHoursMilli: 1000 };
    expect(mutationNeedsHumanReview(state, product)).toBe(true);
    expect(mutationNeedsHumanReview(state, { ...common, action: "set-component", productId: "product", materialId: "used", quantityMilli: 750 })).toBe(true);
    expect(mutationNeedsHumanReview(state, { ...common, action: "bulk-prices", materials: [{ id: "used", amount: 150, currency: "CLP" }], expenses: [], expectedFxRates: {}, source: "Factura", effectiveDate: "2026-09-22" })).toBe(true);
    expect(mutationNeedsHumanReview(state, { ...common, action: "update-expense-allocation", id: "expense", basis: "hours", shares: {} })).toBe(true);
  });

  it("does not require cost approval when no product exists yet", () => {
    const empty = { ...state, products: [], components: [] };
    expect(mutationNeedsHumanReview(empty, { ...common, action: "create-expense", name: "Electricidad", period: "2026-09", amount: 1000, currency: "CLP", allocationBasis: "units", shares: {}, source: "Factura" })).toBe(false);
  });

  it("protects confirmed production-map costs even before they are linked to the operational sheet", () => {
    const mapOnly = { ...state, products: [], components: [], materials: [{ ...state.materials[0], name: "Harina" }] };
    const priceChange: Mutation = { ...common, action: "bulk-prices", materials: [{ id: "used", amount: 150, currency: "CLP" }], expenses: [], expectedFxRates: {}, source: "Factura", effectiveDate: "2026-09-22" };
    const expenseChange: Mutation = { ...common, action: "bulk-prices", materials: [], expenses: [{ id: "expense", amount: 1500, currency: "CLP" }], expectedFxRates: {}, source: "Factura", effectiveDate: "2026-09-22" };
    expect(mutationNeedsHumanReview(mapOnly, priceChange, [evaluatedProfile])).toBe(true);
    expect(mutationNeedsHumanReview(mapOnly, expenseChange, [evaluatedProfile])).toBe(true);
    expect(mutationNeedsHumanReview(mapOnly, { ...common, action: "create-expense", name: "Electricidad", period: "2026-09", amount: 1200, currency: "CLP", allocationBasis: "units", shares: {}, source: "Factura" }, [evaluatedProfile])).toBe(true);
  });

  it("does not confuse a draft or an expense allocated only to an unfinished product with evaluated impact", () => {
    const noCompletedProduct = { ...state, products: [], components: [] };
    const draftOnly = { ...common, action: "bulk-prices" as const, materials: [{ id: "used", amount: 150, currency: "CLP" as const }], expenses: [], expectedFxRates: {}, source: "Factura", effectiveDate: "2026-09-22" };
    expect(mutationNeedsHumanReview(noCompletedProduct, draftOnly)).toBe(false);

    const manualOnlyForOtherProduct = { ...state, expenses: [{ ...state.expenses[0], allocationBasis: "manual" as const, allocationShares: { product: 0 } }] };
    const expenseChange = { ...draftOnly, materials: [], expenses: [{ id: "expense", amount: 1500, currency: "CLP" as const }] };
    expect(mutationNeedsHumanReview(manualOnlyForOtherProduct, expenseChange)).toBe(false);
  });
});
