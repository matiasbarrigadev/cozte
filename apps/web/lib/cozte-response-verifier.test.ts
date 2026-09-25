import { describe, expect, it } from "vitest";
import { correctionMessage, receiptOnlyAnswer, verifyCozteResponse, type TurnToolRecord } from "./cozte-response-verifier";

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

  it("catches state claims phrased without a participle (MiniMax evaluation)", () => {
    for (const text of [
      "Listo, quedaron las dos recetas. Ahora faltan los gastos compartidos del mes.",
      "Anotado: el tercer socio cobra solo con ganancias.",
      "Ya tenemos los insumos, sigamos con la receta.",
      "Cargadas las dos. Ahora los costos quedaron completos:",
      "Perfecto. Guardado el gas en 110.000 al mes.",
      "Gas y luz cargados. Costos por unidad actualizados:",
      "Quedaron así los costos finales por unidad:",
    ]) expect(verifyCozteResponse(text, []).issues.map((issue) => issue.code), text).toContain("unbacked-write-claim");
    expect(verifyCozteResponse("Listo, quedaron las dos recetas.", [savedProduct]).ok).toBe(true);
    expect(verifyCozteResponse("Revisé: quedaron los tres gastos del mes.", [read]).ok).toBe(true);
    expect(verifyCozteResponse("Para avanzar necesito la receta: ¿cuánta soja usan por tanda?", []).ok).toBe(true);
    expect(verifyCozteResponse("¿Quedó cargado el gas en la planilla? Si no, dime el monto.", []).ok).toBe(true);
    expect(verifyCozteResponse("El gas todavía no está cargado; ¿cuánto pagan por mes?", []).ok).toBe(true);
    expect(verifyCozteResponse("¿Querés que deje guardado el gas con 110.000?", []).ok).toBe(true);
  });

  it("rejects money figures a tool-less turn could only have computed from memory (MiniMax evaluation)", () => {
    const snapshot = '<costos_al_inicio>{"products":[{"name":"Tofu 300g","cost":{"unitCost":1070,"perUnit":{"materials":588,"sharedExpenses":482}},"recipe":[{"material":"Soja","costPerUnit":271.14}]}]}</costos_al_inicio>';
    const context = { sources: [snapshot, "Si la soja sube a 1800 el kilo, ¿cómo me cambia el costo?"] };
    const invented = verifyCozteResponse("Con soja a ARS 1.800 el Tofu 300g pasa de ARS 1.070 a ARS 1.176 por unidad.", [], context);
    expect(invented.issues.map((issue) => issue.code)).toEqual(["unverified-figures"]);
    expect(invented.issues[0].detail).toContain("1176");
    expect(invented.mustUseTools).toBe(true);
    expect(verifyCozteResponse("Te cuesta $1.070 por unidad: $588 de insumos (la soja, $271,14) y $482 de gastos del taller.", [], context).ok).toBe(true);
    expect(verifyCozteResponse("Pasaría a ARS 1.176 por unidad.", [{ name: "simulate", ok: true, write: false, output: { products: [{ unitCostAfter: 1176 }] } }], context).ok).toBe(true);
  });

  it("treats a 'Listo' opener as a claim only in a turn without tools", () => {
    const simulate: TurnToolRecord = { name: "simulate", ok: true, write: false, output: { saved: false } };
    expect(verifyCozteResponse("Listo, simulado sin guardar nada. Así queda:", [simulate]).ok).toBe(true);
    expect(verifyCozteResponse("Listo. Pasemos a los gastos del mes.", []).issues[0].code).toBe("unbacked-write-claim");
  });

  it("rejects stray text in another script", () => {
    expect(verifyCozteResponse("¿Algo más (sal, agua, 包装/etiquetas si empacan)?", []).issues[0].code).toBe("foreign-script");
  });

  it("lets a fresh read back first-person claims explicitly about earlier turns", () => {
    expect(verifyCozteResponse("Revisé la base: los sueldos los registré antes, en esta charla, y siguen ahí.", [read]).ok).toBe(true);
    expect(verifyCozteResponse("Los sueldos los registré antes y siguen ahí.", []).ok).toBe(false);
    expect(verifyCozteResponse("Revisé y registré el gas.", [read]).ok).toBe(false);
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

  it("builds a receipt-only fallback that still reports what is stored", () => {
    const overview: TurnToolRecord = { name: "readCosts", ok: true, write: false, output: { ok: true, currency: "ARS", products: [{ name: "Tofu 300g", cost: { unitCost: 1070, status: "estimated" } }, { name: "Tofu 500g", cost: { unitCost: null, status: "incomplete" } }], materials: [{}, {}], monthlyExpenses: [{ name: "Gas", monthlyAmount: 110000 }] } };
    const text = receiptOnlyAnswer([overview, failedWrite]);
    expect(text).toContain("En este turno no guardé cambios.");
    expect(text).toContain("No se guardó: No se pudo guardar");
    expect(text).toContain("productos Tofu 300g (ARS 1.070 por unidad, estimado)");
    expect(text).toContain("Gas (ARS 110.000 al mes)");
    expect(verifyCozteResponse(text, [overview, failedWrite]).ok).toBe(true);
  });
});
