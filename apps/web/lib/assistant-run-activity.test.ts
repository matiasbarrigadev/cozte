import { describe, expect, it } from "vitest";
import { assistantToolOutcome } from "./assistant-run-activity";

describe("assistant run tool activity", () => {
  it("describes applied changes, proposals, and drafts in plain language", () => {
    expect(assistantToolOutcome({ applied: true })).toBe("Cambio aplicado y guardado");
    expect(assistantToolOutcome({ proposal: { proposalId: "proposal-1", title: "Crear Tofu 300 g" } })).toBe("Propuesta: Crear Tofu 300 g");
    expect(assistantToolOutcome({ kind: "profile-draft", evaluableProducts: [] })).toBe("Avance guardado en el mapa");
    expect(assistantToolOutcome({ error: "El precio no es válido" })).toBe("Error: El precio no es válido");
  });

  it("summarizes read-only and calculation results", () => {
    expect(assistantToolOutcome({ organization: { name: "Empresa" } })).toBe("Datos de costos revisados");
    expect(assistantToolOutcome({ material: null, confidence: 0 })).toBe("Insumo por confirmar");
    expect(assistantToolOutcome({ directPerFinishedUnitMinor: 4 })).toBe("Cálculo listo");
  });
});
