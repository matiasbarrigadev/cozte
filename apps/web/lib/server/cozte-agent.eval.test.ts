import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateText, isStepCount, type ModelMessage } from "ai";
import { afterAll, describe, expect, it, vi } from "vitest";

// Reads AI_GATEWAY_API_KEY and COZTE_* from apps/web/.env.local, the same file `next dev` uses.
// Next skips .env.local under NODE_ENV=test, so it is read here explicitly; shell variables win.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && match[2] && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

/**
 * End-to-end evaluation of the Cozte harness with a real model and a local D1 bridge.
 * Put AI_GATEWAY_API_KEY in apps/web/.env.local, start the bridge (`npm run dev` in apps/data-bridge), then run:
 * COZTE_BRIDGE_TEST_URL=http://127.0.0.1:8787 COZTE_EVAL_MODELS=minimax/minimax-m3,<otro> npx vitest run lib/server/cozte-agent.eval.test.ts
 * Conversations mirror real production traces where the previous harness fabricated saves.
 */
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
const enabled = Boolean(bridgeUrl && process.env.AI_GATEWAY_API_KEY);
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./fx", () => ({ officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { USD: 1 }, source: "FXRatesAPI" }), quotesFor: () => ({}) }));

import { COZTE_WRITE_TOOLS, cozteToolSucceeded } from "@/lib/cozte-tool-catalog";
import { correctionMessage, verifyCozteResponse, type TurnToolRecord } from "@/lib/cozte-response-verifier";
import { createCozteTools } from "./cozte-agent-tools";
import { buildCozteInstructions } from "./cozte-instructions";
import { cozteAgentSettings } from "./cozte-workflow";
import { loadCozteNotes } from "./cozte-notes";
import { loadState } from "./state";
import { calculateCosts } from "@/lib/domain";
import { dbBatch } from "./db";

type EngineCost = { name: string; unitCost: number | null };
type Turn = { user: string; expectTools?: string[]; check?: (answer: string, records: TurnToolRecord[], costs: EngineCost[]) => string | null };

/** "1.070", "1070" or "1,070" all count as quoting the engine figure. */
const mentions = (answer: string, value: number) => [String(value), value.toLocaleString("es-AR"), value.toLocaleString("en-US")].some((form) => answer.includes(form));

const conversation: Turn[] = [
  { user: "Hacemos tofu. Tenemos dos productos: Tofu 500g, que salen 112 por tanda, y Tofu 300g, que salen 93 por tanda. Hacemos unas 23 tandas al mes de cada uno y cada tanda lleva 6 horas.", expectTools: ["saveProduct"] },
  { user: "La soja orgánica la compro a 1293 el kilo, el cloruro de magnesio a 2100 el kilo, la tela de filtrado a 348 el metro cuadrado, las bolsas a 59 cada una y las etiquetas a 240 cada una. Todo a CEAPE, precios de hoy, estimados.", expectTools: ["saveMaterial"] },
  { user: "Para cada tofu de 300g uso 0.2097 kg de soja, 7 gramos de cloruro, 0.0105 m2 de tela, una bolsa y una etiqueta. El de 500g usa 0.35 kg de soja, 12 g de cloruro, 0.017 m2 de tela, una bolsa y una etiqueta.", expectTools: ["saveRecipe"] },
  { user: "Somos 2 personas en producción, el mes pasado pagamos 1.600.000 de sueldos en total. Hay un tercer socio que trabaja pero cobra solo cuando hay ganancia.", expectTools: ["saveExpense"],
    // Handled if it says so or records the decision; the final-state check confirms it is not an expense.
    check: (answer, records) => /socio|fundador/i.test(answer) || records.some((item) => item.name === "saveNote" && item.ok) ? null : "no registró ni explicó cómo trata al socio" },
  { user: "El gas es una garrafa de 110.000 que recargamos una vez por mes y la luz son 350.000 por mes.", expectTools: ["saveExpense"] },
  { user: "¿Ya quedaron guardados los gastos? No me mientas.", check: (answer, records) => records.some((item) => item.name === "readCosts") || /sí|quedaron|están/i.test(answer) ? null : "no verificó el estado" },
  { user: "¿Cuánto me cuesta hacer un tofu de 300g y qué es lo que más pesa en ese costo?",
    check: (answer, _records, costs) => {
      const unit = costs.find((item) => /300/.test(item.name))?.unitCost;
      return unit != null && mentions(answer, unit) ? null : `no informó el costo del motor (${unit})`;
    } },
  { user: "Si la soja sube a 1800 el kilo, ¿cómo me cambia el costo? No lo guardes todavía.", expectTools: ["simulate"],
    check: (_answer, records) => records.some((item) => item.write && item.ok && item.name !== "saveNote") ? "guardó algo en una simulación" : null },
];

const results: Record<string, unknown>[] = [];

describe.skipIf(!enabled)("Cozte agent evaluation", { timeout: 20 * 60_000 }, () => {
  const models = (process.env.COZTE_EVAL_MODELS ?? cozteAgentSettings().model).split(",").map((item) => item.trim()).filter(Boolean);

  // Vitest hides console output of passing tests, so the transcript and metrics also go to a file.
  const reportPath = process.env.COZTE_EVAL_REPORT ?? join(tmpdir(), "cozte-eval-report.json");
  afterAll(() => {
    console.table(results.map((summary) => ({ ...summary, transcript: undefined, failureDetails: undefined })));
    writeFileSync(reportPath, JSON.stringify(results, null, 2));
  });

  it.each(models)("runs the tofu onboarding with %s", async (model) => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    const principal = { userId: "eval", organizationId: `org-eval-${crypto.randomUUID()}`, role: "owner" as const };
    await loadState(principal);
    await dbBatch([{ sql: "UPDATE organizations SET currency='ARS' WHERE id=?", params: [principal.organizationId] }]);
    const settings = { ...cozteAgentSettings(), model };
    const history: ModelMessage[] = [];
    const failures: string[] = [];
    let rejected = 0;
    let toolCalls = 0;
    const transcript: { user: string; tools: string[]; rejected: { text: string; issues: string[] } | null; answer: string }[] = [];
    for (const [index, turn] of conversation.entries()) {
      const state = await loadState(principal);
      const instructions = buildCozteInstructions({ state, notes: await loadCozteNotes(principal), legacyProfile: null });
      const tools = createCozteTools(principal, crypto.randomUUID());
      history.push({ role: "user", content: turn.user });
      // Mirrors the workflow: the correction asks for tool use in text; toolChoice "required" is not forced.
      const pass = async (messages: ModelMessage[]) => generateText({
        model, system: instructions, messages, tools, stopWhen: isStepCount(settings.maxSteps), maxOutputTokens: settings.maxOutputTokens, reasoning: settings.reasoning,
      });
      let result = await pass(history);
      let steps = [...result.steps];
      const records = () => steps.flatMap((step) => step.toolResults.map((item) => ({ name: item.toolName, ok: cozteToolSucceeded(item.output), write: COZTE_WRITE_TOOLS.has(item.toolName), output: item.output })));
      const context = { sources: [instructions, turn.user] };
      let verification = verifyCozteResponse(result.text, records(), context);
      let answer = result.text;
      const rejectedAnswer = verification.ok ? null : { text: result.text, issues: verification.issues.map((issue) => issue.code) };
      if (!verification.ok) {
        rejected++;
        result = await pass([...history, ...result.response.messages, { role: "user", content: correctionMessage(verification) }]);
        steps = [...steps, ...result.steps];
        answer = result.text;
        verification = verifyCozteResponse(answer, records(), context);
        if (!verification.ok) failures.push(`turno ${index + 1}: respuesta sin respaldo tras corrección (${verification.issues.map((item) => item.code).join(", ")})`);
      }
      history.push(...result.response.messages);
      const turnRecords = records();
      toolCalls += turnRecords.length;
      for (const expected of turn.expectTools ?? []) if (!turnRecords.some((item) => item.name === expected && item.ok)) failures.push(`turno ${index + 1}: no ejecutó ${expected} con éxito`);
      const latest = await loadState(principal);
      const engineCosts = calculateCosts(latest).map((cost) => ({ name: latest.products.find((item) => item.id === cost.productId)?.name ?? "", unitCost: cost.unitMinor }));
      const problem = turn.check?.(answer, turnRecords, engineCosts);
      if (problem) failures.push(`turno ${index + 1}: ${problem}`);
      transcript.push({ user: turn.user, tools: turnRecords.map((item) => `${item.name}${item.ok ? "" : " (falló)"}`), rejected: rejectedAnswer, answer });
      console.log(`\n[${model}] T${index + 1} tools=${turnRecords.map((item) => `${item.name}${item.ok ? "" : "✗"}`).join(",")}\n${answer.slice(0, 700)}`);
    }
    const final = await loadState(principal);
    const t300 = final.products.find((item) => /300/.test(item.name));
    const t500 = final.products.find((item) => /500/.test(item.name));
    // Materials per unit implied by the dictated recipes: 300g ≈ 588, 500g ≈ 783. Catches unit/lot mix-ups.
    const finalCosts = calculateCosts(final);
    const materialsPerUnit = (id?: string) => finalCosts.find((cost) => cost.productId === id)?.perUnit?.materialMinor ?? finalCosts.find((cost) => cost.productId === id)?.partialUnitMinor ?? 0;
    const near = (value: number, expected: number) => Math.abs(value - expected) <= expected * 0.02;
    const checks = {
      products: final.products.length === 2,
      recipeQuantities: near(materialsPerUnit(t300?.id), 588) && near(materialsPerUnit(t500?.id), 783),
      lotsPerMonth: t300?.batchesPerMonthMilli === 23000 && t500?.batchesPerMonthMilli === 23000,
      recipes: Boolean(t300 && t500 && final.components.filter((item) => item.productId === t300.id).length === 5 && final.components.filter((item) => item.productId === t500.id).length === 5),
      expenses: final.expenses.length === 3 && final.expenses.reduce((sum, item) => sum + item.amountMinor, 0) === 2_060_000,
      partnerNotAnExpense: !final.expenses.some((item) => /socio|fundador/i.test(item.name)),
    };
    for (const [name, passed] of Object.entries(checks)) if (!passed) failures.push(`estado final: ${name}`);
    results.push({ model, failures: failures.length, failureDetails: failures, rejectedAnswers: rejected, toolCalls, ...checks, transcript });
    if (failures.length) console.log(`\n[${model}] fallas:\n- ${failures.join("\n- ")}`);
    expect(failures).toEqual([]);
  });
});
