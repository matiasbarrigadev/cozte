import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { experimental_evaluate as evaluate, generateText, isStepCount, type ModelMessage } from "ai";
import { QUALITY_QUESTIONS, actionableFlags, qualityFeedback, qualityState, summarizeQuality, type QualityAnswers, type QualitySummary } from "@/lib/cozte-quality";
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

import { cozteToolSucceeded, cozteToolWrote, questionsShown } from "@/lib/cozte-tool-catalog";
import { loadCustomers, saveCustomer, saveCustomerAddress } from "./customers";
import { loadDeliveries, organizationToday, recordPurchase, recordSale } from "./business";
import { loadZones, saveZone } from "./delivery-zones";
import { loadSuppliers } from "./suppliers";
import { loadSalesMix } from "./break-even";
import { messageTimeLabel } from "@/lib/cozte-conversation-memory";
import { businessTimeZone } from "@/lib/business";
import { correctionMessage, finalAnswerStep, hasHardIssue, salvageAnswer, verifyCozteResponse, type TurnToolRecord } from "@/lib/cozte-response-verifier";
import { createCozteTools } from "./cozte-agent-tools";
import { buildCozteInstructions } from "./cozte-instructions";
import { cozteAgentSettings, cozteProviderOptions } from "./cozte-workflow";
import { loadCozteNotes } from "./cozte-notes";
import { loadCozteSettings } from "./cozte-settings";
import { loadChannels } from "./business";
import { loadState } from "./state";
import { calculateCosts } from "@/lib/domain";
import { dbBatch, dbQuery } from "./db";
import { formatCozteAnswers, parseCozteQuestions } from "@/lib/cozte-questions";

type EngineCost = { name: string; unitCost: number | null };
type Turn = { user: string; expectTools?: string[]; check?: (answer: string, records: TurnToolRecord[], costs: EngineCost[]) => string | null };
/** Phrases about the harness itself that must never reach the person's final message. */
const metaTalk = /(?<![\p{L}])(?:en este turno no|no pude ejecutar|ten[eé]s raz[oó]n|tienes raz[oó]n|me adelant[eé]|verificaci[oó]n autom[aá]tica|nota interna)(?![\p{L}])/iu;

/** "1.070", "1070" or "1,070" all count as quoting the engine figure. */
const mentions = (answer: string, value: number) => [String(value), value.toLocaleString("es-AR"), value.toLocaleString("en-US")].some((form) => answer.includes(form));

const conversation: Turn[] = [
  { user: "Hacemos tofu. Tenemos dos productos: Tofu 500g, que salen 112 por tanda, y Tofu 300g, que salen 93 por tanda. Hacemos unas 23 tandas al mes de cada uno y cada tanda lleva 6 horas.", expectTools: ["saveProduct"] },
  { user: "La soja orgánica la compro a 1293 el kilo, el cloruro de magnesio a 2100 el kilo, la tela de filtrado a 348 el metro cuadrado, las bolsas a 59 cada una y las etiquetas a 240 cada una. Todo a CEAPE, precios de hoy, estimados.", expectTools: ["saveMaterial"] },
  { user: "Para cada tofu de 300g uso 0.2097 kg de soja, 7 gramos de cloruro, 0.0105 m2 de tela, una bolsa y una etiqueta. El de 500g usa 0.35 kg de soja, 12 g de cloruro, 0.017 m2 de tela, una bolsa y una etiqueta.", expectTools: ["saveRecipe"] },
  // Saving salaries needs how to split them: asking with options is as valid as saving; the final state checks the result.
  { user: "Somos 2 personas en producción, el mes pasado pagamos 1.600.000 de sueldos en total. Hay un tercer socio que trabaja pero cobra solo cuando hay ganancia.",
    // Handled if it says so or records the decision; the final-state check confirms it is not an expense.
    check: (answer, records) => /socio|fundador/i.test(answer) || records.some((item) => item.name === "saveNote" && item.ok) ? null : "no registró ni explicó cómo trata al socio" },
  { user: "El gas es una garrafa de 110.000 que recargamos una vez por mes y la luz son 350.000 por mes. Los sueldos, el gas y la luz repartilos por horas de producción.", expectTools: ["saveExpense"] },
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

type Principal = { userId: string; organizationId: string; role: "owner" };
/** One turn as production runs it: the agent, then the verifier and, if needed, one correction pass. */
async function productionTurn(input: { model: string; principal: Principal; history: ModelMessage[]; text: string; level?: "simple" | "medium" | "advanced"; now?: Date; lastMessageAt?: string }) {
  const settings = { ...cozteAgentSettings(), model: input.model };
  const state = await loadState(input.principal);
  const instructions = buildCozteInstructions({ state, notes: await loadCozteNotes(input.principal), legacyProfile: null, level: input.level ?? "simple", board: (await loadCozteSettings(input.principal)).board, channels: await loadChannels(input.principal), now: input.now, lastMessageAt: input.lastMessageAt });
  const tools = createCozteTools(input.principal, crypto.randomUUID());
  // As in production, the person's message starts with when it was written.
  input.history.push({ role: "user", content: input.now ? `[Escrito el ${messageTimeLabel(input.now.toISOString(), businessTimeZone(state.organization.currency))}] ${input.text}` : input.text });
  const pass = (messages: ModelMessage[]) => generateText({ model: input.model, system: instructions, messages, tools, stopWhen: [isStepCount(settings.maxSteps), questionsShown], maxOutputTokens: settings.maxOutputTokens, providerOptions: cozteProviderOptions(settings) });
  let result = await pass(input.history);
  const collect = (list: typeof result.steps) => list.map((step) => ({ text: step.text, toolCalls: step.toolCalls.map((call) => ({ toolName: call.toolName, input: call.input })), toolResults: step.toolResults.map((item) => ({ toolName: item.toolName, output: item.output })) }));
  let steps = collect(result.steps);
  const records = () => steps.flatMap((step) => step.toolResults.map((item) => ({ name: item.toolName, ok: cozteToolSucceeded(item.output), write: cozteToolWrote(item.toolName, item.output), output: item.output, input: step.toolCalls.find((call) => call.toolName === item.toolName)?.input })));
  // As in production, figures may come from the tools or the conversation; a salvaged answer replaces the step's text.
  const context = { sources: [instructions, ...input.history.map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content))] };
  let salvaged: string | null = null;
  const answerOf = () => { if (salvaged !== null) return salvaged; const at = finalAnswerStep(steps); return at >= 0 ? steps[at].text.trim() : ""; };
  let verification = verifyCozteResponse(answerOf(), records(), context);
  const rejected = verification.ok ? null : { text: answerOf(), issues: verification.issues.map((issue) => issue.code) };
  if (!verification.ok) {
    result = await pass([...input.history, ...result.response.messages, { role: "user", content: correctionMessage(verification) }]);
    steps = [...steps, ...collect(result.steps)];
    verification = verifyCozteResponse(answerOf(), records(), context);
    const blocking = hasHardIssue(verification) || verification.issues.some((issue) => issue.code === "unverified-figures");
    if (blocking && answerOf()) {
      salvaged = salvageAnswer(answerOf(), verification, records(), context);
      if (salvaged !== null) verification = verifyCozteResponse(salvaged, records(), context);
    }
  }
  // Jev review as in production: clear failures get one rewrite that must pass the verifier again.
  const level = input.level ?? "simple";
  const review = async (answer: string) => summarizeQuality((await evaluate({ model: "typesafe-ai/jev", state: qualityState({ level, userMessage: input.text, answer, actions: records().map((item) => item.name) }), questions: QUALITY_QUESTIONS })).answers as QualityAnswers);
  let quality: { first: QualitySummary | null; flags: string[]; revised: QualitySummary | null; kept: "original" | "revised" } = { first: null, flags: [], revised: null, kept: "original" };
  const turnMessages = [...result.response.messages];
  if (verification.ok && answerOf()) {
    const first = await review(answerOf());
    const asked = steps[finalAnswerStep(steps)]?.toolCalls.some((call) => call.toolName === "askQuestions") ?? false;
    const flags = asked || salvaged !== null ? [] : actionableFlags(first, { wrote: records().some((item) => item.write && item.ok) });
    quality = { first, flags, revised: null, kept: "original" };
    if (flags.length) {
      const revision = await pass([...input.history, ...result.response.messages, { role: "user", content: qualityFeedback(flags) }]);
      const before = steps;
      steps = [...steps, ...collect(revision.steps)];
      if (answerOf() && verifyCozteResponse(answerOf(), records(), context).ok) {
        turnMessages.push(...revision.response.messages);
        quality = { ...quality, revised: await review(answerOf()), kept: "revised" };
      } else {
        steps = before;
      }
    }
  }
  input.history.push(...turnMessages);
  return { answer: answerOf(), records: records(), rejected, verified: verification.ok, salvaged: salvaged !== null, quality };
}

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
        model, system: instructions, messages, tools, stopWhen: [isStepCount(settings.maxSteps), questionsShown], maxOutputTokens: settings.maxOutputTokens, providerOptions: cozteProviderOptions(settings),
      });
      let result = await pass(history);
      // Plain copies: StepResult exposes its fields as getters, which a spread would lose.
      type StepView = { text: string; toolCalls: { toolName: string }[]; toolResults: { toolName: string; output: unknown }[] };
      const view = (list: typeof result.steps): StepView[] => list.map((step) => ({ text: step.text, toolCalls: step.toolCalls.map((call) => ({ toolName: call.toolName })), toolResults: step.toolResults.map((item) => ({ toolName: item.toolName, output: item.output })) }));
      let steps = view(result.steps);
      const records = () => steps.flatMap((step) => step.toolResults.map((item) => ({ name: item.toolName, ok: cozteToolSucceeded(item.output), write: cozteToolWrote(item.toolName, item.output), output: item.output })));
      // As in production, figures may come from the tools or the conversation.
      const context = { sources: [instructions, ...history.map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content))] };
      // Like the workflow: the answer is the closing step's text; notes written before tools stay in the trace.
      const visible = (list: StepView[]) => { const at = finalAnswerStep(list); return at >= 0 ? list[at].text.trim() : ""; };
      let answer = visible(steps);
      let verification = verifyCozteResponse(answer, records(), context);
      const rejectedAnswer = verification.ok ? null : { text: answer, issues: verification.issues.map((issue) => issue.code) };
      if (!verification.ok) {
        rejected++;
        result = await pass([...history, ...result.response.messages, { role: "user", content: correctionMessage(verification) }]);
        steps = [...steps, ...view(result.steps)];
        answer = visible(steps);
        verification = verifyCozteResponse(answer, records(), context);
        // As in production: a draft that still fails loses only the sentences or rows that fail.
        const salvaged = !verification.ok && answer ? salvageAnswer(answer, verification, records(), context) : null;
        if (salvaged !== null) { answer = salvaged; verification = verifyCozteResponse(answer, records(), context); }
        if (!verification.ok) failures.push(`turno ${index + 1}: respuesta sin respaldo tras corrección (${verification.issues.map((item) => item.detail).join(" | ")})`);
      }
      history.push(...result.response.messages);
      const turnRecords = records();
      toolCalls += turnRecords.length;
      for (const expected of turn.expectTools ?? []) if (!turnRecords.some((item) => item.name === expected && item.ok)) failures.push(`turno ${index + 1}: no ejecutó ${expected} con éxito`);
      const latest = await loadState(principal);
      const engineCosts = calculateCosts(latest).map((cost) => ({ name: latest.products.find((item) => item.id === cost.productId)?.name ?? "", unitCost: cost.unitMinor }));
      // Only a corrected turn can leak the correction note into the answer.
      if (rejectedAnswer && metaTalk.test(answer)) failures.push(`turno ${index + 1}: el mensaje final habla del proceso ("${answer.match(metaTalk)![0]}")`);
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

  it.each(models)("asks with options when the business is still unknown, then saves the answers, with %s", async (model) => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    const principal = { userId: "eval", organizationId: `org-eval-${crypto.randomUUID()}`, role: "owner" as const };
    await loadState(principal);
    const settings = { ...cozteAgentSettings(), model };
    const history: ModelMessage[] = [];
    const turn = async (text: string) => {
      history.push({ role: "user", content: text });
      const state = await loadState(principal);
      const result = await generateText({
        model, system: buildCozteInstructions({ state, notes: await loadCozteNotes(principal), legacyProfile: null }), messages: history,
        tools: createCozteTools(principal, crypto.randomUUID()), stopWhen: [isStepCount(settings.maxSteps), questionsShown],
        maxOutputTokens: settings.maxOutputTokens, providerOptions: cozteProviderOptions(settings),
      });
      history.push(...result.response.messages);
      const calls = result.steps.flatMap((step) => step.toolCalls.map((call) => ({ name: call.toolName, input: call.input })));
      console.log(`\n[${model}] tools=${calls.map((call) => call.name).join(",")}\n${result.steps.map((step) => step.text).join("\n").slice(0, 700)}`);
      return calls;
    };
    const first = await turn("Hola, hago velas de soja en casa y quiero saber cuánto me cuesta hacer cada una. ¿Por dónde empezamos?");
    const asked = first.findLast((call) => call.name === "askQuestions");
    const set = parseCozteQuestions(asked?.input);
    console.log(JSON.stringify(asked?.input, null, 2));
    expect(set?.questions.length).toBeGreaterThan(0);
    expect(set!.questions.every((question) => question.options.length >= 2)).toBe(true);
    // The person answers with the free-text field, which always carries the facts.
    const second = await turn(formatCozteAnswers(set!, set!.questions.map((_, index) => ({ choices: [], other: index === 0 ? "Una sola: Vela de soja 200 g. Salen 24 velas por tanda y hago 8 tandas al mes." : "" }))));
    expect(second.some((call) => call.name === "saveProduct")).toBe(true);
    const final = await loadState(principal);
    expect(final.products.map((product) => product.lotUnits)).toContain(24);
  });

  it.each(models)("works as the business's secretary: channel, purchases and a sale, then the month, with %s", async (model) => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    const principal = { userId: "eval", organizationId: `org-eval-${crypto.randomUUID()}`, role: "owner" as const };
    await loadState(principal);
    await dbBatch([{ sql: "UPDATE organizations SET currency='ARS' WHERE id=?", params: [principal.organizationId] }]);
    const seed = createCozteTools(principal, crypto.randomUUID());
    let seedCall = 0;
    const setup = async (name: keyof typeof seed, input: Record<string, unknown>) => await (seed[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<unknown>)(input, { toolCallId: `seed-${++seedCall}` });
    await setup("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 });
    await setup("saveMaterial", { name: "Soja orgánica", purchaseUnit: "kg", price: 1000 });
    await setup("saveRecipe", { product: "Tofu 300g", items: [{ material: "Soja orgánica", perLot: 30 }] });
    await setup("saveExpense", { name: "Luz", amount: 200000, splitBy: "hours" });

    const history: ModelMessage[] = [];
    const failures: string[] = [];
    const transcript: { user: string; tools: string[]; rejected: unknown; answer: string }[] = [];
    const turn = async (text: string, expected: string[]) => {
      const { answer, records, rejected, verified, quality } = await productionTurn({ model, principal, history, text });
      for (const name of expected) if (!records.some((item) => item.name === name && item.ok)) failures.push(`"${text.slice(0, 40)}…": no ejecutó ${name}`);
      if (!verified) failures.push(`"${text.slice(0, 40)}…": respuesta sin respaldo tras la corrección`);
      transcript.push({ user: text, tools: records.map((item) => item.name + (item.ok ? "" : " (falló)")), rejected, answer, quality } as never);
      return { records, answer };
    };
    await turn("Vendemos por Instagram. Mercado Pago nos cobra 10 % de cada venta y el envío en moto nos cuesta 1500 por pedido; los pedidos suelen ser de 3 tofus.", ["saveChannel"]);
    await turn("Hoy compré 50 kilos de soja orgánica por 60000 en CEAPE, una cinta de embalaje de 3500 para los envíos y una balanza digital de 45000 para el taller que debería durar unos 5 años.", ["recordPurchase"]);
    // Whether the scale goes into each unit's cost is the person's call: Cozte may advise or ask, never decide alone.
    const decidedAlone = await dbQuery("SELECT 1 AS found FROM purchases WHERE organization_id=? AND kind='investment' AND include_in_unit_cost=1", [principal.organizationId]);
    if (decidedAlone.length) failures.push("sumó la balanza al costo por unidad sin que la persona lo decidiera");
    await turn("La balanza sí, sumala al costo de cada tofu.", []);
    await turn("Ayer vendí 12 tofus de 300g por Instagram al precio de lista.", ["recordSale"]);
    // Reading the month (readBusiness) or showing it as a widget both answer from the engine.
    const month = await turn("¿Cómo vengo este mes? ¿Estoy ganando?", []);
    if (!month.records.some((item) => item.ok && (item.name === "readBusiness" || (item.name === "showVisual" && ["month", "month-result", "break-even", "kpis"].includes(String((item.input as { visual?: string } | undefined)?.visual)))))) failures.push("no leyó el mes (readBusiness o el widget del mes)");
    if (!/pérdida|perd|gananc|resultado/i.test(month.answer)) failures.push("no explicó el resultado del mes");

    const [channels, purchases, sales] = await Promise.all([
      dbQuery<{ commission_bps: number; delivery_cost_per_order_minor: number; units_per_order_milli: number }>("SELECT commission_bps, delivery_cost_per_order_minor, units_per_order_milli FROM sales_channels WHERE organization_id=? AND archived_at IS NULL", [principal.organizationId]),
      dbQuery<{ kind: string; area: string; amount_minor: number; useful_life_months: number | null; include_in_unit_cost: number }>("SELECT kind, area, amount_minor, useful_life_months, include_in_unit_cost FROM purchases WHERE organization_id=? AND archived_at IS NULL", [principal.organizationId]),
      dbQuery<{ total_minor: number }>("SELECT total_minor FROM sales WHERE organization_id=? AND archived_at IS NULL", [principal.organizationId]),
    ]);
    const soy = (await loadState(principal)).materials.find((item) => /soja/i.test(item.name));
    const checks = {
      channel: channels.length === 1 && channels[0].commission_bps === 1000 && channels[0].delivery_cost_per_order_minor === 1500 && channels[0].units_per_order_milli === 3000,
      soyPurchase: purchases.some((item) => item.kind === "material" && item.amount_minor === 60000) && soy?.priceMinor === 1200,
      tape: purchases.some((item) => item.kind === "expense" && item.amount_minor === 3500 && item.area === "delivery"),
      scale: purchases.some((item) => item.kind === "investment" && item.amount_minor === 45000 && item.area === "production" && item.useful_life_months === 60),
      scaleInUnitCost: purchases.some((item) => item.kind === "investment" && item.amount_minor === 45000 && item.include_in_unit_cost === 1),
      sale: sales.length === 1 && sales[0].total_minor === 24000,
    };
    for (const [name, passed] of Object.entries(checks)) if (!passed) failures.push(`estado final: ${name}`);
    console.log(`\n[${model}] checks ${JSON.stringify(checks)}`);
    results.push({ model, scenario: "secretary", failures: failures.length, failureDetails: failures, ...checks, transcript });
    expect(failures).toEqual([]);
  });

  it.each(models)("explains its assumptions at the chosen level and shows visuals, with %s", async (model) => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    const principal = { userId: "eval", organizationId: `org-eval-${crypto.randomUUID()}`, role: "owner" as const };
    await loadState(principal);
    await dbBatch([{ sql: "UPDATE organizations SET currency='ARS' WHERE id=?", params: [principal.organizationId] }]);
    const seed = createCozteTools(principal, crypto.randomUUID());
    let seedCall = 0;
    const setup = async (name: keyof typeof seed, input: Record<string, unknown>) => await (seed[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<unknown>)(input, { toolCallId: `seed-${++seedCall}` });
    await setup("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 });
    await setup("saveMaterial", { name: "Soja orgánica", purchaseUnit: "kg", price: 1000 });
    await setup("saveRecipe", { product: "Tofu 300g", items: [{ material: "Soja orgánica", perLot: 30 }] });
    await setup("saveExpense", { name: "Luz", amount: 200000, splitBy: "hours" });

    const failures: string[] = [];
    const transcript: Record<string, unknown>[] = [];
    const conversation = async (level: "simple" | "advanced", messages: { text: string; expect: string[]; checkAssumptions?: boolean }[]) => {
      const history: ModelMessage[] = [];
      for (const message of messages) {
        const { answer, records, verified } = await productionTurn({ model, principal, history, text: message.text, level });
        if (!verified) failures.push(`[${level}] "${message.text.slice(0, 40)}…": respuesta sin respaldo tras la corrección`);
        for (const name of message.expect) if (!records.some((item) => item.name === name && item.ok)) failures.push(`[${level}] "${message.text.slice(0, 40)}…": no ejecutó ${name}`);
        const quality = await evaluate({ model: "typesafe-ai/jev", state: qualityState({ level, userMessage: message.text, answer, actions: records.map((item) => item.name) }), questions: QUALITY_QUESTIONS });
        const summary = summarizeQuality(quality.answers as QualityAnswers);
        transcript.push({ level, user: message.text, tools: records.map((item) => item.name), answer, quality: summary });
        if (message.checkAssumptions && summary.flags.includes("decidió sin explicar")) failures.push(`[${level}] "${message.text.slice(0, 40)}…": decidió sin explicar (Jev)`);
        if (/en firme|productos vivos|insumos vivos/i.test(answer)) failures.push(`[${level}] vocabulario viejo`);
      }
    };
    await conversation("simple", [
      { text: "Compramos una laptop para la oficina por 900000.", expect: [], checkAssumptions: true },
      { text: "Mostrame en qué se va el costo de cada tofu.", expect: ["showVisual"] },
    ]);
    await conversation("advanced", [{ text: "Registrá una compra: impresora para administración por 300000.", expect: [] }]);
    const investments = await dbQuery<{ useful_life_months: number | null; area: string }>("SELECT useful_life_months, area FROM purchases WHERE organization_id=? AND kind='investment' AND archived_at IS NULL", [principal.organizationId]);
    console.log(`\n[${model}] investments ${JSON.stringify(investments)}`);
    results.push({ model, scenario: "levels", failures: failures.length, failureDetails: failures, transcript });
    expect(failures).toEqual([]);
  });

  it.each(models)("builds, iterates and shares a presentation with the business's data, with %s", async (model) => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    const principal = { userId: "eval", organizationId: `org-eval-${crypto.randomUUID()}`, role: "owner" as const };
    await loadState(principal);
    await dbBatch([{ sql: "UPDATE organizations SET currency='ARS', name='Tofu Sur' WHERE id=?", params: [principal.organizationId] }]);
    const seed = createCozteTools(principal, crypto.randomUUID());
    let seedCall = 0;
    const setup = async (name: keyof typeof seed, input: Record<string, unknown>) => await (seed[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<unknown>)(input, { toolCallId: `seed-${++seedCall}` });
    await setup("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 });
    await setup("saveProduct", { name: "Tofu ahumado", goodUnitsPerLot: 50, lotsPerMonth: 8, hoursPerLot: 6, salePrice: 3200 });
    await setup("saveMaterial", { name: "Soja orgánica", purchaseUnit: "kg", price: 1000 });
    await setup("saveRecipe", { product: "Tofu 300g", items: [{ material: "Soja orgánica", perLot: 30 }] });
    await setup("saveRecipe", { product: "Tofu ahumado", items: [{ material: "Soja orgánica", perLot: 18 }] });
    await setup("saveExpense", { name: "Luz", amount: 200000, splitBy: "hours" });
    await setup("saveChannel", { name: "Feria", commissionPercent: 0 });
    await setup("saveChannel", { name: "Instagram", commissionPercent: 10, deliveryCostPerOrder: 1500, unitsPerOrder: 3 });
    await setup("recordSale", { channel: "Feria", items: [{ product: "Tofu 300g", quantity: 60 }, { product: "Tofu ahumado", quantity: 15 }] });
    await setup("recordSale", { channel: "Instagram", items: [{ product: "Tofu 300g", quantity: 24 }] });

    const history: ModelMessage[] = [];
    const failures: string[] = [];
    const transcript: Record<string, unknown>[] = [];
    const turn = async (text: string, expected: string[]) => {
      const { answer, records, rejected, verified } = await productionTurn({ model, principal, history, text, level: "simple" });
      for (const name of expected) if (!records.some((item) => item.name === name && item.ok)) failures.push(`"${text.slice(0, 40)}…": no ejecutó ${name}`);
      if (!verified) failures.push(`"${text.slice(0, 40)}…": respuesta sin respaldo tras la corrección`);
      const calls = records.filter((item) => item.name.endsWith("Presentation")).map((item) => ({ tool: item.name, ok: item.ok, input: item.input, error: (item.output as { error?: string } | null)?.error }));
      transcript.push({ user: text, tools: records.map((item) => item.name + (item.ok ? "" : " (falló)")), calls, rejected, answer });
      return { records, answer };
    };
    await turn("Armame una presentación de cómo nos fue en ventas este mes, para mostrársela a mi socio.", ["createPresentation"]);
    await turn("Ponela en estilo oscuro para proyectarla y agregá una diapositiva con el punto de equilibrio antes del cierre.", ["editPresentation"]);
    await turn("Pasame un link para mandársela a mi socio.", ["sharePresentation"]);

    const decks = await dbQuery<{ theme: string; deck_json: string; share_token: string | null }>("SELECT theme, deck_json, share_token FROM presentations WHERE organization_id=? AND archived_at IS NULL", [principal.organizationId]);
    const deck = decks[0] ? JSON.parse(decks[0].deck_json) as { slides: { layout: string; title: string; chart?: { kind: string; data: { type: string } } }[] } : null;
    const lastAnswer = String(transcript.at(-1)?.answer ?? "");
    const checks = {
      oneDeck: decks.length === 1,
      salesCharts: Boolean(deck?.slides.some((slide) => slide.chart?.kind.startsWith("sales-"))),
      noEmptyCharts: Boolean(deck && !deck.slides.some((slide) => slide.chart?.data.type === "empty")),
      dark: decks[0]?.theme === "noche",
      breakEven: Boolean(deck?.slides.some((slide) => slide.chart?.kind === "break-even")),
      breakEvenBeforeClosing: Boolean(deck && deck.slides.findIndex((slide) => slide.chart?.kind === "break-even") < deck.slides.findIndex((slide) => slide.layout === "closing")),
      shared: Boolean(decks[0]?.share_token),
      linkInAnswer: Boolean(decks[0]?.share_token && lastAnswer.includes(decks[0].share_token)),
    };
    for (const [name, passed] of Object.entries(checks)) if (!passed) failures.push(`estado final: ${name}`);
    console.log(`\n[${model}] decks ${JSON.stringify(checks)}\n${deck?.slides.map((slide, index) => `${index + 1}. [${slide.layout}${slide.chart ? `:${slide.chart.kind}` : ""}] ${slide.title}`).join("\n")}`);
    results.push({ model, scenario: "presentations", failures: failures.length, failureDetails: failures, ...checks, slides: deck?.slides.map((slide) => ({ layout: slide.layout, title: slide.title, chart: slide.chart?.kind })), transcript });
    expect(failures).toEqual([]);
  });

  it.each(models)("knows that yesterday's 'see you tomorrow' is today, with %s", async (model) => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    const principal = { userId: "eval", organizationId: `org-eval-${crypto.randomUUID()}`, role: "owner" as const };
    const state = await loadState(principal);
    const zone = businessTimeZone(state.organization.currency);
    // The exchange from a real conversation: last night they said goodbye until "tomorrow"; this is that tomorrow.
    const yesterday = "2026-09-26T23:30:00.000Z";
    const now = new Date("2026-09-27T13:00:00.000Z");
    const history: ModelMessage[] = [
      { role: "user", content: `[Escrito el ${messageTimeLabel(yesterday, zone)}] Bueno, por hoy termino. Mañana te paso los precios nuevos de la soja. ¡Nos vemos mañana!` },
      { role: "assistant", content: "¡Dale! Mañana me pasás los precios de la soja y los cargamos. ¡Nos vemos mañana! 👋" },
    ];
    const turn = await productionTurn({ model, principal, history, text: "Hola, ya volví.", now, lastMessageAt: yesterday });
    const answer = turn.answer.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const checks = {
      notStuckInYesterday: !/nos vemos manana|hasta manana|manana me pasas|manana seguimos/.test(answer),
      picksUpThePlan: /soja|precio/.test(answer),
      noTimeMark: !/escrito el/.test(answer),
    };
    const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    console.log(`\n[${model}] time ${JSON.stringify(checks)}\n${turn.answer}`);
    results.push({ model, scenario: "time", failures: failures.length, failureDetails: failures, ...checks, transcript: [{ user: "Hola, ya volví.", answer: turn.answer }] });
    expect(failures).toEqual([]);
  });

  it.each(models)("saves where the business is when the person says it, and talks like people there, with %s", async (model) => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    const principal = { userId: "eval", organizationId: `org-eval-${crypto.randomUUID()}`, role: "owner" as const };
    await loadState(principal);
    const history: ModelMessage[] = [];
    const first = await productionTurn({ model, principal, history, text: "Hola! Tengo una fábrica chica de alfajores en Rosario, Argentina. Quiero empezar a ordenar mis costos." });
    const saved = first.records.find((item) => item.name === "setCompanyLocation" && item.ok);
    const state = await loadState(principal);
    const second = saved ? await productionTurn({ model, principal, history, text: "¿Qué necesitás que te pase primero?" }) : null;
    const answer = (second?.answer ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const checks = {
      savedLocation: state.organization.country === "AR" && /rosario/i.test(state.organization.city ?? ""),
      // With the location saved, the next answer uses vos (tenés, pasame, contame…) rather than tú.
      voseo: /\b(tenes|pasame|contame|decime|fijate|sabes|podes|queres|mandame|necesitas|arranca|vos)\b/.test(answer) && !/\b(tienes|puedes|quieres|cuentame|dime)\b/.test(answer),
    };
    const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    console.log(`\n[${model}] location ${JSON.stringify(checks)}\n${first.answer}\n---\n${second?.answer ?? ""}`);
    results.push({ model, scenario: "location", failures: failures.length, failureDetails: failures, ...checks, transcript: [{ user: "Rosario", answer: first.answer }, { user: "¿Qué necesitás?", answer: second?.answer ?? "" }] });
    expect(failures).toEqual([]);
  });

  it.each(models)("arranges tomorrow's route with someone first and hands back the map, with %s", async (model) => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    const principal = { userId: "eval", organizationId: `org-eval-${crypto.randomUUID()}`, role: "owner" as const };
    const tools = createCozteTools(principal, crypto.randomUUID());
    const run = async (name: keyof typeof tools, input: Record<string, unknown>) => await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Record<string, unknown>>)(input, { toolCallId: crypto.randomUUID() });
    await run("readCosts", {});
    await dbBatch([{ sql: "UPDATE organizations SET currency='ARS', country='AR', city='Córdoba', time_zone='America/Argentina/Cordoba' WHERE id=?", params: [principal.organizationId] }]);
    const product = await run("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 });
    const productId = (product.ids as Record<string, string>).product;
    await saveZone(principal, { name: "Córdoba", mode: "own", carrier: "Moto (Tomás)", areas: "Córdoba, Nueva Córdoba, Alta Córdoba" }, "user");
    const todayThere = await organizationToday(principal);
    const tomorrow = new Date(Date.parse(`${todayThere}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    for (const [customer, address, timeWindow] of [["Bar Tarde", "Colón 900, Alta Córdoba", "15 a 19"], ["Kiosco Libre", "Obispo Trejo 300, Nueva Córdoba", ""], ["Almacén Mañana", "Rondeau 200, Nueva Córdoba", "9 a 12"]] as const) {
      await recordSale(principal, { soldOn: todayThere, customer, items: [{ productId, quantity: 2 }], delivery: { address, timeWindow, scheduledOn: tomorrow } }, { source: "user", idempotencyKey: crypto.randomUUID() });
    }
    const history: ModelMessage[] = [];
    const turn = await productionTurn({ model, principal, history, text: "Armá la ruta de mañana y poné primero a Bar Tarde." });
    const saved = (await loadDeliveries(principal, tomorrow.slice(0, 7))).filter((item) => item.scheduledOn === tomorrow).sort((a, b) => (a.routePosition ?? 99) - (b.routePosition ?? 99));
    const checks = {
      plannedTheRoute: turn.records.some((item) => item.name === "planRoute" && item.ok),
      barFirst: saved[0]?.recipient === "Bar Tarde" && saved.every((item) => item.routePosition !== null),
      mapsLink: /google\.com\/maps\/dir\//.test(turn.answer),
      namedTheStops: /kiosco libre/i.test(turn.answer) && /almac[eé]n ma[ñn]ana/i.test(turn.answer),
      verified: turn.verified,
    };
    const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    console.log(`\n[${model}] routes ${JSON.stringify(checks)}\n${turn.answer}`);
    results.push({ model, scenario: "routes", failures: failures.length, failureDetails: failures, ...checks, transcript: [{ user: "ruta", answer: turn.answer }] });
    expect(failures).toEqual([]);
  });

  it.each(models)("tells how a supplier's price moved and saves a new supplier, with %s", async (model) => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    const principal = { userId: "eval", organizationId: `org-eval-${crypto.randomUUID()}`, role: "owner" as const };
    const tools = createCozteTools(principal, crypto.randomUUID());
    const run = async (name: keyof typeof tools, input: Record<string, unknown>) => await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Record<string, unknown>>)(input, { toolCallId: crypto.randomUUID() });
    await run("readCosts", {});
    await run("saveMaterial", { name: "Soja", purchaseUnit: "kg", price: 1000, supplier: "Granos del Sur" });
    const soy = (await loadState(principal)).materials.find((item) => item.name === "Soja")!.id;
    for (const [date, amount] of [["2026-05-10", 50000], ["2026-07-10", 55000], ["2026-09-10", 60000]] as const) await recordPurchase(principal, { purchasedOn: date, description: "Soja", supplier: "Granos del Sur", amount, kind: "material", materialId: soy, quantity: 50 }, { source: "user", idempotencyKey: crypto.randomUUID() });
    const history: ModelMessage[] = [];
    const first = await productionTurn({ model, principal, history, text: "¿Cuánto me subió la soja con Granos del Sur desde la primera compra?" });
    const second = await productionTurn({ model, principal, history, text: "Agregá el proveedor Molino Andino, me vende harina, el teléfono es 261 444 0000." });
    const molino = (await loadSuppliers(principal)).suppliers.find((row) => /molino andino/i.test(row.name));
    const plain = first.answer.replace(/\s/g, "");
    const checks = {
      readTheSupplier: first.records.some((item) => item.name === "readSuppliers" && item.ok),
      toldThePercent: /20\s?%/.test(first.answer),
      toldThePrices: /1\.000|1000/.test(plain) && /1\.200|1200/.test(plain),
      savedTheSupplier: Boolean(molino) && molino!.kind === "materials" && /261/.test(molino!.phone),
      confirmedIt: second.verified && /molino/i.test(second.answer),
    };
    const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    console.log(`\n[${model}] suppliers ${JSON.stringify(checks)}\n${first.answer}\n---\n${second.answer}`);
    results.push({ model, scenario: "suppliers", failures: failures.length, failureDetails: failures, ...checks, transcript: [{ user: "soja", answer: first.answer }, { user: "molino", answer: second.answer }] });
    expect(failures).toEqual([]);
  });

  it.each(models)("says how many of each product to sell, and records how an expense behaves and the sales mix when the person says it, with %s", async (model) => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    const principal = { userId: "eval", organizationId: `org-eval-${crypto.randomUUID()}`, role: "owner" as const };
    const tools = createCozteTools(principal, crypto.randomUUID());
    const run = async (name: keyof typeof tools, input: Record<string, unknown>) => await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Record<string, unknown>>)(input, { toolCallId: crypto.randomUUID() });
    await run("readCosts", {});
    await run("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 });
    await run("saveProduct", { name: "Tofu 500g", goodUnitsPerLot: 100, lotsPerMonth: 10, hoursPerLot: 5, salePrice: 3000 });
    await run("saveMaterial", { name: "Soja", purchaseUnit: "kg", price: 1000 });
    await run("saveRecipe", { product: "Tofu 300g", items: [{ material: "Soja", perUnit: 0.3 }] });
    await run("saveRecipe", { product: "Tofu 500g", items: [{ material: "Soja", perUnit: 0.5 }] });
    for (const [name, amount] of [["Alquiler", 200000], ["Sueldo", 800000], ["Gas", 60000]] as const) await run("saveExpense", { name, amount, splitBy: "hours" });
    const history: ModelMessage[] = [];
    // Fixed 1.060.000 with the production plan's mix (2 of 300g for each 500g): 360 and 180.
    const first = await productionTurn({ model, principal, history, text: "¿Cuánto tengo que vender de cada tofu para cubrir los gastos del mes?" });
    const second = await productionTurn({ model, principal, history, text: "El gas no es fijo: lo uso solo cuando cocino, y cada tanda gasta lo mismo." });
    // Then fixed 1.000.000, each unit 20 more of gas, and 3 of 300g for each 500g: 399 and 133.
    const third = await productionTurn({ model, principal, history, text: "En realidad vendo 3 de 300g por cada uno de 500g. Guardalo así y decime cuánto de cada uno." });
    const state = await loadState(principal);
    const gas = state.expenses.find((item) => item.name === "Gas" && item.period === state.activePeriod);
    const mix = await loadSalesMix(principal);
    const t300 = state.products.find((item) => item.name === "Tofu 300g")!.id;
    const plain = (text: string) => text.replace(/[\s.]/g, "");
    const checks = {
      readTheBreakEven: first.records.some((item) => item.name === "readBreakEven" && item.ok),
      toldEachProduct: /360/.test(plain(first.answer)) && /180/.test(plain(first.answer)),
      savedTheGas: gas?.behavior === "variable" && gas.variableDriver === "lot",
      savedTheMix: mix.source === "manual" && mix.shares[t300] === 7500,
      toldTheNewUnits: /399/.test(plain(third.answer)) && /133/.test(plain(third.answer)),
      answeredEveryTurn: [first, second, third].every((turn) => turn.verified),
    };
    const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    console.log(`\n[${model}] break-even ${JSON.stringify(checks)}\n${first.answer}\n---\n${second.answer}\n---\n${third.answer}`);
    results.push({ model, scenario: "break-even", failures: failures.length, failureDetails: failures, ...checks, transcript: [{ user: "equilibrio", answer: first.answer }, { user: "gas", answer: second.answer }, { user: "mezcla", answer: third.answer }] });
    expect(failures).toEqual([]);
  });

  it.each(models)("sets up a delivery zone, delivers a new sale through it and names the places without a zone, with %s", async (model) => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    const principal = { userId: "eval", organizationId: `org-eval-${crypto.randomUUID()}`, role: "owner" as const };
    const tools = createCozteTools(principal, crypto.randomUUID());
    const run = async (name: keyof typeof tools, input: Record<string, unknown>) => await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Record<string, unknown>>)(input, { toolCallId: crypto.randomUUID() });
    await run("readCosts", {});
    await run("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 });
    await run("saveMaterial", { name: "Soja", purchaseUnit: "kg", price: 1000 });
    await run("saveRecipe", { product: "Tofu 300g", items: [{ material: "Soja", perLot: 30 }] });
    await saveCustomerAddress(principal, { customerId: (await saveCustomer(principal, { name: "Almacén Don Pepe" }, "user")).id, address: "Belgrano 88, Rosario" }, "user");
    await saveCustomerAddress(principal, { customerId: (await saveCustomer(principal, { name: "Dietética Andina" }, "user")).id, address: "San Martín 900, Mendoza" }, "user");
    const history: ModelMessage[] = [];
    const first = await productionTurn({ model, principal, history, text: "Armá una zona de entrega Rosario: la lleva Andreani, me cuesta $4.500 cada pedido y sale los martes y los viernes." });
    const second = await productionTurn({ model, principal, history, text: "Registrá una venta de 20 Tofu 300g a Almacén Don Pepe, con entrega." });
    const third = await productionTurn({ model, principal, history, text: "¿Qué clientes me quedaron en lugares sin zona de entrega?" });
    const zone = (await loadZones(principal)).find((item) => /rosario/i.test(item.name));
    const delivery = (await loadDeliveries(principal, new Date().toISOString().slice(0, 7))).find((item) => /pepe/i.test(item.sale.customer));
    const checks = {
      savedTheZone: Boolean(zone) && zone!.mode === "carrier" && /andreani/i.test(zone!.carrier) && zone!.costPerOrderMinor === 4500 && zone!.weekdays.join() === "2,5",
      zoneCoversRosario: Boolean(zone) && (zone!.areas.some((area) => /rosario/i.test(area)) || /^rosario$/i.test(zone!.name.trim())),
      confirmedIt: first.verified && /rosario/i.test(first.answer),
      deliveredThroughIt: delivery?.zoneId === zone?.id && delivery?.costMinor === 4500,
      namedTheUncovered: third.records.some((item) => item.name === "readDeliveries" && item.ok) && /mendoza|andina/i.test(third.answer),
    };
    const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    console.log(`\n[${model}] zones ${JSON.stringify(checks)}\n${first.answer}\n---\n${second.answer}\n---\n${third.answer}`);
    results.push({ model, scenario: "zones", failures: failures.length, failureDetails: failures, ...checks, transcript: [{ user: "zona", answer: first.answer }, { user: "venta", answer: second.answer }, { user: "sin zona", answer: third.answer }] });
    expect(failures).toEqual([]);
  });

  it.each(models)("answers about a customer from their record and saves a new one with an address, with %s", async (model) => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    const principal = { userId: "eval", organizationId: `org-eval-${crypto.randomUUID()}`, role: "owner" as const };
    const tools = createCozteTools(principal, crypto.randomUUID());
    const run = async (name: keyof typeof tools, input: Record<string, unknown>) => await (tools[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<Record<string, unknown>>)(input, { toolCallId: crypto.randomUUID() });
    await run("readCosts", {});
    const product = await run("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 });
    await run("saveMaterial", { name: "Soja", purchaseUnit: "kg", price: 1000 });
    await run("saveRecipe", { product: "Tofu 300g", items: [{ material: "Soja", perLot: 30 }] });
    const productId = (product.ids as Record<string, string>).product;
    for (const [date, quantity] of [["2026-08-05", 20], ["2026-09-02", 30]] as const) await recordSale(principal, { soldOn: date, customer: "Almacén Don Pepe", items: [{ productId, quantity }], delivery: { address: "Belgrano 88, Rosario", recipient: "Pepe" } }, { source: "user", idempotencyKey: crypto.randomUUID() });
    const history: ModelMessage[] = [];
    const first = await productionTurn({ model, principal, history, text: "¿Qué dirección tiene Almacén Don Pepe y cuánto me compró en total?" });
    const second = await productionTurn({ model, principal, history, text: "Agregá como cliente a Librería Rayuela, teléfono 351 444 0000, entregamos en Caseros 540, Córdoba." });
    const { customers } = await loadCustomers(principal);
    const rayuela = customers.find((row) => /rayuela/i.test(row.name));
    const checks = {
      readTheRecord: first.records.some((item) => item.name === "readCustomers" && item.ok),
      toldTheAddress: /belgrano 88/i.test(first.answer),
      toldTheTotal: /100\.000|100000/.test(first.answer.replace(/\s/g, "")),
      savedTheCustomer: Boolean(rayuela) && rayuela!.addresses.some((address) => /caseros 540/i.test(address.address)) && /351/.test(rayuela!.phone),
      confirmedIt: second.verified && /rayuela/i.test(second.answer),
    };
    const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    console.log(`\n[${model}] customers ${JSON.stringify(checks)}\n${first.answer}\n---\n${second.answer}`);
    results.push({ model, scenario: "customers", failures: failures.length, failureDetails: failures, ...checks, transcript: [{ user: "Don Pepe", answer: first.answer }, { user: "Rayuela", answer: second.answer }] });
    expect(failures).toEqual([]);
  });

  it.each(models)("picks, pins and arranges board widgets from what the person asks, with %s", async (model) => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    const principal = { userId: "eval", organizationId: `org-eval-${crypto.randomUUID()}`, role: "owner" as const };
    await loadState(principal);
    await dbBatch([{ sql: "UPDATE organizations SET currency='ARS' WHERE id=?", params: [principal.organizationId] }]);
    const seed = createCozteTools(principal, crypto.randomUUID());
    let seedCall = 0;
    const setup = async (name: keyof typeof seed, input: Record<string, unknown>) => await (seed[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<unknown>)(input, { toolCallId: `seed-${++seedCall}` });
    await setup("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 });
    await setup("saveProduct", { name: "Tofu ahumado", goodUnitsPerLot: 50, lotsPerMonth: 8, hoursPerLot: 6, salePrice: 3200 });
    await setup("saveMaterial", { name: "Soja orgánica", purchaseUnit: "kg", price: 1000 });
    await setup("saveMaterial", { name: "Leña de humo", purchaseUnit: "bolsa", price: 4000 });
    await setup("saveRecipe", { product: "Tofu 300g", items: [{ material: "Soja orgánica", perLot: 30 }] });
    await setup("saveRecipe", { product: "Tofu ahumado", items: [{ material: "Soja orgánica", perLot: 18 }, { material: "Leña de humo", perLot: 2 }] });
    await setup("saveExpense", { name: "Luz", amount: 200000, splitBy: "hours" });
    await setup("saveChannel", { name: "Feria", commissionPercent: 0 });
    await setup("recordSale", { channel: "Feria", items: [{ product: "Tofu 300g", quantity: 60 }, { product: "Tofu ahumado", quantity: 15 }] });

    const history: ModelMessage[] = [];
    const failures: string[] = [];
    const transcript: Record<string, unknown>[] = [];
    const turn = async (text: string, expected: string[]) => {
      const { answer, records, rejected, verified } = await productionTurn({ model, principal, history, text, level: "simple" });
      for (const name of expected) if (!records.some((item) => item.name === name && item.ok)) failures.push(`"${text.slice(0, 40)}…": no ejecutó ${name}`);
      if (!verified) failures.push(`"${text.slice(0, 40)}…": respuesta sin respaldo tras la corrección`);
      const calls = records.filter((item) => item.name === "showVisual" || item.name === "manageBoard").map((item) => ({ tool: item.name, ok: item.ok, input: item.input, error: (item.output as { error?: string } | null)?.error }));
      transcript.push({ user: text, tools: records.map((item) => item.name + (item.ok ? "" : " (falló)")), calls, rejected, answer, board: (await loadCozteSettings(principal)).board.map((widget) => ({ kind: widget.kind, metrics: widget.metrics, title: widget.title, product: widget.productId })) });
      return { records, answer };
    };
    await turn("¿Cómo vengo este mes? Dejámelo fijo en el tablero así lo voy mirando.", ["showVisual"]);
    await turn("También quiero tener siempre a la vista cuánto vendí y cuánto gané, nada más que eso.", ["showVisual"]);
    const breakdown = await turn("¿En qué se me va la plata de cada tofu ahumado?", ["showVisual"]);
    await turn("Sacá del tablero el de cómo vengo en el mes y poné las cifras de ventas y ganancia arriba de todo.", ["manageBoard"]);

    const board = (await loadCozteSettings(principal)).board;
    const state = await loadState(principal);
    const smoked = state.products.find((item) => item.name === "Tofu ahumado")?.id;
    const breakdownShown = breakdown.records.some((item) => item.name === "showVisual" && item.ok && (item.input as { visual?: string } | undefined)?.visual === "cost-breakdown");
    const checks = {
      kpisPinned: board.some((widget) => widget.kind === "kpis" && widget.metrics?.includes("revenue") && widget.metrics?.includes("result")),
      kpisFocused: board.filter((widget) => widget.kind === "kpis").every((widget) => (widget.metrics?.length ?? 0) <= 3),
      monthRemoved: !board.some((widget) => widget.kind === "month"),
      kpisOnTop: board[0]?.kind === "kpis",
      breakdownOfSmoked: breakdownShown && breakdown.records.some((item) => item.name === "showVisual" && (item.output as { productId?: string } | null)?.productId === smoked),
      noDuplicates: new Set(board.map((widget) => `${widget.kind}|${widget.productId ?? ""}|${(widget.metrics ?? []).join("+")}`)).size === board.length,
    };
    for (const [name, passed] of Object.entries(checks)) if (!passed) failures.push(`estado final: ${name}`);
    console.log(`\n[${model}] board ${JSON.stringify(checks)} ${JSON.stringify(board.map((widget) => widget.title ?? widget.kind))}`);
    results.push({ model, scenario: "board", failures: failures.length, failureDetails: failures, ...checks, transcript });
    expect(failures).toEqual([]);
  });

  it.each(models)("records a sale with its delivery, tracks it and corrects both, with %s", async (model) => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    const principal = { userId: "eval", organizationId: `org-eval-${crypto.randomUUID()}`, role: "owner" as const };
    await loadState(principal);
    await dbBatch([{ sql: "UPDATE organizations SET currency='ARS' WHERE id=?", params: [principal.organizationId] }]);
    const seed = createCozteTools(principal, crypto.randomUUID());
    let seedCall = 0;
    const setup = async (name: keyof typeof seed, input: Record<string, unknown>) => await (seed[name].execute as (input: unknown, options: { toolCallId: string }) => Promise<unknown>)(input, { toolCallId: `seed-${++seedCall}` });
    await setup("saveProduct", { name: "Tofu 300g", goodUnitsPerLot: 100, lotsPerMonth: 20, hoursPerLot: 5, salePrice: 2000 });
    await setup("saveMaterial", { name: "Soja orgánica", purchaseUnit: "kg", price: 1000 });
    await setup("saveRecipe", { product: "Tofu 300g", items: [{ material: "Soja orgánica", perLot: 30 }] });
    await setup("saveChannel", { name: "Instagram", commissionPercent: 10, delivery: "Moto propia", deliveryCostPerOrder: 1500, unitsPerOrder: 3 });

    const history: ModelMessage[] = [];
    const failures: string[] = [];
    const transcript: Record<string, unknown>[] = [];
    const turn = async (text: string, expected: string[]) => {
      const { answer, records, rejected, verified } = await productionTurn({ model, principal, history, text, level: "simple" });
      for (const name of expected) if (!records.some((item) => item.name === name && item.ok)) failures.push(`"${text.slice(0, 40)}…": no ejecutó ${name}`);
      if (!verified) failures.push(`"${text.slice(0, 40)}…": respuesta sin respaldo tras la corrección`);
      transcript.push({ user: text, tools: records.map((item) => item.name + (item.ok ? "" : " (falló)")), calls: records.filter((item) => item.name !== "readCosts").map((item) => ({ tool: item.name, ok: item.ok, input: item.input, error: (item.output as { error?: string } | null)?.error })), rejected, answer });
      return { records, answer };
    };
    await turn("Vendí 6 tofus de 300g por Instagram a Bruno Díaz. Hay que llevárselos el jueves a Belgrano 88, entre 9 y 13.", ["recordSale"]);
    const pending = await turn("¿Qué entregas tengo pendientes?", ["readDeliveries"]);
    if (!/bruno/i.test(pending.answer)) failures.push("no nombró la entrega de Bruno al listar las pendientes");
    await turn("Ya se la entregué a Bruno. Ah, y en realidad no eran 6 tofus, eran 8.", ["updateDelivery", "updateSale"]);

    const [sales, deliveries] = await Promise.all([
      dbQuery<{ id: string; total_minor: number; customer: string }>("SELECT id, total_minor, customer FROM sales WHERE organization_id=? AND archived_at IS NULL", [principal.organizationId]),
      dbQuery<{ status: string; scheduled_on: string; address: string; time_window: string; delivered_on: string | null }>("SELECT status, scheduled_on, address, time_window, delivered_on FROM deliveries WHERE organization_id=? AND archived_at IS NULL", [principal.organizationId]),
    ]);
    const thursday = deliveries[0] ? new Date(`${deliveries[0].scheduled_on}T12:00:00Z`).getUTCDay() === 4 : false;
    const checks = {
      oneSale: sales.length === 1,
      correctedTo8: sales[0]?.total_minor === 16_000,
      customer: /bruno/i.test(sales[0]?.customer ?? ""),
      oneDelivery: deliveries.length === 1,
      address: /belgrano 88/i.test(deliveries[0]?.address ?? ""),
      window: /9/.test(deliveries[0]?.time_window ?? "") && /13/.test(deliveries[0]?.time_window ?? ""),
      scheduledThursday: thursday,
      delivered: deliveries[0]?.status === "delivered" && Boolean(deliveries[0]?.delivered_on),
    };
    for (const [name, passed] of Object.entries(checks)) if (!passed) failures.push(`estado final: ${name}`);
    console.log(`\n[${model}] deliveries ${JSON.stringify(checks)} ${JSON.stringify(deliveries)}`);
    results.push({ model, scenario: "deliveries", failures: failures.length, failureDetails: failures, ...checks, transcript });
    expect(failures).toEqual([]);
  });
});
