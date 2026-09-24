import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { demoState } from "../demo";
import { makeQuote } from "../currency";
import { mutationProposalPresentation } from "../proposal-presentation";
import { mutationSchema, previewMutation } from "./mutations";

const common = { expectedRevision: demoState.revision, idempotencyKey: "123e4567-e89b-42d3-a456-426614174000" };

describe("planilla editable", () => {
  it("guarda una categoría sin perder el precio vigente", () => {
    const input = mutationSchema.parse({ ...common, action: "update-material-meta", id: "papel", field: "category", value: "Fibras" });
    const result = previewMutation(demoState, input);
    expect(result.next.materials.find((item) => item.id === "papel")?.category).toBe("Fibras");
    expect(result.next.materials.find((item) => item.id === "papel")?.priceMinor).toBe(9000);
    expect(result.after).toEqual(result.before);
  });

  it("exige confirmar el cambio de unidad de un insumo compartido", () => {
    const input = mutationSchema.parse({ ...common, action: "update-material-meta", id: "papel", field: "purchaseUnit", value: "caja" });
    expect(() => previewMutation(demoState, input)).toThrow("Confirma el cambio de unidad");
    const confirmed = mutationSchema.parse({ ...common, action: "update-material-meta", id: "papel", field: "purchaseUnit", value: "caja", acknowledgeImpact: true });
    expect(previewMutation(demoState, confirmed).next.materials.find((item) => item.id === "papel")?.purchaseUnit).toBe("caja");
  });

  it("exige confirmar una nueva base de reparto", () => {
    const input = mutationSchema.parse({ ...common, action: "update-expense-meta", id: "electricidad", field: "allocationBasis", value: "units" });
    expect(() => previewMutation(demoState, input)).toThrow("Confirma el nuevo reparto");
    const confirmed = mutationSchema.parse({ ...common, action: "update-expense-meta", id: "electricidad", field: "allocationBasis", value: "units", acknowledgeImpact: true });
    const result = previewMutation(demoState, confirmed);
    expect(result.next.expenses.find((item) => item.id === "electricidad")?.allocationBasis).toBe("units");
    expect(result.after.find((item) => item.productId === "dura")?.unitMinor).not.toBe(result.before.find((item) => item.productId === "dura")?.unitMinor);
  });

  it("permite editar el período de un gasto solo después de revisar su impacto", () => {
    const input = mutationSchema.parse({ ...common, action: "update-expense-meta", id: "electricidad", field: "period", value: "2026-10" });
    expect(() => previewMutation(demoState, input)).toThrow("Confirma el cambio de período");
    const confirmed = mutationSchema.parse({ ...common, action: "update-expense-meta", id: "electricidad", field: "period", value: "2026-10", acknowledgeImpact: true });
    const result = previewMutation(demoState, confirmed);
    expect(result.next.activePeriod).toBe("2026-10");
    expect(result.next.expenses.find((item) => item.id === "electricidad")?.period).toBe("2026-10");
    expect(result.after.find((item) => item.productId === "dura")?.totalLotMinor).not.toBe(result.before.find((item) => item.productId === "dura")?.totalLotMinor);
  });

  it("rechaza un período de gasto inválido", () => {
    const input = mutationSchema.parse({ ...common, action: "update-expense-meta", id: "electricidad", field: "period", value: "2026-13", acknowledgeImpact: true });
    expect(() => previewMutation(demoState, input)).toThrow("período válido");
  });

  it("expone edición completa de producto en la propuesta que revisa la persona", () => {
    const input = mutationSchema.parse({ ...common, action: "update-product", id: "dura", name: "Cuaderno A5 premium", lotUnits: 90, salePriceMinor: 6000, salesVariableMinor: 500, laborLotMinor: 65000, productionHoursMilli: 22000 });
    const preview = previewMutation(demoState, input);
    const presentation = mutationProposalPresentation(demoState, JSON.parse(JSON.stringify(input)) as Record<string, unknown>, preview.before, preview.after, { brief: "Actualizar el lote y precio acordados." });
    expect(presentation.details.sections.find((section) => section.title === "Cambio propuesto")?.lines).toEqual(expect.arrayContaining([
      expect.stringContaining("Cuaderno A5 · tapa dura → Cuaderno A5 premium"),
      expect.stringContaining("Unidades por lote: 100 → 90"),
      expect.stringContaining("Precio de venta por unidad"),
      expect.stringContaining("Horas de producción por lote"),
    ]));
  });

  it("renombra una categoría de negocio sin alterar el costeo", () => {
    const state = { ...demoState, categories: [{ id: "papel-category", name: "Papel" }] };
    const input = mutationSchema.parse({ ...common, action: "rename-category", id: "papel-category", name: "Materias primas" });
    const result = previewMutation(state, input);
    expect(result.next.materials.find((item) => item.id === "papel")?.category).toBe("Materias primas");
    expect(result.after).toEqual(result.before);
  });

  it("valida porcentajes antes de cambiar el reparto", () => {
    const invalid = mutationSchema.parse({ ...common, action: "update-expense-allocation", id: "electricidad", basis: "manual", shares: { dura: 5000, blanda: 3000 } });
    expect(() => previewMutation(demoState, invalid)).toThrow("100 %");
    const valid = mutationSchema.parse({ ...common, action: "update-expense-allocation", id: "electricidad", basis: "manual", shares: { dura: 5000, blanda: 3000, bolsillo: 2000 }, acknowledgeImpact: true });
    const result = previewMutation(demoState, valid);
    expect(result.next.expenses.find((item) => item.id === "electricidad")?.allocationBasis).toBe("manual");
    expect(result.after.find((item) => item.productId === "dura")?.unitMinor).not.toBe(result.before.find((item) => item.productId === "dura")?.unitMinor);
  });

  it("crea un gasto con reparto manual completo desde el inicio", () => {
    const input = mutationSchema.parse({ ...common, action: "create-expense", name: "Seguros", period: "2026-09", amount: 10000, currency: "CLP", category: "Servicios", source: "Factura", allocationBasis: "manual", shares: { dura: 5000, blanda: 3000, bolsillo: 2000 } });
    const result = previewMutation(demoState, input);
    expect(result.next.expenses.find((item) => item.name === "Seguros")?.allocationShares).toEqual({ dura: 5000, blanda: 3000, bolsillo: 2000 });
    expect(result.after.every((item) => item.unitMinor !== null)).toBe(true);
  });

  it("prepara una propuesta explicativa y atómica para crear varias fichas de producto", () => {
    const input = mutationSchema.parse({ ...common, action: "create-products", products: [
      { name: "Tofu 300 g", lotUnits: 10, salePriceMinor: 2500, salesVariableMinor: 0, laborLotMinor: 1000, productionHoursMilli: 1000 },
      { name: "Tofu 500 g", lotUnits: 8, salePriceMinor: 3900, salesVariableMinor: 0, laborLotMinor: 1200, productionHoursMilli: 1200 },
    ] });
    const preview = previewMutation(demoState, input);
    const presentation = mutationProposalPresentation(demoState, JSON.parse(JSON.stringify(input)) as Record<string, unknown>, preview.before, preview.after);
    expect(presentation.title).toBe("Propuesta: Crear estos 2 productos");
    expect(presentation.summary).toContain("Tofu 300 g");
    expect(presentation.summary).toContain("Tofu 500 g");
    expect(presentation.details.sections.find((section) => section.title === "Cambio propuesto")?.lines).toEqual(expect.arrayContaining([
      expect.stringContaining("Tofu 300 g"), expect.stringContaining("Tofu 500 g"),
    ]));
    expect(presentation.details.sections.find((section) => section.title === "Cambio propuesto")?.lines).toContain("Composición inicial vacía: los insumos y consumos se cargarán por separado.");
  });

  it("archiva un insumo y lo quita de los cálculos vigentes sin borrar el historial", () => {
    const input = mutationSchema.parse({ ...common, action: "delete-material", id: "papel" });
    const preview = previewMutation(demoState, input);
    const presentation = mutationProposalPresentation(demoState, JSON.parse(JSON.stringify(input)) as Record<string, unknown>, preview.before, preview.after);

    expect(preview.next.materials.some((item) => item.id === "papel")).toBe(false);
    expect(preview.next.components.some((item) => item.materialId === "papel")).toBe(false);
    expect(presentation.details.sections.find((section) => section.title === "Cambio propuesto")?.lines).toContain("Se quitará del catálogo, de las composiciones y de los costos vigentes; el historial se conserva.");
  });

  it("redistribuye los gastos manuales restantes al archivar un producto", () => {
    const state = {
      ...demoState,
      expenses: [{ id: "manual", name: "Seguro", period: "2026-09", amountMinor: 10_000, allocationBasis: "manual" as const, allocationShares: { dura: 6000, blanda: 3000, bolsillo: 1000 }, category: "Servicios", version: 1 }],
    };
    const input = mutationSchema.parse({ ...common, action: "delete-product", id: "dura" });
    const preview = previewMutation(state, input);

    expect(preview.next.products.some((item) => item.id === "dura")).toBe(false);
    expect(preview.next.expenses[0].allocationShares).toEqual({ blanda: 7500, bolsillo: 2500 });
    expect(preview.after.every((item) => !item.warnings.includes("Falta actividad para repartir gastos por manual"))).toBe(true);
  });

  it("convierte un insumo USD a la moneda base sin perder su importe original", () => {
    const quote = makeQuote("USD", "CLP", { CLP: 950 }, "2026-09-22T03:59:00.000Z", "FXRatesAPI")!;
    const state = { ...demoState, fxQuotes: { USD: quote } };
    const input = mutationSchema.parse({ ...common, action: "bulk-prices", materials: [{ id: "papel", amount: 12.5, currency: "USD" }], expenses: [], source: "Factura", effectiveDate: "2026-09-22", expectedFxRates: { USD: quote.ratePpm } });
    const result = previewMutation(state, input);
    const material = result.next.materials.find((item) => item.id === "papel")!;
    expect(material.nativeAmountMilli).toBe(12_500);
    expect(material.currency).toBe("USD");
    expect(material.priceMinor).toBe(11_875);
    expect(result.after.find((item) => item.productId === "dura")?.unitMinor).not.toBe(result.before.find((item) => item.productId === "dura")?.unitMinor);
  });
});
