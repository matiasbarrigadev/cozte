import "server-only";
import { experimental_evaluate as evaluate, isStepCount, type ModelMessage, type UIMessage } from "ai";
import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { getWritable, getWorkflowMetadata, sleep } from "workflow";
import { repairCozteToolInput } from "@/lib/cozte-tool-repair";
import { COZTE_TOOL_NAMES, cozteToolSucceeded, cozteToolWrote, questionsShown } from "@/lib/cozte-tool-catalog";
import { COZTE_ASSISTANT_ID_PREFIX, COZTE_FALLBACK_ID_PREFIX, compactToolOutputForHistory, withCreatedAt } from "@/lib/cozte-conversation-memory";
import { cleanLegacyWording, correctionMessage, discardReason, finalAnswerStep, hasHardIssue, receiptOnlyAnswer, salvageAnswer, stripForeignScript, turnResults, verifyCozteResponse, type TurnToolRecord, type Verification } from "@/lib/cozte-response-verifier";
import { QUALITY_QUESTIONS, actionableFlags, qualityFeedback, qualityLine, qualityMode, qualityState, summarizeQuality, type QualityAnswers, type QualityMode, type QualitySummary } from "@/lib/cozte-quality";
import type { ExplanationLevel } from "@/lib/cozte-levels";
import { discardedDraftMetadata, qualityNoteMetadata } from "@/lib/cozte-turn-activity";
import type { Principal } from "./auth";
import { loadRecentMessages, saveMessages } from "./cozte-messages";
import { addAssistantEvent, addAssistantWorkflowEvent, errorDetails, finishAssistantRun, isAssistantWorkflowLinked, reopenAssistantRunAsFailed } from "./assistant-trace";
import { cozteToolJsonSchema, createCozteTools } from "./cozte-agent-tools";
import { loadState } from "./state";
import { buildCostOverview } from "@/lib/cozte-cost-view";

export type CozteAgentSettings = {
  model: string;
  fallbackModels: string[];
  /** Extended-thinking budget per model step. It is a ceiling: the model spends only what it needs. */
  thinkingBudget: number;
  maxSteps: number;
  maxOutputTokens: number;
  /** Jev review of each answer: "revise" rewrites clear failures once, "observe" only scores, "off" skips it. */
  qualityMode?: QualityMode;
  /** Past this many milliseconds a turn is only scored, never rewritten, so a long turn does not wait even longer. */
  qualityMaxMs?: number;
};

/** Reads the model configuration outside the workflow sandbox, where environment variables are available. */
export function cozteAgentSettings(env: Record<string, string | undefined> = process.env): CozteAgentSettings {
  const requested = Number(env.COZTE_THINKING_BUDGET);
  // 24k keeps a worst-case thinking step well inside the 300 s limit of a workflow step.
  const thinkingBudget = Number.isInteger(requested) && requested >= 1024 && requested <= 64_000 ? requested : 24_000;
  return {
    model: env.COZTE_MODEL?.trim() || "minimax/minimax-m3",
    fallbackModels: (env.COZTE_FALLBACK_MODELS ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    thinkingBudget,
    maxSteps: 24,
    maxOutputTokens: thinkingBudget + 8_000,
    qualityMode: qualityMode(env.COZTE_QUALITY),
    qualityMaxMs: Number(env.COZTE_QUALITY_MAX_MS) > 0 ? Number(env.COZTE_QUALITY_MAX_MS) : 40_000,
  };
}

/**
 * Provider options for extended thinking. The SDK-level `reasoning` setting does not reach MiniMax through the
 * gateway (it falls back to a fixed 1,024-token budget); an explicit thinking budget does. Anthropic-compatible
 * providers read the same shape.
 */
export function cozteProviderOptions(settings: CozteAgentSettings) {
  const thinking = { type: "enabled" as const, budgetTokens: settings.thinkingBudget };
  return {
    minimax: { thinking },
    anthropic: { thinking },
    ...(settings.fallbackModels.length ? { gateway: { models: settings.fallbackModels } } : {}),
  };
}

export type CozteWorkflowInput = {
  principal: Principal;
  runId: string;
  instructions: string;
  messages: ModelMessage[];
  persistedMessages: UIMessage[];
  settings: CozteAgentSettings;
  level?: ExplanationLevel;
};

type FinalizeInput = {
  principal: Principal;
  runId: string;
  messages: UIMessage[];
  status: "completed" | "failed" | "aborted";
  error?: string;
  responseText?: string;
};

type StepLike = {
  text: string; reasoningText?: string;
  toolCalls: { toolCallId: string; toolName: string; input: unknown; invalid?: boolean; error?: unknown }[];
  toolResults: { toolCallId: string; toolName: string; output: unknown }[];
  content?: { type: string; toolCallId?: string; error?: unknown }[];
};

/** Why a tool call has no result: it failed while running, or its arguments were rejected before it ran. */
function toolFailure(step: StepLike, toolCallId: string): string {
  const call = step.toolCalls.find((item) => item.toolCallId === toolCallId);
  const failure = step.content?.find((part) => part.type === "tool-error" && part.toolCallId === toolCallId)?.error ?? call?.error;
  const text = failure instanceof Error ? `${failure.name}: ${failure.message}` : typeof failure === "string" ? failure : failure ? JSON.stringify(failure) : "No se completó";
  return text.slice(0, 1_500);
}

/** Stores the turn's answer (the person's message was stored when it arrived), stamped with when it finished. */
async function saveAnswer(input: FinalizeInput): Promise<void> {
  const answer = input.messages.at(-1);
  if (answer?.role === "assistant") await saveMessages(input.principal, [withCreatedAt(answer, new Date().toISOString())]);
}

async function finalizeCozteRun(input: FinalizeInput): Promise<void> {
  "use step";
  // Claim the turn first. If it was already closed as stalled, a late answer is still kept when the
  // conversation has not moved on; otherwise it must not overwrite what the person wrote since.
  const claimed = await finishAssistantRun(input.runId, input.status, input.error);
  if (!claimed) {
    const turnMessageId = input.messages.findLast((message) => message.role === "user")?.id;
    const stored = await loadRecentMessages(input.principal, 1);
    const unchanged = input.status === "completed" && turnMessageId !== undefined && stored.at(-1)?.id === turnMessageId;
    if (unchanged) await saveAnswer(input);
    await addAssistantEvent(input.runId, unchanged ? "late_finish_saved" : "late_finish_ignored", { outcome: input.status }).catch(() => {});
    return;
  }
  try {
    if (input.status === "completed") await saveAnswer(input);
    await addAssistantEvent(input.runId, "stream_finished", { outcome: input.status, response: input.responseText?.slice(0, 8_000) ?? "", emptyResponse: !input.responseText?.trim() });
  } catch (error) {
    console.error("Cozte workflow completion save failed", input.runId, errorDetails(error));
    await reopenAssistantRunAsFailed(input.runId, error).catch(() => {});
    throw error;
  }
}

type QualityNote = { id: string; summary: QualitySummary; revised: boolean };

/**
 * Reviews an answer with TypeSafe Jev and records the scores. Returns null when the review is unavailable,
 * so a Jev failure never blocks or changes the answer.
 */
async function evaluateAnswer(input: { runId: string; level: ExplanationLevel; userMessage: string; actions: string[]; answer: string; pass: "first" | "revised" }): Promise<QualitySummary | null> {
  "use step";
  try {
    const result = await evaluate({ model: process.env.COZTE_QUALITY_MODEL || "typesafe-ai/jev", state: qualityState(input), questions: QUALITY_QUESTIONS, maxRetries: 1, abortSignal: AbortSignal.timeout(15_000) });
    const answers = result.answers as QualityAnswers;
    const summary = summarizeQuality(answers);
    await addAssistantEvent(input.runId, "quality_scored", { pass: input.pass, model: result.response.modelId, level: input.level, ...summary, answers });
    return summary;
  } catch (error) {
    await addAssistantEvent(input.runId, "quality_failed", { pass: input.pass, error: errorDetails(error).slice(0, 300) }).catch(() => {});
    return null;
  }
}

async function writeQualityParts(writer: WritableStreamDefaultWriter<ModelCallStreamPart>, notes: QualityNote[]): Promise<void> {
  for (const note of notes) {
    const providerMetadata = qualityNoteMetadata(note.summary, note.revised);
    await writer.write({ type: "reasoning-start", id: note.id, providerMetadata } as ModelCallStreamPart);
    await writer.write({ type: "reasoning-delta", id: note.id, text: qualityLine(note.summary), providerMetadata } as ModelCallStreamPart);
    await writer.write({ type: "reasoning-end", id: note.id, providerMetadata } as ModelCallStreamPart);
  }
}

/** Shows the review of the final answer in the collapsed trace. */
async function writeQualityNote(writable: WritableStream<ModelCallStreamPart>, note: QualityNote): Promise<void> {
  "use step";
  const writer = writable.getWriter();
  try { await writeQualityParts(writer, [note]); }
  finally { writer.releaseLock(); }
}

async function readCostOverview(principal: Principal): Promise<Record<string, unknown>> {
  "use step";
  const state = await loadState(principal);
  return { ok: true, ...buildCostOverview(state) };
}

/** The time, read in a step so a replayed workflow sees the same clock. */
async function clock(): Promise<number> {
  "use step";
  return Date.now();
}

async function recordCozteEvent(runId: string, kind: string, payload: unknown): Promise<void> {
  "use step";
  await addAssistantEvent(runId, kind, payload);
}

/** Ends the UI stream once the answer has been accepted. */
async function closeCozteStream(writable: WritableStream<ModelCallStreamPart>): Promise<void> {
  "use step";
  const writer = writable.getWriter();
  try { await writer.write({ type: "finish" } as unknown as ModelCallStreamPart); }
  finally { writer.releaseLock(); }
  await writable.close();
}

type Draft = { id: string; text: string; reason: string };

/**
 * Takes the last step off the screen and, when it held an answer, leaves it in the trace as a discarded draft.
 * The closing step boundary keeps the draft in place when the next model call resets its own step.
 */
async function writeRetraction(writer: WritableStreamDefaultWriter<ModelCallStreamPart>, draft: Draft | null, notes: QualityNote[] = []): Promise<void> {
  await writer.write({ type: "reset-step" });
  if (!draft) return;
  const providerMetadata = discardedDraftMetadata(draft.reason);
  await writer.write({ type: "reasoning-start", id: draft.id, providerMetadata } as ModelCallStreamPart);
  await writer.write({ type: "reasoning-delta", id: draft.id, text: stripForeignScript(draft.text).slice(0, 4000), providerMetadata } as ModelCallStreamPart);
  await writer.write({ type: "reasoning-end", id: draft.id, providerMetadata } as ModelCallStreamPart);
  await writeQualityParts(writer, notes);
  await writer.write({ type: "finish-step" } as unknown as ModelCallStreamPart);
  await writer.write({ type: "start-step" } as unknown as ModelCallStreamPart);
}

/**
 * Moves a rejected answer from the screen into the trace before the correction pass writes the new one.
 * An answer sent together with questions sits behind a step boundary the reset cannot cross; the stored turn is
 * still right, and the screen matches it on the next load.
 */
async function retractAnswer(writable: WritableStream<ModelCallStreamPart>, draft: Draft, notes: QualityNote[] = []): Promise<void> {
  "use step";
  const writer = writable.getWriter();
  try { await writeRetraction(writer, draft, notes); }
  finally { writer.releaseLock(); }
}

/** Replaces the unverified last step on screen with an answer built only from tool receipts. */
async function writeReceiptAnswer(writable: WritableStream<ModelCallStreamPart>, text: string, id: string, draft: Draft | null): Promise<void> {
  "use step";
  const writer = writable.getWriter();
  try {
    await writeRetraction(writer, draft);
    await writer.write({ type: "text-start", id } as ModelCallStreamPart);
    await writer.write({ type: "text-delta", id, text } as ModelCallStreamPart);
    await writer.write({ type: "text-end", id } as ModelCallStreamPart);
  } finally { writer.releaseLock(); }
}

async function repairCozteToolCall({ toolCall, error }: { toolCall: { type: "tool-call"; toolCallId: string; toolName: string; input: string }; error: { message: string } }): Promise<{ type: "tool-call"; toolCallId: string; toolName: string; input: string } | null> {
  "use step";
  if (!(COZTE_TOOL_NAMES as string[]).includes(toolCall.toolName)) return null;
  const repaired = repairCozteToolInput(toolCall.toolName, toolCall.input, cozteToolJsonSchema(toolCall.toolName) ?? undefined);
  if (!repaired || repaired === toolCall.input) return null;
  const { workflowRunId } = getWorkflowMetadata();
  await addAssistantWorkflowEvent(workflowRunId, "tool_input_repaired", { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, reason: error.message })
    .catch((traceError) => console.error("Cozte repair trace failed", errorDetails(traceError)));
  return { ...toolCall, input: repaired };
}

async function checkCozteWorkflowLink(input: { principal: Principal; runId: string; workflowRunId: string }): Promise<boolean> {
  "use step";
  return isAssistantWorkflowLinked(input.principal, input.runId, input.workflowRunId);
}

function lastUserText(messages: ModelMessage[]): string {
  const last = [...messages].reverse().find((message) => message.role === "user");
  if (!last) return "";
  return typeof last.content === "string" ? last.content : last.content.map((part) => part.type === "text" ? part.text : "").join(" ");
}

function toolRecords(steps: StepLike[]): TurnToolRecord[] {
  return steps.flatMap((step) => step.toolResults.map((result) => ({
    name: result.toolName,
    ok: cozteToolSucceeded(result.output),
    write: cozteToolWrote(result.toolName, result.output),
    output: result.output,
  })));
}

/**
 * The answer the person reads: the text of the step that closed the turn. Text written before tools is a working
 * note shown in the collapsed trace, so it is neither verified as the answer nor able to contradict it.
 */
function answerText(steps: StepLike[], retracted: Map<number, string>): string {
  const index = finalAnswerStep(steps);
  return index >= 0 && !retracted.has(index) ? steps[index].text.trim() : "";
}

/** The answer step, if it still holds text on screen: what a retraction turns into a discarded draft. */
function answerDraft(runId: string, steps: StepLike[], retracted: Map<number, string>, reason: string): { index: number; draft: Draft } | null {
  const index = finalAnswerStep(steps);
  if (index < 0 || retracted.has(index) || !steps[index].text.trim()) return null;
  return { index, draft: { id: `draft-${runId}-${index}`, text: steps[index].text, reason } };
}

/**
 * The persisted assistant turn mirrors the screen: each step's reasoning, text and tool receipts in order, discarded
 * drafts with their reason, then any receipt-only answer.
 */
function assistantTurn(runId: string, steps: StepLike[], retracted: Map<number, string>, closing: { text: string; fallback: boolean } | null, quality: { after: Map<number, QualityNote[]>; final: QualityNote | null } = { after: new Map(), final: null }): UIMessage {
  const note = (item: QualityNote) => ({ type: "reasoning", text: qualityLine(item.summary), providerMetadata: qualityNoteMetadata(item.summary, item.revised) }) as UIMessage["parts"][number];
  const parts: UIMessage["parts"] = [];
  steps.forEach((step, index) => {
    // Reasoning is kept (clipped) so the work between iterations can be reviewed later; it is never replayed to the model.
    const reasoning = step.reasoningText?.trim();
    if (reasoning && stripForeignScript(reasoning).trim().length > reasoning.length * 0.8) parts.push({ type: "reasoning", text: reasoning.slice(0, 2_000) } as UIMessage["parts"][number]);
    const discarded = retracted.get(index);
    if (discarded !== undefined && step.text.trim()) parts.push({ type: "reasoning", text: stripForeignScript(step.text).slice(0, 4_000), providerMetadata: discardedDraftMetadata(discarded) } as UIMessage["parts"][number]);
    else if (discarded === undefined && step.text.trim()) parts.push({ type: "text", text: cleanLegacyWording(stripForeignScript(step.text)) });
    for (const call of step.toolCalls) {
      // Questions attached to a discarded answer left the screen with it.
      if (discarded !== undefined && call.toolName === "askQuestions") continue;
      const result = step.toolResults.find((item) => item.toolCallId === call.toolCallId);
      // A failed call stays in the trace as it was seen live, so the working notes around it are not taken for the answer.
      if (!result) parts.push({ type: `tool-${call.toolName}`, toolCallId: call.toolCallId, state: "output-error", input: call.input, errorText: toolFailure(step, call.toolCallId) } as UIMessage["parts"][number]);
      else parts.push({ type: `tool-${call.toolName}`, toolCallId: call.toolCallId, state: "output-available", input: call.input, output: compactToolOutputForHistory(call.toolName, result.output) } as UIMessage["parts"][number]);
    }
    for (const item of quality.after.get(index) ?? []) parts.push(note(item));
  });
  if (closing) parts.push({ type: "text", text: closing.text });
  if (quality.final) parts.push(note(quality.final));
  // A receipt is system text, kept out of the model's memory; a salvaged answer is the assistant's verified voice.
  return { id: `${closing?.fallback ? COZTE_FALLBACK_ID_PREFIX : COZTE_ASSISTANT_ID_PREFIX}${runId}`, role: "assistant", parts };
}

export async function cozteAssistantWorkflow(input: CozteWorkflowInput): Promise<void> {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  let linked = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await checkCozteWorkflowLink({ principal: input.principal, runId: input.runId, workflowRunId })) {
      linked = true;
      break;
    }
    await sleep("500ms");
  }
  if (!linked) {
    await finalizeCozteRun({ principal: input.principal, runId: input.runId, messages: input.persistedMessages, status: "failed", error: "workflow_link_missing" });
    return;
  }
  const startedAt = await clock();
  const writable = getWritable<ModelCallStreamPart>();
  const { settings } = input;
  const agent = new WorkflowAgent({
    model: settings.model,
    instructions: input.instructions,
    tools: createCozteTools(input.principal, input.runId),
    // Asking the person questions ends the turn: the answers arrive as their next message.
    stopWhen: [isStepCount(settings.maxSteps), questionsShown],
    maxOutputTokens: settings.maxOutputTokens,
    providerOptions: cozteProviderOptions(settings),
    repairToolCall: repairCozteToolCall,
  });

  try {
    const first = await agent.stream({ messages: input.messages, writable, preventClose: true, sendFinish: false });
    const steps: StepLike[] = [...first.steps];
    let conversation = first.messages as ModelMessage[];
    // Answer steps taken off the screen, with the reason: they stay in the trace as discarded drafts.
    const retracted = new Map<number, string>();
    let text = answerText(steps, retracted);
    // Figures may come from this turn's tools or from the conversation (the person's messages and earlier answers).
    const context = { sources: [input.instructions, ...input.messages.map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content))] };
    let verification: Verification = verifyCozteResponse(text, toolRecords(steps), context);
    let modelError = "error" in first ? errorDetails(first.error) : undefined;
    let corrected = false;

    if (!verification.ok && !modelError) {
      corrected = true;
      await recordCozteEvent(input.runId, "answer_rejected", { pass: 1, issues: verification.issues, response: text.slice(0, 4000) });
      // A missing answer needs no retraction: the correction pass then only writes the closing message.
      const rejected = answerDraft(input.runId, steps, retracted, discardReason(verification));
      if (rejected) {
        retracted.set(rejected.index, rejected.draft.reason);
        await retractAnswer(writable, rejected.draft);
      }
      try {
        // Tool use is requested in the correction text, not forced: MiniMax ignores toolChoice "required" and the SDK then throws.
        const second = await agent.stream({
          messages: [...(first.messages as ModelMessage[]).filter((message) => message.role !== "system"), { role: "user", content: correctionMessage(verification) }],
          writable, preventClose: true, sendFinish: false,
          stopWhen: [isStepCount(Math.max(4, Math.floor(settings.maxSteps / 2))), questionsShown],
        });
        steps.push(...second.steps);
        conversation = second.messages as ModelMessage[];
        text = answerText(steps, retracted);
        verification = verifyCozteResponse(text, toolRecords(steps), context);
        if ("error" in second) modelError = errorDetails(second.error);
      } catch (error) {
        modelError = errorDetails(error);
      }
    }

    const records = toolRecords(steps);
    let receiptText: string | null = null;
    let salvagedText: string | null = null;
    // After a correction only hard issues (unbacked saves, invented ids…) and figures no tool backs discard the answer.
    const blocking = (result: Verification) => corrected ? hasHardIssue(result) || result.issues.some((issue) => issue.code === "unverified-figures") : !result.ok;
    // Before discarding, keep the verified answer without the sentences that break it: the person still gets their answer.
    if (!modelError && blocking(verification) && text.trim()) {
      const salvaged = salvageAnswer(text, verification, records, context);
      if (salvaged) {
        await recordCozteEvent(input.runId, "answer_salvaged", { issues: verification.issues, response: text.slice(0, 4000), salvaged: salvaged.slice(0, 4000) });
        const replaced = answerDraft(input.runId, steps, retracted, discardReason(verification));
        if (replaced) retracted.set(replaced.index, replaced.draft.reason);
        await writeReceiptAnswer(writable, salvaged, `salvaged-${input.runId}`, replaced?.draft ?? null);
        text = salvaged;
        salvagedText = salvaged;
        verification = verifyCozteResponse(salvaged, records, context);
      }
    }
    if (!salvagedText && (modelError || blocking(verification))) {
      await recordCozteEvent(input.runId, "answer_replaced", { issues: verification.issues, modelError, response: text.slice(0, 4000) });
      // The fallback answers with what the turn found; without results or a read it reads the stored state itself.
      const hasRead = records.some((item) => item.name === "readCosts" && item.ok);
      const evidence = hasRead || turnResults(records).length ? records : [...records, { name: "readCosts", ok: true, write: false, output: await readCostOverview(input.principal).catch(() => null) }];
      receiptText = receiptOnlyAnswer(evidence);
      const replaced = answerDraft(input.runId, steps, retracted, modelError && verification.ok ? "Se interrumpió por un error del modelo." : discardReason(verification));
      if (replaced) retracted.set(replaced.index, replaced.draft.reason);
      await writeReceiptAnswer(writable, receiptText, `receipt-${input.runId}`, replaced?.draft ?? null);
      text = receiptText;
    }
    // Quality review with Jev: the verifier already vouched for the facts; Jev judges whether the answer serves the
    // person (answers, explains its assumptions, teaches, fits their level, reads clearly). Clear failures get one
    // rewrite that must pass the verifier again; otherwise the verified original stays.
    const qualityAfter = new Map<number, QualityNote[]>();
    let finalQuality: QualityNote | null = null;
    const answeredAt = await clock();
    // A turn that already took long is scored but not rewritten: the person should not wait even more.
    const turnMode = settings.qualityMode === "revise" && answeredAt - startedAt > (settings.qualityMaxMs ?? 40_000) ? "observe" : settings.qualityMode;
    if (!receiptText && text.trim() && turnMode !== "off") {
      const level = input.level ?? "simple";
      const review = (answer: string, pass: "first" | "revised") => evaluateAnswer({
        runId: input.runId, level, userMessage: lastUserText(input.messages), answer: cleanLegacyWording(answer), pass,
        actions: toolRecords(steps).map((item) => {
          const done = (item.output as { done?: unknown } | null)?.done;
          return `${item.name}${item.ok ? "" : " (falló)"}${Array.isArray(done) && done.length ? `: ${done.map(String).join("; ")}` : ""}`;
        }),
      });
      const firstReview = await review(text, "first");
      // A turn that ends with questions shows a form Jev cannot see: it is scored, never rewritten.
      const askedQuestions = steps[finalAnswerStep(steps)]?.toolCalls.some((call) => call.toolName === "askQuestions") ?? false;
      const flags = firstReview && turnMode === "revise" && !askedQuestions ? actionableFlags(firstReview, { wrote: records.some((item) => item.write && item.ok) }) : [];
      const original = flags.length ? answerDraft(input.runId, steps, retracted, `Revisión de calidad: ${flags.join(", ")}`) : null;
      if (firstReview && original) {
        const firstNote = { id: `quality-${input.runId}-first`, summary: firstReview, revised: false };
        retracted.set(original.index, original.draft.reason);
        qualityAfter.set(original.index, [firstNote]);
        await retractAnswer(writable, original.draft, [firstNote]);
        await recordCozteEvent(input.runId, "quality_revision", { flags, response: text.slice(0, 4000) });
        let revisedText = "";
        try {
          const revision = await agent.stream({
            messages: [...conversation.filter((message) => message.role !== "system"), { role: "user", content: qualityFeedback(flags) }],
            writable, preventClose: true, sendFinish: false, stopWhen: [isStepCount(3), questionsShown],
          });
          steps.push(...revision.steps);
          revisedText = "error" in revision ? "" : answerText(steps, retracted);
        } catch { revisedText = ""; }
        if (revisedText && verifyCozteResponse(revisedText, toolRecords(steps), context).ok) {
          text = revisedText;
          const secondReview = await review(revisedText, "revised");
          if (secondReview) finalQuality = { id: `quality-${input.runId}-revised`, summary: secondReview, revised: true };
        } else {
          // The rewrite did not hold up: the verified original comes back.
          retracted.delete(original.index);
          const failed = answerDraft(input.runId, steps, retracted, "La versión revisada no pasó la verificación");
          if (failed && failed.index !== original.index) retracted.set(failed.index, failed.draft.reason);
          await writeReceiptAnswer(writable, cleanLegacyWording(stripForeignScript(original.draft.text)), `restored-${input.runId}`, failed && failed.index !== original.index ? failed.draft : null);
          await recordCozteEvent(input.runId, "quality_revision_rejected", {});
        }
      } else if (firstReview) {
        finalQuality = { id: `quality-${input.runId}-first`, summary: firstReview, revised: false };
      }
      if (finalQuality) await writeQualityNote(writable, finalQuality);
    }
    await closeCozteStream(writable);
    const closedAt = await clock();
    await recordCozteEvent(input.runId, "turn_timing", {
      totalMs: closedAt - startedAt, answerMs: answeredAt - startedAt, qualityMs: closedAt - answeredAt,
      steps: steps.length, tools: records.length, qualityMode: turnMode, skippedRewrite: turnMode !== settings.qualityMode,
    }).catch(() => {});
    const assistantMessage = assistantTurn(input.runId, steps, retracted, receiptText ? { text: receiptText, fallback: true } : salvagedText ? { text: salvagedText, fallback: false } : null, { after: qualityAfter, final: finalQuality });
    await finalizeCozteRun({
      principal: input.principal, runId: input.runId,
      messages: [...input.persistedMessages, assistantMessage],
      status: modelError && !records.length ? "failed" : "completed",
      error: modelError, responseText: text,
    });
  } catch (error) {
    await recordCozteEvent(input.runId, "stream_error", { error: errorDetails(error) }).catch((traceError) => console.error("Cozte workflow error trace failed", errorDetails(traceError)));
    await finalizeCozteRun({ principal: input.principal, runId: input.runId, messages: input.persistedMessages, status: "failed", error: errorDetails(error) }).catch(() => {});
    throw error;
  }
}
