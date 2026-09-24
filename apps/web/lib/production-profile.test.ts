import { describe, expect, it } from "vitest";
import { allocateRecurringCost, calculateProductionCosts, changesEvaluatedProductCosts, emptyProductionProfile, evaluableProfileProducts, inputCostPerFinishedUnit, monthlyEquivalent, productionProfileReviewReason, profileGaps, validateProfileReferences } from "./production-profile";
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
  it("marks a fully modeled product ready while an unrelated product remains in construction", () => {
    const ready = { name: "Cuaderno", finishedUnit: "unidad", goodUnitsPerBatch: 100, startedUnitsPerBatch: 105, normalScrapUnitsPerBatch: 5, batchesPerMonth: 2, hoursPerBatch: 20 };
    const profile = {
      ...emptyProductionProfile,
      site: { name: "Planta", location: "Santiago" }, stages: [{ name: "Armado", notes: "" }],
      categories: [{ name: "Materias primas" }],
      products: [ready, { name: "Pendiente", finishedUnit: "unidad", goodUnitsPerBatch: null, startedUnitsPerBatch: null, normalScrapUnitsPerBatch: null, batchesPerMonth: null, hoursPerBatch: null }],
      inputs: [{ name: "Papel", category: "Materias primas", purchaseUnit: "resma", consumptionUnit: "hoja", unitsPerPurchase: 500, usage: [{ product: "Cuaderno", quantityPerBatch: 8000 }], pricePerPurchaseMinor: 10000, evidence: { quality: "measured" as const, source: "Factura", asOf: "2026-09-20" } }],
    };
    expect(evaluableProfileProducts(profile)).toEqual(["Cuaderno"]);
    expect(productionProfileReviewReason(null, profile)).toBeNull();
    expect(productionProfileReviewReason(profile, { ...profile, inputs: [{ ...profile.inputs[0], pricePerPurchaseMinor: 12000 }] })).toBeNull();
    expect(productionProfileReviewReason(profile, { ...profile, products: [] })).toBe("remove-production-data");
    expect(productionProfileReviewReason(profile, { ...profile, inputs: [] })).toBe("remove-production-data");
    expect(changesEvaluatedProductCosts(null, profile)).toBe(false);
    expect(changesEvaluatedProductCosts(profile, { ...profile, inputs: [{ ...profile.inputs[0], pricePerPurchaseMinor: 12000 }] })).toBe(true);
  });
  it("does not require approval for a category-only rename on an evaluated product", () => {
    const profile = {
      ...emptyProductionProfile,
      site: { name: "Planta", location: "Santiago" }, stages: [{ name: "Armado", notes: "" }],
      categories: [{ name: "Materias primas" }],
      products: [{ name: "Cuaderno", finishedUnit: "unidad", goodUnitsPerBatch: 100, startedUnitsPerBatch: 105, normalScrapUnitsPerBatch: 5, batchesPerMonth: 2, hoursPerBatch: 20 }],
      inputs: [{ name: "Papel", category: "Materias primas", purchaseUnit: "resma", consumptionUnit: "hoja", unitsPerPurchase: 500, usage: [{ product: "Cuaderno", quantityPerBatch: 8000 }], pricePerPurchaseMinor: 10000, evidence: { quality: "measured" as const, source: "Factura", asOf: "2026-09-20" } }],
    };
    const categorized = { ...profile, categories: [{ name: "Insumos" }], inputs: [{ ...profile.inputs[0], category: "Insumos" }] };
    expect(changesEvaluatedProductCosts(profile, categorized)).toBe(false);
  });
  it("allows ordinary changes to evaluated costs but protects removals from the production map", () => {
    const profile = {
      ...emptyProductionProfile,
      products: [{ name: "Cuaderno", finishedUnit: "unidad", goodUnitsPerBatch: 100, startedUnitsPerBatch: 100, normalScrapUnitsPerBatch: 0, batchesPerMonth: 2, hoursPerBatch: 20 }],
      inputs: [{ name: "Papel", category: "Materias primas", purchaseUnit: "resma", consumptionUnit: "hoja", unitsPerPurchase: 500, usage: [{ product: "Cuaderno", quantityPerBatch: 8000 }], pricePerPurchaseMinor: 10000 }],
      recurringCosts: [{ name: "Luz", category: "Servicios", frequency: "monthly" as const, amountMinor: 20000, allocation: "finished_units" as const, shares: [] }],
    };
    expect(productionProfileReviewReason(profile, { ...profile, recurringCosts: [{ ...profile.recurringCosts[0], amountMinor: 22000 }] })).toBeNull();
    expect(productionProfileReviewReason(profile, { ...profile, recurringCosts: [] })).toBe("remove-production-data");
  });
  it("requests review only for recurring costs that actually reach an evaluated product", () => {
    const profile = {
      ...emptyProductionProfile,
      site: { name: "Planta", location: "Santiago" }, stages: [{ name: "Armado", notes: "" }],
      categories: [{ name: "Materias primas" }, { name: "Servicios" }],
      products: [
        { name: "Cuaderno", finishedUnit: "unidad", goodUnitsPerBatch: 100, startedUnitsPerBatch: null, normalScrapUnitsPerBatch: null, batchesPerMonth: 2, hoursPerBatch: null },
        { name: "En armado", finishedUnit: "unidad", goodUnitsPerBatch: null, startedUnitsPerBatch: null, normalScrapUnitsPerBatch: null, batchesPerMonth: null, hoursPerBatch: null },
      ],
      inputs: [{ name: "Papel", category: "Materias primas", purchaseUnit: "resma", consumptionUnit: "hoja", unitsPerPurchase: 500, usage: [{ product: "Cuaderno", quantityPerBatch: 8000 }], pricePerPurchaseMinor: 10000, evidence: { quality: "measured" as const, source: "Factura", asOf: "2026-09-20" } }],
      recurringCosts: [
        { name: "Electricidad", category: "Servicios", frequency: "monthly" as const, amountMinor: 20000, allocation: "manual_percentage" as const, shares: [{ product: "Cuaderno", percent: 100 }, { product: "En armado", percent: 0 }], evidence: { quality: "measured" as const, source: "Factura", asOf: "2026-09-20" } },
        { name: "Seguro", category: "Servicios", frequency: "monthly" as const, amountMinor: 5000, allocation: "manual_percentage" as const, shares: [{ product: "Cuaderno", percent: 0 }, { product: "En armado", percent: 100 }], evidence: { quality: "measured" as const, source: "Factura", asOf: "2026-09-20" } },
      ],
    };
    expect(evaluableProfileProducts(profile)).toEqual(["Cuaderno"]);
    expect(changesEvaluatedProductCosts(profile, { ...profile, recurringCosts: profile.recurringCosts.map((cost) => cost.name === "Seguro" ? { ...cost, amountMinor: 8000 } : cost) })).toBe(false);
    expect(changesEvaluatedProductCosts(profile, { ...profile, recurringCosts: profile.recurringCosts.map((cost) => cost.name === "Electricidad" ? { ...cost, amountMinor: 25000 } : cost) })).toBe(true);
    expect(changesEvaluatedProductCosts(profile, { ...profile, stages: [{ name: "Empaque final", notes: "Nueva descripción" }] })).toBe(false);
  });
  it("does not gate cost evaluation on optional scrap classification", () => {
    const profile = {
      ...emptyProductionProfile,
      site: { name: "Planta", location: "Santiago" }, stages: [{ name: "Armado", notes: "" }], categories: [{ name: "Materias primas" }],
      products: [{ name: "Cuaderno", finishedUnit: "unidad", goodUnitsPerBatch: 100, startedUnitsPerBatch: null, normalScrapUnitsPerBatch: null, batchesPerMonth: 2, hoursPerBatch: null }],
      inputs: [{ name: "Papel", category: "Materias primas", purchaseUnit: "resma", consumptionUnit: "hoja", unitsPerPurchase: 500, usage: [{ product: "Cuaderno", quantityPerBatch: 8000 }], pricePerPurchaseMinor: 10000, evidence: { quality: "measured" as const, source: "Factura", asOf: "2026-09-20" } }],
    };
    expect(evaluableProfileProducts(profile)).toEqual(["Cuaderno"]);
    expect(changesEvaluatedProductCosts(profile, { ...profile, products: [{ ...profile.products[0], normalScrapUnitsPerBatch: 8 }] })).toBe(false);
  });
});
