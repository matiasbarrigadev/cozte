import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { demoState } from "../demo";
import { makeQuote } from "../currency";
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
