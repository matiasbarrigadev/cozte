import { describe, expect, it } from "vitest";
import { missingCozteProductFields, normalizeCozteProductAction, unconfirmedCozteProductZeroFields } from "./cozte-product-input";

describe("normalizeCozteProductAction", () => {
  it("converts user-facing product fields into the cost engine units", () => {
    expect(normalizeCozteProductAction({
      action: "create-product", name: "Tofu 300 g", lotUnits: 10, salePrice: 2500,
      salesVariablePerUnit: 100, laborCostPerLot: 1200, productionHoursPerLot: 1.25,
    })).toEqual({
      action: "create-product", name: "Tofu 300 g", lotUnits: 10, salePriceMinor: 2500,
      salesVariableMinor: 100, laborLotMinor: 1200, productionHoursMilli: 1250,
    });
  });

  it("normalizes every item in a multi-product action and preserves legacy engine fields", () => {
    expect(normalizeCozteProductAction({ action: "create-products", products: [
      { name: "Tofu 300 g", productionHoursPerLot: 0.5, salePrice: 2000 },
      { name: "Tofu 500 g", productionHoursMilli: 750, salePriceMinor: 3000 },
    ] })).toEqual({ action: "create-products", products: [
      { name: "Tofu 300 g", productionHoursMilli: 500, salePriceMinor: 2000 },
      { name: "Tofu 500 g", productionHoursMilli: 750, salePriceMinor: 3000 },
    ] });
  });
});

describe("unconfirmedCozteProductZeroFields", () => {
  it("rejects invented zeroes and invented quotes", () => {
    const product = { salePrice: 0, salesVariablePerUnit: 0, laborCostPerLot: 0, productionHoursPerLot: 24 };
    expect(unconfirmedCozteProductZeroFields(product, ["Lote 112, 24 horas; los precios siguen pendientes."])).toEqual([
      "precio de venta por unidad", "gasto variable por unidad", "trabajo directo por lote",
    ]);
    expect(unconfirmedCozteProductZeroFields({ ...product, zeroEvidence: { salePrice: "precio de venta 0" } }, ["No conozco el precio"])).toContain("precio de venta por unidad");
  });
  it("accepts a field-specific quote actually written by the user", () => {
    const quote = "sin gasto variable por unidad";
    expect(unconfirmedCozteProductZeroFields({ salesVariablePerUnit: 0, zeroEvidence: { salesVariablePerUnit: quote } }, ["Por ahora es sin gasto variable por unidad."])).toEqual([]);
  });
});

describe("missingCozteProductFields", () => {
  it("treats null/omitted facts as missing but preserves confirmed zeroes", () => {
    expect(missingCozteProductFields({ lotUnits: 12, salePrice: 0, salesVariablePerUnit: 0, laborCostPerLot: null })).toEqual([
      "trabajo directo por lote",
      "horas de producción por lote",
    ]);
    expect(missingCozteProductFields({ lotUnits: 12, salePrice: 0, salesVariablePerUnit: 0, laborCostPerLot: 0, productionHoursPerLot: 0 })).toEqual([]);
  });
});
