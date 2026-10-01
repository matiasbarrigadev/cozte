import { convertToModelMessages, createUIMessageStreamResponse, validateUIMessages, type ModelMessage, type UIMessage } from "ai";
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { start } from "workflow/api";
import { z } from "zod";
import { ApiError, apiFailure, forbidAdminView, requirePrincipal } from "@/lib/server/auth";
import { loadMessagePage, loadRecentMessages, saveMessages } from "@/lib/server/cozte-messages";
import { reserveAssistantRequest } from "@/lib/server/assistant-limits";
import { addAssistantEvent, errorDetails, finishAssistantRun, getActiveAssistantWorkflow, listAssistantToolExecutions, linkAssistantWorkflowRun, startAssistantRun } from "@/lib/server/assistant-trace";
import { loadProductionProfile } from "@/lib/server/production-profile";
import { loadState } from "@/lib/server/state";
import { createCozteTools, cozteToolInputSchemas } from "@/lib/server/cozte-agent-tools";
import { buildCozteInstructions } from "@/lib/server/cozte-instructions";
import { loadCozteNotes } from "@/lib/server/cozte-notes";
import { cozteAgentSettings, cozteAssistantWorkflow } from "@/lib/server/cozte-workflow";
import { storeChatAttachments, type ChatAttachment } from "@/lib/server/documents";
import { loadChannels } from "@/lib/server/business";
import { loadCozteSettings } from "@/lib/server/cozte-settings";
import { loadMemberName } from "@/lib/server/onboarding";
import { loadJourney } from "@/lib/server/journey";
import { loadPriceWatches } from "@/lib/server/market-prices";
import { COZTE_CHAT_PAGE_SIZE, COZTE_MODEL_HISTORY_MESSAGES, messageCreatedAt, modelHistory, modelWindow, withCreatedAt, withMessageTimes } from "@/lib/cozte-conversation-memory";
import { businessTimeZone } from "@/lib/business";
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

/** Files stay out of the stored conversation; a short note keeps the reference. */
function persistableMessage(message: UIMessage): UIMessage {
  if (message.role !== "user" || message.parts.some((part) => part.type === "text")) return message;
  const files = message.parts.filter((part): part is Extract<typeof part, { type: "file" }> => part.type === "file");
  return files.length ? { ...message, parts: [{ type: "text" as const, text: `Adjuntó ${files.map((file) => file.filename || (file.mediaType.startsWith("image/") ? "una imagen" : "un archivo")).join(", ")}.` }] } : message;
}

/** Tells the model which files it received and which ones it can attach, by number, to a purchase or sale. */
function withAttachmentNote(messages: ModelMessage[], attachments: ChatAttachment[]): ModelMessage[] {
  if (!attachments.length) return messages;
  const index = messages.findLastIndex((message) => message.role === "user");
  if (index < 0) return messages;
  const list = attachments.map((item) => `${item.ordinal}) ${item.filename}${item.documentId ? " (guardado: se puede adjuntar como comprobante)" : ""}`).join("; ");
  const note = { type: "text" as const, text: `[Archivos de este mensaje: ${list}. Para adjuntar uno a una compra o venta usa su número en "receipt".]` };
  const message = messages[index];
  const content = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }, note] : [...message.content, note];
  return messages.map((item, position) => position === index ? { ...item, content } as ModelMessage : item);
}

/** Past tool calls are replayed to the model; drop any that no longer match the current tool schemas. */
function replayableHistory(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.filter((part) => {
      if (!part.type.startsWith("tool-")) return true;
      const name = part.type.slice("tool-".length) as keyof typeof cozteToolInputSchemas;
      const schema = cozteToolInputSchemas[name];
      return Boolean(schema) && "input" in part && schema.safeParse(part.input).success && "state" in part && part.state === "output-available";
    }),
  })).filter((message) => message.parts.length > 0);
}

/** The chat loads in pages: the latest messages, and older ones (`?before=<message id>`) as the person scrolls up. */
export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal();
    const before = new URL(request.url).searchParams.get("before")?.slice(0, 100) || undefined;
    const { messages, hasMore } = await loadMessagePage(principal, { before, limit: COZTE_CHAT_PAGE_SIZE });
    const [toolExecutions, activeWorkflow] = await Promise.all([
      listAssistantToolExecutions(principal, messages.map((message) => message.id)),
      before ? Promise.resolve(null) : getActiveAssistantWorkflow(principal),
    ]);
    return Response.json({ messages, hasMore, toolExecutions, activeWorkflowRunId: activeWorkflow?.workflowRunId ?? null }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: Request) {
  let runId: string | null = null;
  try {
    const principal = await requirePrincipal();
    forbidAdminView(principal);
    if (!process.env.AI_GATEWAY_API_KEY) throw new ApiError(503, "Cozte AI aún no tiene configurada su clave de AI Gateway");
    if (Number(request.headers.get("content-length") ?? 0) > 17_000_000) throw new ApiError(413, "El mensaje o los archivos adjuntos superan el límite de tamaño");
    const { message } = incomingSchema.parse(await request.json());
    if (!message.parts.some((part) => part.type === "text") && !message.parts.some((part) => part.type === "file")) throw new ApiError(400, "Escribe un mensaje o adjunta una imagen");
    const [state, profileState, stored, notes, channels, cozteSettings, personName] = await Promise.all([loadState(principal), loadProductionProfile(principal), loadRecentMessages(principal, COZTE_MODEL_HISTORY_MESSAGES), loadCozteNotes(principal), loadChannels(principal).catch(() => []), loadCozteSettings(principal).catch(() => ({ level: null, board: [] })), loadMemberName(principal).catch(() => "")]);
    // Cozte reads the latest messages (the rest stay searchable with searchConversation).
    const previous = replayableHistory(modelWindow(stored));
    if (previous.at(-1)?.id === message.id) throw new ApiError(409, "Ese mensaje ya fue recibido");
    await reserveAssistantRequest(principal);
    const candidateRunId = crypto.randomUUID();
    const tools = createCozteTools(principal, candidateRunId);
    const receivedAt = new Date();
    const incoming: UIMessage = withCreatedAt({ id: message.id, role: "user", parts: message.parts }, receivedAt.toISOString());
    const validated = await validateUIMessages({ messages: [...previous, incoming], tools });
    const [journey, priceWatches] = await Promise.all([
      loadJourney(principal, state, { persist: false, level: cozteSettings.level }).catch((error) => { console.error("Journey lookup failed", error); return null; }),
      loadPriceWatches(principal, state).catch(() => []),
    ]);
    const instructions = buildCozteInstructions({ journey, priceWatches, state, notes, channels, level: cozteSettings.level, board: cozteSettings.board, legacyProfile: profileState.draft ?? profileState.confirmed, personName, now: receivedAt, lastMessageAt: messageCreatedAt(stored.findLast((item) => item.role === "user") ?? {}) });
    // Receipts and delivery notes sent in the chat are kept so Cozte can attach them to what they back.
    const files = message.parts.filter((part) => part.type === "file");
    const attachments = files.length ? await storeChatAttachments(principal, candidateRunId, files) : [];
    // The stored conversation keeps everything for the UI; the model only sees what it can trust.
    const timed = withMessageTimes(modelHistory(validated.map((item) => item.id === incoming.id ? incoming : previous.find((saved) => saved.id === item.id) ?? item)), businessTimeZone(state.organization));
    const modelMessages = withAttachmentNote(prepareCozteModelMessages(await convertToModelMessages(timed)), attachments);
    const safeMessages = [...previous, persistableMessage(incoming)];
    const agentSettings = cozteAgentSettings();
    const settings = { ...agentSettings, provider: "gateway", harness: "cozte-v2-verified", durable: true, attachmentsPersistedAs: "workflow input only; files are excluded from conversation and tool trace" };
    runId = candidateRunId;
    await startAssistantRun(principal, runId, message.id, settings, { messageId: message.id, parts: message.parts.map((part) => part.type === "file" ? { type: "file", filename: part.filename, mediaType: part.mediaType, bytesApprox: attachmentBytes(part.url) } : part) });
    await saveMessages(principal, [persistableMessage(incoming)]);
    const workflowRun = await start(cozteAssistantWorkflow, [{ principal, runId, instructions, messages: modelMessages, persistedMessages: safeMessages, settings: agentSettings, level: cozteSettings.level ?? "simple" }]);
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
