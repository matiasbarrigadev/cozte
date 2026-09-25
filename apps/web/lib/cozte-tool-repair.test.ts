import { describe, expect, it } from "vitest";
import { repairCozteToolInput } from "./cozte-tool-repair";

describe("Cozte tool argument repair", () => {
  it("converts numeric strings without changing text values", () => {
    expect(JSON.parse(repairCozteToolInput("saveMaterial", '{"material":"Bolsa","price":"58.5","currency":"ARS","priceSource":"Factura 58.5"}')!)).toEqual({ material: "Bolsa", price: 58.5, currency: "ARS", priceSource: "Factura 58.5" });
  });

  it("parses lists that arrive as serialized strings", () => {
    const repaired = repairCozteToolInput("saveRecipe", '{"product":"Tofu 300g","items":"[{\\"material\\":\\"Soja\\",\\"perUnit\\":\\"0.21\\"}]"}');
    expect(JSON.parse(repaired!)).toEqual({ product: "Tofu 300g", items: [{ material: "Soja", perUnit: 0.21 }] });
  });

  it("unwraps fenced JSON and textual nulls in numeric fields", () => {
    const repaired = repairCozteToolInput("saveProduct", '```json\n{"name":"Tofu 500g","goodUnitsPerLot":"112","salePrice":"null"}\n```');
    expect(JSON.parse(repaired!)).toEqual({ name: "Tofu 500g", goodUnitsPerLot: 112, salePrice: null });
  });

  it("declines to repair unstructured text", () => {
    expect(repairCozteToolInput("saveProduct", "no tengo datos suficientes")).toBeNull();
  });
});
