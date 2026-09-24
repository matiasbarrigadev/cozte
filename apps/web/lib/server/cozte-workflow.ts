import "server-only";
import { isStepCount, type ModelMessage, type UIMessage } from "ai";
import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { getWritable, getWorkflowMetadata, sleep } from "workflow";
import { repairCozteToolInput } from "@/lib/cozte-tool-repair";
import { verifiedCozteResponse } from "@/lib/cozte-response-verifier";
import type { Principal } from "./auth";
import { saveConversation } from "./production-profile";
import { addAssistantEvent, addAssistantWorkflowEvent, errorDetails, finishAssistantRun, isAssistantWorkflowLinked } from "./assistant-trace";
import { createCozteTools } from "./cozte-agent-tools";

export const COZTE_MAX_AGENT_STEPS = 48;

export type CozteWorkflowInput = {
  principal: Principal;
  runId: string;
  instructions: string;
  messages: ModelMessage[];
  persistedMessages: UIMessage[];
};

type FinalizeInput = {
  principal: Principal;
  runId: string;
  messages: UIMessage[];
  status: "completed" | "failed" | "aborted";
  error?: string;
  responseText?: string;
};

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

async function recordCozteWorkflowError(runId: string, error: unknown): Promise<void> {
  "use step";
  await addAssistantEvent(runId, "stream_error", { error: errorDetails(error) });
}

const cozteToolNames = ["inspectCostBase", "calculateCostRule", "findMaterial", "updateMaterialPrice", "updateExpenseAmount", "updateProductionMap", "upsertProductDraft", "applyCostAction"];

async function repairCozteToolCall({ toolCall, error }: { toolCall: { type: "tool-call"; toolCallId: string; toolName: string; input: string }; error: { message: string } }): Promise<{ type: "tool-call"; toolCallId: string; toolName: string; input: string } | null> {
  "use step";
  if (!cozteToolNames.includes(toolCall.toolName)) return null;
  const repaired = repairCozteToolInput(toolCall.toolName, toolCall.input);
  if (!repaired) return null;
  const { workflowRunId } = getWorkflowMetadata();
  await addAssistantWorkflowEvent(workflowRunId, "tool_input_repaired", { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, reason: error.message })
    .catch((traceError) => console.error("Cozte repair trace failed", errorDetails(traceError)));
  return { ...toolCall, input: repaired };
}

async function checkCozteWorkflowLink(input: { principal: Principal; runId: string; workflowRunId: string }): Promise<boolean> {
  "use step";
  return isAssistantWorkflowLinked(input.principal, input.runId, input.workflowRunId);
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
  const userMessages = input.persistedMessages.filter((message) => message.role === "user").slice(-8)
    .flatMap((message) => message.parts.filter((part) => part.type === "text").map((part) => part.text));
  const tools = createCozteTools(input.principal, input.runId, userMessages);
  const agent = new WorkflowAgent({
    model: "minimax/minimax-m3",
    instructions: input.instructions,
    tools,
    stopWhen: isStepCount(COZTE_MAX_AGENT_STEPS),
    maxOutputTokens: 2500,
    providerOptions: { gateway: { only: ["minimax"] } },
    repairToolCall: repairCozteToolCall,
  });

  try {
    const result = await agent.stream({ messages: input.messages, writable });
    const finalModelMessage = [...result.messages].reverse().find((message) => message.role === "assistant");
    const content = finalModelMessage?.content;
    const rawResponseText = typeof content === "string" ? content : Array.isArray(content)
      ? content.filter((part) => part.type === "text").map((part) => "text" in part ? part.text : "").join("")
      : "";
    const responseText = verifiedCozteResponse(rawResponseText, result.steps.flatMap((step) => step.toolResults.map((item) => ({ toolName: item.toolName, input: item.input, output: item.output }))));
    const status: FinalizeInput["status"] = "error" in result || !responseText.trim() ? "failed" : "completed";
    const assistantMessage: UIMessage = { id: `assistant-${input.runId}`, role: "assistant", parts: responseText.trim() ? [{ type: "text", text: responseText }] : [] };
    const messages = responseText.trim() ? [...input.persistedMessages, assistantMessage] : input.persistedMessages;
    await finalizeCozteRun({ principal: input.principal, runId: input.runId, messages, status, error: "error" in result ? errorDetails(result.error) : status === "failed" ? "empty_response" : undefined, responseText });
  } catch (error) {
    await recordCozteWorkflowError(input.runId, error).catch((traceError) => console.error("Cozte workflow error trace failed", errorDetails(traceError)));
    await finalizeCozteRun({ principal: input.principal, runId: input.runId, messages: input.persistedMessages, status: "failed", error: errorDetails(error) }).catch(() => {});
    throw error;
  }
}
