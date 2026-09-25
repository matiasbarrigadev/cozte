import "server-only";
import { isStepCount, type ModelMessage, type UIMessage } from "ai";
import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { getWritable, getWorkflowMetadata, sleep } from "workflow";
import { repairCozteToolInput } from "@/lib/cozte-tool-repair";
import { COZTE_TOOL_NAMES, COZTE_WRITE_TOOLS, cozteToolSucceeded } from "@/lib/cozte-tool-catalog";
import { compactToolOutputForHistory } from "@/lib/cozte-conversation-memory";
import { correctionMessage, receiptOnlyAnswer, verifyCozteResponse, type TurnToolRecord, type Verification } from "@/lib/cozte-response-verifier";
import type { Principal } from "./auth";
import { saveConversation } from "./production-profile";
import { addAssistantEvent, addAssistantWorkflowEvent, errorDetails, finishAssistantRun, isAssistantWorkflowLinked } from "./assistant-trace";
import { createCozteTools } from "./cozte-agent-tools";
import { loadState } from "./state";
import { buildCostOverview } from "@/lib/cozte-cost-view";

export type CozteAgentSettings = {
  model: string;
  fallbackModels: string[];
  reasoning: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  maxSteps: number;
  maxOutputTokens: number;
};

/** Reads the model configuration outside the workflow sandbox, where environment variables are available. */
export function cozteAgentSettings(env: Record<string, string | undefined> = process.env): CozteAgentSettings {
  const reasoning = env.COZTE_REASONING_EFFORT;
  return {
    model: env.COZTE_MODEL?.trim() || "minimax/minimax-m3",
    fallbackModels: (env.COZTE_FALLBACK_MODELS ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    reasoning: reasoning === "none" || reasoning === "minimal" || reasoning === "low" || reasoning === "high" || reasoning === "xhigh" ? reasoning : "medium",
    maxSteps: 24,
    maxOutputTokens: 16_000,
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

type StepLike = { text: string; toolCalls: { toolCallId: string; toolName: string; input: unknown }[]; toolResults: { toolCallId: string; toolName: string; output: unknown }[] };

async function finalizeCozteRun(input: FinalizeInput): Promise<void> {
  "use step";
  try {
    if (input.status === "completed") await saveConversation(input.principal, input.messages);
    await addAssistantEvent(input.runId, "stream_finished", { outcome: input.status, response: input.responseText?.slice(0, 8_000) ?? "", emptyResponse: !input.responseText?.trim() });
    await finishAssistantRun(input.runId, input.status, input.error);
  } catch (error) {
    console.error("Cozte workflow completion save failed", input.runId, errorDetails(error));
    await finishAssistantRun(input.runId, "failed", error).catch(() => {});
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

/** The persisted assistant turn: real tool calls with compact receipts, then the accepted answer. */
function assistantTurn(runId: string, steps: StepLike[], text: string): UIMessage {
  const parts: UIMessage["parts"] = [];
  for (const step of steps) {
    for (const call of step.toolCalls) {
      const result = step.toolResults.find((item) => item.toolCallId === call.toolCallId);
      if (!result) continue;
      parts.push({ type: `tool-${call.toolName}`, toolCallId: call.toolCallId, state: "output-available", input: call.input, output: compactToolOutputForHistory(call.toolName, result.output) } as UIMessage["parts"][number]);
    }
  }
  if (text.trim()) parts.push({ type: "text", text });
  return { id: `assistant-${runId}`, role: "assistant", parts };
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
    reasoning: settings.reasoning,
    ...(settings.fallbackModels.length ? { providerOptions: { gateway: { models: settings.fallbackModels } } } : {}),
    repairToolCall: repairCozteToolCall,
  });

  try {
    const first = await agent.stream({ messages: input.messages, writable, preventClose: true, sendFinish: false });
    const steps: StepLike[] = [...first.steps];
    let text = first.steps.at(-1)?.text ?? "";
    const context = { sources: [input.instructions, lastUserText(input.messages)] };
    let verification: Verification = verifyCozteResponse(text, toolRecords(steps), context);
    let modelError = "error" in first ? errorDetails(first.error) : undefined;

    if (!verification.ok && !modelError) {
      await recordCozteEvent(input.runId, "answer_rejected", { pass: 1, issues: verification.issues, response: text.slice(0, 4000) });
      try {
        // The correction's first model step resets the rejected text on screen before streaming the new answer.
        // Tool use is requested in the correction text, not forced: MiniMax ignores toolChoice "required" and the SDK then throws.
        const second = await agent.stream({
          messages: [...(first.messages as ModelMessage[]).filter((message) => message.role !== "system"), { role: "user", content: correctionMessage(verification) }],
          writable, preventClose: true, sendFinish: false,
          stopWhen: isStepCount(Math.max(4, Math.floor(settings.maxSteps / 2))),
        });
        steps.push(...second.steps);
        text = second.steps.at(-1)?.text ?? "";
        verification = verifyCozteResponse(text, toolRecords(steps), context);
        if ("error" in second) modelError = errorDetails(second.error);
      } catch (error) {
        modelError = errorDetails(error);
      }
    }

    const records = toolRecords(steps);
    if (!verification.ok || modelError) {
      await recordCozteEvent(input.runId, "answer_replaced", { issues: verification.issues, modelError, response: text.slice(0, 4000) });
      // Without a read in the turn, the fallback reads the stored state itself so it can still say what is saved.
      const hasRead = records.some((item) => item.name === "readCosts" && item.ok);
      const evidence = hasRead ? records : [...records, { name: "readCosts", ok: true, write: false, output: await readCostOverview(input.principal).catch(() => null) }];
      text = receiptOnlyAnswer(evidence);
      await writeReceiptAnswer(writable, text, `receipt-${input.runId}`);
    }
    await closeCozteStream(writable);
    const assistantMessage = assistantTurn(input.runId, steps, text);
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
