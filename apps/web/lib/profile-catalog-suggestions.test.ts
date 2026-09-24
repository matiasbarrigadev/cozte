import { describe, expect, it } from "vitest";
import { demoState } from "./demo";
import { emptyProductionProfile, type ProductionProfile } from "./production-profile";
import { profileCatalogSuggestions } from "./profile-catalog-suggestions";

describe("mapa hacia catálogo de costos", () => {
  it("prepara altas sin escribir en el estado vigente", () => {
    const profile: ProductionProfile = { ...emptyProductionProfile, products: [{ name: "Producto nuevo", finishedUnit: "unidad", goodUnitsPerBatch: 10, startedUnitsPerBatch: 10, normalScrapUnitsPerBatch: 0, batchesPerMonth: 1, hoursPerBatch: 2 }], inputs: [{ name: "Pegamento", category: "Materias primas", purchaseUnit: "litro", consumptionUnit: "ml", unitsPerPurchase: 1000, usage: [], pricePerPurchaseMinor: null }], recurringCosts: [{ name: "Arriendo", category: "Instalaciones", frequency: "quarterly", amountMinor: 90000, allocation: "production_hours", shares: [] }] };
    const result = profileCatalogSuggestions(profile, demoState);
    expect(result.missingProducts).toEqual(["Producto nuevo"]);
    expect(result.actions.find((item) => item.key === "material:Pegamento")?.action).toMatchObject({ action: "create-material", name: "Pegamento" });
    expect(result.actions.find((item) => item.key === "material:Pegamento")?.action).not.toHaveProperty("price");
    expect(result.actions.some((item) => item.key === "expense:Arriendo")).toBe(false);
    expect(result.issues).toContain("Faltan fichas de Producto nuevo para sincronizar el reparto de Arriendo");
    expect(demoState.materials.some((item) => item.name === "Pegamento")).toBe(false);
  });

  it("convierte consumo a unidades de compra antes de proponer asignación", () => {
    const profile: ProductionProfile = { ...emptyProductionProfile, products: [{ name: "Cuaderno A5 · tapa dura", finishedUnit: "unidad", goodUnitsPerBatch: 100, startedUnitsPerBatch: 100, normalScrapUnitsPerBatch: 0, batchesPerMonth: 1, hoursPerBatch: 20 }], inputs: [{ name: "Papel interior", category: "Papel", purchaseUnit: "resma", consumptionUnit: "hoja", unitsPerPurchase: 500, usage: [{ product: "Cuaderno A5 · tapa dura", quantityPerBatch: 8000 }], pricePerPurchaseMinor: 9000 }] };
    expect(profileCatalogSuggestions(profile, demoState).actions.find((item) => item.key === "usage:papel:dura")?.action).toMatchObject({ action: "set-component", quantityMilli: 16000 });
  });
});
