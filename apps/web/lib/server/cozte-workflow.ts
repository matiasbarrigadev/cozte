import "server-only";
import { isStepCount, type ModelMessage, type UIMessage } from "ai";
import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { getWritable, getWorkflowMetadata, sleep } from "workflow";
import { repairCozteToolInput } from "@/lib/cozte-tool-repair";
import { COZTE_TOOL_NAMES, COZTE_WRITE_TOOLS, cozteToolSucceeded } from "@/lib/cozte-tool-catalog";
import { COZTE_ASSISTANT_ID_PREFIX, COZTE_FALLBACK_ID_PREFIX, compactToolOutputForHistory } from "@/lib/cozte-conversation-memory";
import { correctionMessage, hasHardIssue, receiptOnlyAnswer, stripForeignScript, verifyCozteResponse, type TurnToolRecord, type Verification } from "@/lib/cozte-response-verifier";
import type { Principal } from "./auth";
import { loadConversation, saveConversation } from "./production-profile";
import { addAssistantEvent, addAssistantWorkflowEvent, errorDetails, finishAssistantRun, isAssistantWorkflowLinked, reopenAssistantRunAsFailed } from "./assistant-trace";
import { createCozteTools } from "./cozte-agent-tools";
import { loadState } from "./state";
import { buildCostOverview } from "@/lib/cozte-cost-view";

export type CozteAgentSettings = {
  model: string;
  fallbackModels: string[];
  /** Extended-thinking budget per model step. It is a ceiling: the model spends only what it needs. */
  thinkingBudget: number;
  maxSteps: number;
  maxOutputTokens: number;
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
};

type FinalizeInput = {
  principal: Principal;
  runId: string;
  messages: UIMessage[];
  status: "completed" | "failed" | "aborted";
  error?: string;
  responseText?: string;
};

type StepLike = { text: string; reasoningText?: string; toolCalls: { toolCallId: string; toolName: string; input: unknown }[]; toolResults: { toolCallId: string; toolName: string; output: unknown }[] };

async function finalizeCozteRun(input: FinalizeInput): Promise<void> {
  "use step";
  // Claim the turn first. If it was already closed as stalled, a late answer is still kept when the
  // conversation has not moved on; otherwise it must not overwrite what the person wrote since.
  const claimed = await finishAssistantRun(input.runId, input.status, input.error);
  if (!claimed) {
    const turnMessageId = input.messages.findLast((message) => message.role === "user")?.id;
    const stored = await loadConversation(input.principal);
    const unchanged = input.status === "completed" && turnMessageId !== undefined && stored.at(-1)?.id === turnMessageId;
    if (unchanged) await saveConversation(input.principal, input.messages);
    await addAssistantEvent(input.runId, unchanged ? "late_finish_saved" : "late_finish_ignored", { outcome: input.status }).catch(() => {});
    return;
  }
  try {
    if (input.status === "completed") await saveConversation(input.principal, input.messages);
    await addAssistantEvent(input.runId, "stream_finished", { outcome: input.status, response: input.responseText?.slice(0, 8_000) ?? "", emptyResponse: !input.responseText?.trim() });
  } catch (error) {
    console.error("Cozte workflow completion save failed", input.runId, errorDetails(error));
    await reopenAssistantRunAsFailed(input.runId, error).catch(() => {});
    throw error;
  }
}

async function readCostOverview(principal: Principal): Promise<Record<string, unknown>> {
  "use step";
  const state = await loadState(principal);
  return { ok: true, ...buildCostOverview(state) };
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

/** Replaces the unverified last step on screen with an answer built only from tool receipts. */
async function writeReceiptAnswer(writable: WritableStream<ModelCallStreamPart>, text: string, id: string): Promise<void> {
  "use step";
  const writer = writable.getWriter();
  try {
    await writer.write({ type: "reset-step" });
    await writer.write({ type: "text-start", id } as ModelCallStreamPart);
    await writer.write({ type: "text-delta", id, text } as ModelCallStreamPart);
    await writer.write({ type: "text-end", id } as ModelCallStreamPart);
  } finally { writer.releaseLock(); }
}

async function repairCozteToolCall({ toolCall, error }: { toolCall: { type: "tool-call"; toolCallId: string; toolName: string; input: string }; error: { message: string } }): Promise<{ type: "tool-call"; toolCallId: string; toolName: string; input: string } | null> {
  "use step";
  if (!(COZTE_TOOL_NAMES as string[]).includes(toolCall.toolName)) return null;
  const repaired = repairCozteToolInput(toolCall.toolName, toolCall.input);
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
    write: COZTE_WRITE_TOOLS.has(result.toolName),
    output: result.output,
  })));
}

/** Text the person sees: every step's text in order, except steps whose text was retracted from the screen. */
function visibleText(steps: StepLike[], retracted: Set<number>): string {
  return steps.map((step, index) => retracted.has(index) ? "" : step.text.trim()).filter(Boolean).join("\n\n");
}

/** The persisted assistant turn mirrors the screen: each step's text and tool receipts in order, then any receipt-only answer. */
function assistantTurn(runId: string, steps: StepLike[], retracted: Set<number>, receiptText: string | null): UIMessage {
  const parts: UIMessage["parts"] = [];
  steps.forEach((step, index) => {
    // Reasoning is kept (clipped) so the work between iterations can be reviewed later; it is never replayed to the model.
    const reasoning = step.reasoningText?.trim();
    if (reasoning && stripForeignScript(reasoning).trim().length > reasoning.length * 0.8) parts.push({ type: "reasoning", text: reasoning.slice(0, 2_000) } as UIMessage["parts"][number]);
    if (!retracted.has(index) && step.text.trim()) parts.push({ type: "text", text: stripForeignScript(step.text) });
    for (const call of step.toolCalls) {
      const result = step.toolResults.find((item) => item.toolCallId === call.toolCallId);
      if (!result) continue;
      parts.push({ type: `tool-${call.toolName}`, toolCallId: call.toolCallId, state: "output-available", input: call.input, output: compactToolOutputForHistory(call.toolName, result.output) } as UIMessage["parts"][number]);
    }
  });
  if (receiptText) parts.push({ type: "text", text: receiptText });
  return { id: `${receiptText ? COZTE_FALLBACK_ID_PREFIX : COZTE_ASSISTANT_ID_PREFIX}${runId}`, role: "assistant", parts };
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
  const writable = getWritable<ModelCallStreamPart>();
  const { settings } = input;
  const agent = new WorkflowAgent({
    model: settings.model,
    instructions: input.instructions,
    tools: createCozteTools(input.principal, input.runId),
    stopWhen: isStepCount(settings.maxSteps),
    maxOutputTokens: settings.maxOutputTokens,
    providerOptions: cozteProviderOptions(settings),
    repairToolCall: repairCozteToolCall,
  });

  try {
    const first = await agent.stream({ messages: input.messages, writable, preventClose: true, sendFinish: false });
    const steps: StepLike[] = [...first.steps];
    // Steps whose text a later "reset-step" removed from the screen; they are neither verified again nor stored.
    const retracted = new Set<number>();
    let text = visibleText(steps, retracted);
    const context = { sources: [input.instructions, lastUserText(input.messages)] };
    let verification: Verification = verifyCozteResponse(text, toolRecords(steps), context);
    let modelError = "error" in first ? errorDetails(first.error) : undefined;
    let corrected = false;

    if (!verification.ok && !modelError) {
      corrected = true;
      await recordCozteEvent(input.runId, "answer_rejected", { pass: 1, issues: verification.issues, response: text.slice(0, 4000) });
      retracted.add(steps.length - 1);
      try {
        // The correction's first model step resets the rejected text on screen before streaming the new answer.
        // Tool use is requested in the correction text, not forced: MiniMax ignores toolChoice "required" and the SDK then throws.
        const second = await agent.stream({
          messages: [...(first.messages as ModelMessage[]).filter((message) => message.role !== "system"), { role: "user", content: correctionMessage(verification) }],
          writable, preventClose: true, sendFinish: false,
          stopWhen: isStepCount(Math.max(4, Math.floor(settings.maxSteps / 2))),
        });
        steps.push(...second.steps);
        text = visibleText(steps, retracted);
        verification = verifyCozteResponse(text, toolRecords(steps), context);
        if ("error" in second) modelError = errorDetails(second.error);
      } catch (error) {
        modelError = errorDetails(error);
      }
    }

    const records = toolRecords(steps);
    let receiptText: string | null = null;
    // After a correction only hard issues (unbacked saves, invented ids…) discard the answer; minor ones don't.
    if (modelError || (corrected ? hasHardIssue(verification) : !verification.ok)) {
      await recordCozteEvent(input.runId, "answer_replaced", { issues: verification.issues, modelError, response: text.slice(0, 4000) });
      // Without a read in the turn, the fallback reads the stored state itself so it can still say what is saved.
      const hasRead = records.some((item) => item.name === "readCosts" && item.ok);
      const evidence = hasRead ? records : [...records, { name: "readCosts", ok: true, write: false, output: await readCostOverview(input.principal).catch(() => null) }];
      receiptText = receiptOnlyAnswer(evidence);
      await writeReceiptAnswer(writable, receiptText, `receipt-${input.runId}`);
      if (steps.length) retracted.add(steps.length - 1);
      text = [visibleText(steps, retracted), receiptText].filter(Boolean).join("\n\n");
    }
    await closeCozteStream(writable);
    const assistantMessage = assistantTurn(input.runId, steps, retracted, receiptText);
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
