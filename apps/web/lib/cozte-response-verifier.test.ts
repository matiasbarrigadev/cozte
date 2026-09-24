import { describe, expect, it } from "vitest";
import { correctionMessage, verifyCozteResponse, type TurnToolRecord } from "./cozte-response-verifier";

const read: TurnToolRecord = { name: "readCosts", ok: true, write: false, output: { products: [] } };
const savedProduct: TurnToolRecord = { name: "saveProduct", ok: true, write: true, output: { ok: true, ids: { product: "5cd7cb0f-e5d3-4ed4-8d6b-a0a7a8c46a23" } } };
const failedWrite: TurnToolRecord = { name: "saveExpense", ok: false, write: true, output: { ok: false, error: "No se pudo guardar" } };

describe("verifyCozteResponse", () => {
  it("rejects a fabricated 'reporte literal' when nothing was written (production trace)", () => {
    const text = "Te paso el reporte literal del motor:\n\n### ✅ Gas guardado en firme\n- **Resultado:** `applied` (guardado)\n- **ID del gasto:** `1fbfb880-6f97-4c8a-a99d-1ed8d6f28f88`";
    const result = verifyCozteResponse(text, [read]);
    expect(result.ok).toBe(false);
    expect(result.mustUseTools).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["unbacked-write-claim", "unknown-identifier"]));
  });

  it("rejects success claims when the only write failed", () => {
    const result = verifyCozteResponse("Listo, la luz quedó guardada con 350.000 al mes.", [failedWrite]);
    expect(result.issues[0].detail).toMatch(/fallaron/);
  });

  it("accepts claims backed by a successful write", () => {
    expect(verifyCozteResponse("Creé Tofu 500g con 112 unidades por lote.", [read, savedProduct]).ok).toBe(true);
  });

  it("accepts statements about stored data after a fresh read, but not first-person saves", () => {
    expect(verifyCozteResponse("Sí, los tres gastos están guardados: sueldos, gas y luz.", [read]).ok).toBe(true);
    expect(verifyCozteResponse("Sí, los tres gastos están guardados.", []).ok).toBe(false);
    expect(verifyCozteResponse("Listo, guardé el gas.", [read]).ok).toBe(false);
  });

  it("rejects announcing an action and stopping (production trace)", () => {
    const result = verifyCozteResponse("Perfecto, pruebo de nuevo crear el producto. Esta vez con el esquema real:", []);
    expect(result.issues.map((issue) => issue.code)).toEqual(["announced-not-executed"]);
    expect(result.mustUseTools).toBe(true);
    expect(verifyCozteResponse("Voy a registrar la luz apenas me confirmes el monto.", []).ok).toBe(true);
    expect(verifyCozteResponse("¿Quieres que ahora guarde el gas con 110.000 al mes?", []).ok).toBe(true);
    expect(verifyCozteResponse("Creo que conviene repartir el gas por horas. ¿Te parece?", []).ok).toBe(true);
  });

  it("does not treat negations or plans as claims", () => {
    for (const text of [
      "Todavía no guardé ese cambio porque falta el precio del gas.",
      "No lo registré: necesito saber cuántos lotes hacen al mes.",
      "¿Quieres que lo guarde con 23 lotes al mes?",
      "Voy a registrar la luz apenas me confirmes el monto.",
    ]) expect(verifyCozteResponse(text, [read]).ok, text).toBe(true);
  });

  it("flags internal names and empty answers", () => {
    expect(verifyCozteResponse("Usé applyCostAction para eso.", [read]).issues[0].code).toBe("internal-detail");
    expect(verifyCozteResponse("   ", []).issues[0].code).toBe("empty-answer");
  });

  it("builds a correction that asks for real execution", () => {
    const message = correctionMessage(verifyCozteResponse("Ya quedó creado el producto.", []));
    expect(message).toMatch(/Verificación automática/);
    expect(message).toMatch(/ejecuta ahora la herramienta/);
  });
});
