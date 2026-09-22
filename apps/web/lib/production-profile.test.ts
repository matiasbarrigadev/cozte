import { describe, expect, it } from "vitest";
import { allocateRecurringCost, calculateProductionCosts, emptyProductionProfile, inputCostPerFinishedUnit, monthlyEquivalent, profileGaps, validateProfileReferences } from "./production-profile";
import { makeQuote } from "./currency";

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
  it("converts foreign recurring and direct costs before distributing them", () => {
    const product = { name: "Caja", finishedUnit: "unidad", goodUnitsPerBatch: 10, startedUnitsPerBatch: 10, normalScrapUnitsPerBatch: 0, batchesPerMonth: 1, hoursPerBatch: 10 };
    const profile = { ...emptyProductionProfile, products: [product], inputs: [{ name: "Certificación", category: "Servicio", purchaseUnit: "lote", consumptionUnit: "lote", unitsPerPurchase: 1, usage: [{ product: "Caja", quantityPerBatch: 1 }], pricePerPurchaseMinor: null, pricePerPurchase: 2, priceCurrency: "USD" as const }], recurringCosts: [{ name: "Energía", category: "Servicios", frequency: "monthly" as const, amountMinor: null, amount: 3, amountCurrency: "USD" as const, allocation: "finished_units" as const, shares: [] }] };
    expect(calculateProductionCosts(profile, "CLP")[0].unitMinor).toBeNull();
    const quote = makeQuote("USD", "CLP", { CLP: 1000 }, "2026-09-22T04:59:00.000Z", "FXRatesAPI")!;
    expect(calculateProductionCosts(profile, "CLP", { USD: quote })[0].unitMinor).toBe(500);
  });
});
