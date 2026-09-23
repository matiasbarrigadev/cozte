import { convertToModelMessages, createUIMessageStreamResponse, validateUIMessages, type UIMessage } from "ai";
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { start } from "workflow/api";
import { z } from "zod";
import { ApiError, apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadConversation, saveConversation } from "@/lib/server/production-profile";
import { reserveAssistantRequest } from "@/lib/server/assistant-limits";
import { addAssistantEvent, errorDetails, finishAssistantRun, getActiveAssistantWorkflow, listAssistantToolExecutions, linkAssistantWorkflowRun, startAssistantRun } from "@/lib/server/assistant-trace";
import { loadProductionProfile } from "@/lib/server/production-profile";
import { loadState } from "@/lib/server/state";
import { buildCozteInstructions, createCozteTools } from "@/lib/server/cozte-agent-tools";
import { cozteAssistantWorkflow, COZTE_MAX_AGENT_STEPS } from "@/lib/server/cozte-workflow";
import { COZTE_ASSISTANT_ATTACHMENT_MEDIA_TYPES, COZTE_MAX_ATTACHMENT_COUNT, COZTE_MAX_IMAGE_COUNT, COZTE_MAX_IMAGE_BYTES, COZTE_MAX_PDF_BYTES, COZTE_MAX_SPREADSHEET_COUNT, COZTE_MAX_SPREADSHEET_BYTES, COZTE_MAX_TOTAL_ATTACHMENT_BYTES, COZTE_MAX_TOTAL_IMAGE_BYTES, COZTE_SPREADSHEET_MEDIA_TYPE, prepareCozteModelMessages } from "@/lib/cozte-assistant-attachments";

export const runtime = "nodejs";
export const maxDuration = 300;

const incomingAttachmentSchema = z.object({
  type: z.literal("file"),
  filename: z.string().max(200).optional(),
  mediaType: z.enum(COZTE_ASSISTANT_ATTACHMENT_MEDIA_TYPES),
  url: z.string().max(7_000_000).regex(/^data:(?:image\/(?:png|jpeg|webp)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet);base64,[A-Za-z0-9+/=]+$/),
}).superRefine((part, context) => {
  if (!part.url.startsWith(`data:${part.mediaType};base64,`)) context.addIssue({ code: "custom", message: "El tipo del archivo no coincide con su contenido", path: ["url"] });
  const payload = part.url.slice(part.url.indexOf(",") + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const bytes = Math.floor(payload.length * 3 / 4) - padding;
  const maxBytes = part.mediaType === "application/pdf" ? COZTE_MAX_PDF_BYTES : part.mediaType === COZTE_SPREADSHEET_MEDIA_TYPE ? COZTE_MAX_SPREADSHEET_BYTES : COZTE_MAX_IMAGE_BYTES;
  if (bytes > maxBytes) context.addIssue({ code: "custom", message: "El archivo supera el límite de tamaño permitido", path: ["url"] });
});

function attachmentBytes(url: string): number {
  const payload = url.slice(url.indexOf(",") + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor(payload.length * 3 / 4) - padding;
}

const incomingSchema = z.object({
  message: z.object({
    id: z.string().min(1).max(100),
    role: z.literal("user"),
    parts: z.array(z.union([
      z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(8000) }),
      incomingAttachmentSchema,
    ])).min(1).max(COZTE_MAX_ATTACHMENT_COUNT + 1).superRefine((parts, context) => {
      const attachments = parts.filter((part) => part.type === "file");
      const images = attachments.filter((part) => part.mediaType.startsWith("image/"));
      const spreadsheets = attachments.filter((part) => part.mediaType === COZTE_SPREADSHEET_MEDIA_TYPE);
      if (attachments.length > COZTE_MAX_ATTACHMENT_COUNT) context.addIssue({ code: "custom", message: "Puedes adjuntar hasta ocho archivos", path: [] });
      if (images.length > COZTE_MAX_IMAGE_COUNT) context.addIssue({ code: "custom", message: "Puedes adjuntar hasta seis imágenes", path: [] });
      if (spreadsheets.length > COZTE_MAX_SPREADSHEET_COUNT) context.addIssue({ code: "custom", message: "Puedes adjuntar hasta tres planillas Excel", path: [] });
      const totalBytes = attachments.reduce((total, part) => total + attachmentBytes(part.url), 0);
      const totalImageBytes = images.reduce((total, part) => total + attachmentBytes(part.url), 0);
      if (totalBytes > COZTE_MAX_TOTAL_ATTACHMENT_BYTES) context.addIssue({ code: "custom", message: "Los archivos adjuntos superan 12 MB en total", path: [] });
      if (totalImageBytes > COZTE_MAX_TOTAL_IMAGE_BYTES) context.addIssue({ code: "custom", message: "Las imágenes adjuntas superan 8 MB en total", path: [] });
    }),
  }),
});

function persistableMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    const textParts = message.parts.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text").map((part) => ({ type: "text" as const, text: part.text.slice(0, 2000) }));
    if (textParts.length) return { id: message.id, role: message.role, parts: textParts } as UIMessage;
    if (message.role === "user") {
      const files = message.parts.filter((part): part is Extract<typeof part, { type: "file" }> => part.type === "file");
      if (files.length) return { id: message.id, role: message.role, parts: [{ type: "text" as const, text: `Adjuntó ${files.map((file) => file.filename || (file.mediaType.startsWith("image/") ? "una imagen" : "un archivo")).join(", ")}.` }] } as UIMessage;
    }
    return { id: message.id, role: message.role, parts: [] } as UIMessage;
  }).filter((message) => message.parts.length > 0);
}

export async function GET() {
  try {
    const principal = await requirePrincipal();
    const messages = await loadConversation(principal);
    const [toolExecutions, activeWorkflow] = await Promise.all([
      listAssistantToolExecutions(principal, messages.map((message) => message.id)),
      getActiveAssistantWorkflow(principal),
    ]);
    return Response.json({ messages, toolExecutions, activeWorkflowRunId: activeWorkflow?.workflowRunId ?? null }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: Request) {
  let runId: string | null = null;
  try {
    const principal = await requirePrincipal();
    if (!process.env.AI_GATEWAY_API_KEY) throw new ApiError(503, "Cozte AI aún no tiene configurada su clave de AI Gateway");
    if (Number(request.headers.get("content-length") ?? 0) > 17_000_000) throw new ApiError(413, "El mensaje o los archivos adjuntos superan el límite de tamaño");
    const { message } = incomingSchema.parse(await request.json());
    if (!message.parts.some((part) => part.type === "text") && !message.parts.some((part) => part.type === "file")) throw new ApiError(400, "Escribe un mensaje o adjunta una imagen");
    const [state, profileState, previous] = await Promise.all([loadState(principal), loadProductionProfile(principal), loadConversation(principal)]);
    if (previous.at(-1)?.id === message.id) throw new ApiError(409, "Ese mensaje ya fue recibido");
    await reserveAssistantRequest(principal);
    const candidateRunId = crypto.randomUUID();
    const tools = createCozteTools(principal, candidateRunId);
    const incoming: UIMessage = { id: message.id, role: "user", parts: message.parts };
    const validated = await validateUIMessages({ messages: [...previous.slice(-22), incoming], tools });
    const instructions = buildCozteInstructions(state, profileState);
    const modelMessages = prepareCozteModelMessages(await convertToModelMessages(validated));
    const safeMessages = persistableMessages(validated);
    const settings = { model: "minimax/minimax-m3", provider: "gateway", providerOptions: { gateway: { only: ["minimax"] } }, maxOutputTokens: 2500, maxSteps: COZTE_MAX_AGENT_STEPS, timeoutMs: null, durable: true, attachmentsPersistedAs: "workflow input only; files are excluded from conversation and tool trace" };
    runId = candidateRunId;
    await startAssistantRun(principal, runId, message.id, settings, { messageId: message.id, parts: message.parts.map((part) => part.type === "file" ? { type: "file", filename: part.filename, mediaType: part.mediaType, bytesApprox: attachmentBytes(part.url) } : part) });
    await saveConversation(principal, safeMessages);
    const workflowRun = await start(cozteAssistantWorkflow, [{ principal, runId, instructions, messages: modelMessages, persistedMessages: safeMessages }]);
    await linkAssistantWorkflowRun(principal, runId, workflowRun.runId);
    return createUIMessageStreamResponse({
      stream: workflowRun.readable.pipeThrough(createModelCallToUIChunkTransform()),
      headers: { "x-workflow-run-id": workflowRun.runId, "x-cozte-run-id": runId },
    });
  } catch (error) {
    if (runId) { await addAssistantEvent(runId, "request_error", { error: errorDetails(error) }).catch(() => {}); await finishAssistantRun(runId, "failed", error).catch(() => {}); }
    if (error instanceof z.ZodError) return Response.json({ error: "Mensaje inválido" }, { status: 400 });
    return apiFailure(error);
  }
}
