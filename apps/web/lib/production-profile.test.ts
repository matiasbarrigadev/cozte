import { describe, expect, it } from "vitest";
import { allocateRecurringCost, calculateProductionCosts, emptyProductionProfile, inputCostPerFinishedUnit, monthlyEquivalent, profileGaps, validateProfileReferences } from "./production-profile";

describe("production profile rules", () => {
  it("normalizes periodic costs to a monthly equivalent", () => {
    expect(monthlyEquivalent(120000, "annual")).toBe(10000);
    expect(monthlyEquivalent(30000, "quarterly")).toBe(10000);
    expect(monthlyEquivalent(10000, "monthly")).toBe(10000);
  });
  it("converts a purchase package into finished-unit consumption", () => {
    expect(inputCostPerFinishedUnit({ name: "Papel", category: "Materia prima", purchaseUnit: "resma", consumptionUnit: "hoja", unitsPerPurchase: 500, usage: [{ product: "Cuaderno", quantityPerBatch: 8000 }], pricePerPurchaseMinor: 10000 }, { name: "Cuaderno", finishedUnit: "unidad", goodUnitsPerBatch: 100, startedUnitsPerBatch: 105, normalScrapUnitsPerBatch: 5, batchesPerMonth: 2, hoursPerBatch: 20 })).toBe(1600);
  });
  it("allocates an annual facility bill by monthly production hours", () => {
    expect(allocateRecurringCost({ name: "Electricidad", category: "Servicios", frequency: "annual", amountMinor: 120000, allocation: "production_hours", shares: [] }, [
      { name: "A", finishedUnit: "unidad", goodUnitsPerBatch: 10, startedUnitsPerBatch: 10, normalScrapUnitsPerBatch: 0, batchesPerMonth: 2, hoursPerBatch: 20 },
      { name: "B", finishedUnit: "unidad", goodUnitsPerBatch: 10, startedUnitsPerBatch: 10, normalScrapUnitsPerBatch: 0, batchesPerMonth: 3, hoursPerBatch: 20 },
    ])).toEqual({ A: 4000, B: 6000 });
  });
  it("flags missing manufacturing facts and invalid references", () => {
    expect(profileGaps(emptyProductionProfile)).toContain("Falta identificar dónde se fabrica");
    expect(validateProfileReferences({ ...emptyProductionProfile, inputs: [{ name: "Papel", category: "Otro", purchaseUnit: "resma", consumptionUnit: "hoja", unitsPerPurchase: null, usage: [{ product: "Cuaderno", quantityPerBatch: null }], pricePerPurchaseMinor: null }] })).toContain("Categoría inexistente: Otro");
  });
  it("computes only complete finished-unit costs and never turns missing values into zero", () => {
    const product = { name: "Cuaderno", finishedUnit: "unidad", goodUnitsPerBatch: 100, startedUnitsPerBatch: 105, normalScrapUnitsPerBatch: 5, batchesPerMonth: 2, hoursPerBatch: 20 };
    const profile = { ...emptyProductionProfile, products: [product], inputs: [{ name: "Papel", category: "Materia prima", purchaseUnit: "resma", consumptionUnit: "hoja", unitsPerPurchase: 500, usage: [{ product: "Cuaderno", quantityPerBatch: 8000 }], pricePerPurchaseMinor: 10000 }], recurringCosts: [{ name: "Luz", category: "Servicios", frequency: "monthly" as const, amountMinor: 20000, allocation: "finished_units" as const, shares: [] }] };
    expect(calculateProductionCosts(profile)[0].unitMinor).toBe(1700);
    expect(calculateProductionCosts({ ...profile, inputs: [{ ...profile.inputs[0], pricePerPurchaseMinor: null }] })[0].unitMinor).toBeNull();
  });
});
