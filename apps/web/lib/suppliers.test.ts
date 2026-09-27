import { describe, expect, it } from "vitest";
import { materialPrices, sortSuppliers, supplierInsights, supplierMonths, supplierStats, suppliersFromHistory, type SupplierPurchase, type SupplierRow } from "./suppliers";

const purchase = (id: string, purchasedOn: string, amountMinor: number, patch: Partial<SupplierPurchase> = {}): SupplierPurchase => ({ id, supplierId: "s", purchasedOn, description: "Compra", kind: "material", amountMinor, materialId: null, materialName: null, quantityMilli: null, ...patch });
const paper = (id: string, on: string, quantity: number, unitPrice: number) => purchase(id, on, quantity * unitPrice, { materialId: "papel", materialName: "Papel", quantityMilli: quantity * 1000, purchaseUnit: "resma" });
const row = (id: string, name: string, patch: Partial<SupplierRow> = {}): SupplierRow => ({ id, name, kind: "materials", contactName: "", phone: "", email: "", notes: "", source: "user", createdAt: "", stats: supplierStats([], "2026-09-27"), materials: [], prices: [], zones: [], deliveries: null, ...patch });

describe("suppliers", () => {
  it("builds suppliers once from typed names, joining spellings and preferring the supplies kind", () => {
    const found = suppliersFromHistory([
      { name: "Papelería Sur", kind: "services", on: "2026-05-01" },
      { name: "papeleria sur ", kind: "materials", on: "2026-09-01" },
      { name: "Starken", kind: "logistics" },
      { name: "  ", kind: "materials" },
    ]);
    expect(found.map((item) => [item.name, item.kind, item.names.length])).toEqual([["papeleria sur", "materials", 2], ["Starken", "logistics", 1]]);
  });

  it("follows each supply's price per purchase unit, oldest first", () => {
    const prices = materialPrices([paper("c", "2026-08-03", 30, 8800), paper("a", "2026-04-03", 30, 8000), purchase("x", "2026-05-01", 5000), paper("b", "2026-06-03", 20, 8400)]);
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({ name: "Papel", unit: "resma", first: 8000, last: 8800, lastOn: "2026-08-03" });
    expect(prices[0].points.map((point) => point.unitPrice)).toEqual([8000, 8400, 8800]);
    expect(prices[0].change).toBeCloseTo(0.1);
  });

  it("counts what was spent in the year, how often it buys and each month", () => {
    const list = [purchase("a", "2025-08-01", 1000), purchase("b", "2026-03-01", 2000), purchase("c", "2026-09-01", 3000)];
    expect(supplierStats(list, "2026-09-27")).toMatchObject({ purchases: 3, spent: 5000, firstOn: "2025-08-01", lastOn: "2026-09-01", daysSinceLast: 26 });
    expect(supplierMonths(list, ["2026-08", "2026-09"])).toEqual([{ month: "2026-08", amount: 0, purchases: 0 }, { month: "2026-09", amount: 3000, purchases: 1 }]);
  });

  it("points out rising prices, single sources and concentration", () => {
    const money = (value: number) => `$${value}`;
    const prices = materialPrices([paper("a", "2026-04-03", 30, 8000), paper("b", "2026-08-03", 30, 9000)]);
    const rows = sortSuppliers([
      row("1", "Papelería Sur", { materials: ["Papel"], prices, stats: { ...supplierStats([purchase("a", "2026-08-01", 90000)], "2026-09-27") } }),
      row("2", "Tapas Centro", { materials: ["Tapas"], stats: supplierStats([purchase("b", "2026-08-01", 5000)], "2026-09-27") }),
      row("3", "Luz", { kind: "services", stats: supplierStats([purchase("c", "2026-08-01", 5000)], "2026-09-27") }),
    ]);
    expect(rows[0].name).toBe("Papelería Sur");
    const texts = supplierInsights(rows, money).map((item) => item.text);
    expect(texts[0]).toBe("Papel con Papelería Sur subió 13 %: de $8000 a $9000 por resma.");
    expect(texts.some((text) => text.startsWith("Papel, Tapas se compran a un solo proveedor"))).toBe(true);
    expect(texts.some((text) => text.startsWith("Papelería Sur se lleva el 90 %"))).toBe(true);
  });
});
