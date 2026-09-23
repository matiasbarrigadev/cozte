import { describe, expect, it } from "vitest";
import { repairCozteToolInput } from "./cozte-tool-repair";

describe("Cozte tool argument repair", () => {
  it("converts numeric strings from small models without changing text values", () => {
    expect(JSON.parse(repairCozteToolInput("proposeMaterialPrice", '{"materialId":"mat-1","amount":"58.5","currency":"ARS","source":"Factura 58.5"}')!)).toEqual({ materialId: "mat-1", amount: 58.5, currency: "ARS", source: "Factura 58.5" });
  });

  it("unwraps a serialized/XML-wrapped change object", () => {
    const repaired = repairCozteToolInput("proposeCostAction", '{"label":"Agregar bolsa","brief":"Registrar el nuevo empaque","change":"<action>{\\"action\\":\\"create-material\\",\\"name\\":\\"Bolsa\\",\\"supplier\\":\\"Proveedor\\",\\"purchaseUnit\\":\\"unidad\\",\\"category\\":\\"Packaging\\",\\"price\\":\\"120.5\\",\\"currency\\":\\"ARS\\"}</action>"}');
    expect(JSON.parse(repaired!).change).toEqual({ action: "create-material", name: "Bolsa", supplier: "Proveedor", purchaseUnit: "unidad", category: "Packaging", price: 120.5, currency: "ARS" });
  });

  it("wraps an action object when the model omitted the change envelope", () => {
    const repaired = repairCozteToolInput("proposeCostAction", '{"action":"create-material","name":"Tela","supplier":"Proveedor","purchaseUnit":"metro","category":"Insumos","price":23}');
    expect(JSON.parse(repaired!)).toMatchObject({ label: "Actualizar Tela", change: { action: "create-material", name: "Tela", price: 23 } });
  });

  it("declines to repair unstructured text", () => {
    expect(repairCozteToolInput("proposeCostAction", "no tengo datos suficientes")).toBeNull();
  });
});
