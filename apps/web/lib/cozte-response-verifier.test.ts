import { describe, expect, it } from "vitest";
import { correctionMessage, discardReason, finalAnswerStep, hasHardIssue, receiptOnlyAnswer, salvageAnswer, stripForeignScript, verifyCozteResponse, type TurnToolRecord } from "./cozte-response-verifier";

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

  it("strips stray text in another script instead of rejecting the answer", () => {
    expect(verifyCozteResponse("¿Algo más (sal, agua, 包装/etiquetas si empacan)?", []).ok).toBe(true);
    expect(stripForeignScript("La tela フィルム cuesta ARS 348.")).toBe("La tela cuesta ARS 348.");
  });

  it("does not treat illustrative amounts as claims about stored costs", () => {
    const context = { sources: ["<costos_al_inicio>{}</costos_al_inicio>", "¿qué costos faltan?"] };
    expect(verifyCozteResponse("Por ejemplo, si el alquiler fuera ARS 5.000 al mes, se repartiría por horas.", [], context).ok).toBe(true);
    expect(verifyCozteResponse("El alquiler te suma ARS 5.000 al mes.", [], context).ok).toBe(false);
  });

  it("separates hard issues from the ones worth only a retry", () => {
    expect(hasHardIssue(verifyCozteResponse("Guardé el gas.", []))).toBe(true);
    expect(hasHardIssue(verifyCozteResponse("Usé readCosts para revisar.", [{ name: "readCosts", ok: true, write: false, output: {} }]))).toBe(false);
  });

  it("lets a fresh read back first-person claims explicitly about earlier turns", () => {
    expect(verifyCozteResponse("Revisé la base: los sueldos los registré antes, en esta charla, y siguen ahí.", [read]).ok).toBe(true);
    expect(verifyCozteResponse("Los sueldos los registré antes y siguen ahí.", []).ok).toBe(false);
    expect(verifyCozteResponse("Revisé y registré el gas.", [read]).ok).toBe(false);
  });

  it("rejects announcing an action and stopping (production trace)", () => {
    const result = verifyCozteResponse("Perfecto, pruebo de nuevo crear el producto. Esta vez con el esquema real:", []);
    expect(result.issues.map((issue) => issue.code)).toEqual(["announced-not-executed"]);
    // Waiting for a missing fact is not an unkept promise (eval trace: partner's pay and how to split salaries).
    expect(verifyCozteResponse("El socio no es costo de producción; lo guardo aparte más adelante si quieren. Antes de guardar los sueldos falta definir cómo repartirlos entre los productos.", []).ok).toBe(true);
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

  it("accepts what is stored when a fresh read of it backs the answer", () => {
    const customers = { name: "readCustomers", ok: true, write: false, output: { ok: true, addresses: [{ address: "Belgrano 88, Rosario" }] } };
    expect(verifyCozteResponse("Su dirección guardada es Belgrano 88, Rosario.", [customers]).ok).toBe(true);
    expect(verifyCozteResponse("Su dirección guardada es Belgrano 88, Rosario.", []).ok).toBe(false);
  });

  it("flags internal names and empty answers", () => {
    expect(verifyCozteResponse("Usé applyCostAction para eso.", [read]).issues[0].code).toBe("internal-detail");
    expect(verifyCozteResponse("   ", []).issues[0].code).toBe("empty-answer");
  });

  it("builds a correction that asks for real execution", () => {
    const message = correctionMessage(verifyCozteResponse("Ya quedó creado el producto.", []));
    expect(message).toMatch(/Nota interna de Cozte/);
    expect(message).toMatch(/ejecuta ahora la herramienta/);
  });

  it("builds a receipt-only fallback that still reports what is stored", () => {
    const overview: TurnToolRecord = { name: "readCosts", ok: true, write: false, output: { ok: true, currency: "ARS", products: [{ name: "Tofu 300g", cost: { unitCost: 1070, status: "estimated" } }, { name: "Tofu 500g", cost: { unitCost: null, status: "incomplete" } }], materials: [{}, {}], monthlyExpenses: [{ name: "Gas", monthlyAmount: 110000 }] } };
    const text = receiptOnlyAnswer([overview, failedWrite]);
    expect(text).toContain("No llegué a guardar cambios.");
    expect(text).toContain("No se guardó: No se pudo guardar");
    expect(text).toContain("productos Tofu 300g (ARS 1.070 por unidad, estimado)");
    expect(text).toContain("Gas (ARS 110.000 al mes)");
    expect(verifyCozteResponse(text, [overview, failedWrite]).ok).toBe(true);
  });
});

describe("announced actions", () => {
  const simulation = { name: "simulate", ok: true, write: false, output: { ok: true, products: [{ product: "Tofu 300g", unitCostBefore: 938, unitCostAfter: 921 }] } };
  it("does not take an offer that depends on the person for an unfinished promise", () => {
    expect(verifyCozteResponse("Con la soja 10 % más barata, el Tofu 300g pasa de $938 a $921. ¿Te animás a llamar al proveedor esta semana? Si te dice un nuevo precio, me lo pasás y lo guardo.", [simulation]).ok).toBe(true);
    expect(verifyCozteResponse("El Tofu 300g pasaría a $921. Cuando tengas el precio nuevo, lo guardo.", [simulation]).ok).toBe(true);
  });
  it("still catches an action announced outright and never done", () => {
    expect(verifyCozteResponse("El Tofu 300g pasaría a $921. Ahora guardo el precio nuevo de la soja.", [simulation]).issues.map((issue) => issue.code)).toContain("announced-not-executed");
  });
});

describe("figures and fallbacks", () => {
  const costs = { name: "readCosts", ok: true, write: false, output: { ok: true, currency: "ARS", products: [{ name: "Tofu 500g", cost: { unitCost: 824 }, recipe: [{ material: "Soja", costPerUnit: 138.54 }] }] } };
  const simulation = { name: "simulate", ok: true, write: false, output: { ok: true, currency: "ARS", products: [{ product: "Tofu 500g", unitCostBefore: 824, unitCostAfter: 810, change: -14, changePercent: -1.7 }] } };
  const share = { name: "calculate", ok: true, write: false, output: { ok: true, label: "parte de la soja en el costo del Tofu 500g (%)", expression: "138.54 / 824 * 100", result: 16.81 } };
  const context = { sources: ["Simular qué pasa si bajamos 10% la soja"] };

  it("wants every amount and percentage from a tool or the conversation, also in turns that used tools", () => {
    const made = verifyCozteResponse("Con la soja 10 % más barata el Tofu 500g pasa de $824 a $810, y la soja pasa del 28 % al 25 % del costo. Por tanda son $1.552 menos.", [costs, simulation], context);
    expect(made.issues[0].code).toBe("unverified-figures");
    expect(made.issues[0].detail).toMatch(/montos 1552; porcentajes 28 %, 25 %/);
    expect(verifyCozteResponse("Con la soja 10 % más barata el Tofu 500g pasa de $824 a $810 (1,7 % menos). La soja es el 16,8 % de su costo.", [costs, simulation, share], context).ok).toBe(true);
  });

  it("keeps the verified answer without the sentences that break it", () => {
    const draft = [
      "### Qué pasa si la soja baja 10 %",
      "",
      "| Producto | Hoy | Con la soja más barata |",
      "|---|---|---|",
      "| Tofu 500g | $824 | $810 |",
      "",
      "El Tofu 500g pasa de $824 a $810. La soja pasa del 28 % al 25 % del costo.",
      "",
      "### Próximo paso",
      "",
      "Ahora guardo el precio nuevo de la soja.",
    ].join("\n");
    const verification = verifyCozteResponse(draft, [costs, simulation], context);
    expect(verification.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["announced-not-executed", "unverified-figures"]));
    const salvaged = salvageAnswer(draft, verification, [costs, simulation], context)!;
    expect(salvaged).toContain("| Tofu 500g | $824 | $810 |");
    expect(salvaged).toContain("El Tofu 500g pasa de $824 a $810.");
    expect(salvaged).not.toMatch(/28 %|guardo|Próximo paso/);
    expect(verifyCozteResponse(salvaged, [costs, simulation], context).ok).toBe(true);
    expect(salvageAnswer("La soja es el 28 % del costo. Por tanda son $1.552 menos.", verifyCozteResponse("La soja es el 28 % del costo. Por tanda son $1.552 menos.", [costs], context), [costs], context)).toBeNull();
  });

  it("answers with what the turn found when the answer cannot be kept", () => {
    const text = receiptOnlyAnswer([simulation, share]);
    expect(text).not.toMatch(/No llegué a guardar/);
    expect(text).toContain("Con el cambio simulado: Tofu 500g: de ARS 824 a ARS 810 por unidad (-1,7 %). La simulación no guarda nada.");
    expect(text).toContain("Parte de la soja en el costo del Tofu 500g (%): 16,81.");
  });
});

describe("final answer", () => {
  it("is the closing step, unless the turn stopped while still running tools", () => {
    const step = (...toolNames: string[]) => ({ toolCalls: toolNames.map((toolName) => ({ toolName })) });
    expect(finalAnswerStep([step("saveExpense"), step()])).toBe(1);
    expect(finalAnswerStep([step("saveExpense"), step("askQuestions")])).toBe(1);
    // The text written in the step that shows questions is what the person reads, even with tools called beside them.
    expect(finalAnswerStep([step("readCosts"), step("showVisual", "calculate", "askQuestions")])).toBe(1);
    expect(finalAnswerStep([step(), step("saveRecipe")])).toBe(-1);
    expect(finalAnswerStep([])).toBe(-1);
  });

  it("asks only for the closing message when the work ended without one, and never lets the note leak", () => {
    const empty = verifyCozteResponse("", [savedProduct]);
    expect(correctionMessage(empty)).toMatch(/sin escribir el mensaje final/);
    expect(correctionMessage(verifyCozteResponse("Ya quedó creado el producto.", []))).toMatch(/No menciones esta nota/);
    expect(discardReason(verifyCozteResponse("Ya quedó creado el producto.", []))).toBe("Decía que había guardado algo que no se guardó.");
  });
});
