"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import { isToolUIPart, type UIMessage } from "ai";
import { toast } from "sonner";
import type { AssistantProposal } from "@/lib/server/assistant-proposals";
import type { AssistantDataSource } from "@/lib/server/assistant-trace";
import type { ProposalSection } from "@/lib/proposal-presentation";
import { assistantToolOutcome } from "@/lib/assistant-run-activity";
import { COZTE_COST_WRITE_TOOLS, COZTE_TOOL_LABELS, cozteToolSucceeded } from "@/lib/cozte-tool-catalog";
import { activityHeadline, answerTextIndexes, liveStatus, turnActivity, type ActivityItem, type ActivityPart } from "@/lib/cozte-turn-activity";
import { qualityChecks, type QualitySummary } from "@/lib/cozte-quality";
import { answered, formatCozteAnswers, parseCozteQuestions, type CozteQuestionAnswer, type CozteQuestionSet } from "@/lib/cozte-questions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from "@/components/ui/chat-container";
import { PromptInput, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { PromptSuggestion } from "@/components/ui/prompt-suggestion";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { AudioWaveform, useVoiceDictation } from "@/components/use-voice-dictation";
import { AnimatedIcon } from "@/components/animated-icon";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { PresentationCard } from "@/components/decks/presentation-card";
import { CozteVisual, CozteVisualProvider } from "@/components/cozte/cozte-visuals";
import { BoardPanel } from "@/components/cozte/board-panel";
import { CozteLiveStatus, StreamedAnswer } from "@/components/cozte/live-status";
import { DaySeparator, MessageTime, messageDay, scrollParent, useIsomorphicLayoutEffect } from "@/components/cozte/message-time";
import { messageCreatedAt, withCreatedAt } from "@/lib/cozte-conversation-memory";
import { DEFAULT_EXPLANATION_LEVEL, EXPLANATION_LEVELS, type ExplanationLevel } from "@/lib/cozte-levels";
import { cleanWidget, parseBoard, pinWidget, widgetKey, type BoardWidget, type WidgetSpec } from "@/lib/cozte-widgets";
import type { DomainState, ProductCost } from "@/lib/domain";
import { COZTE_ASSISTANT_ATTACHMENT_MEDIA_TYPES, COZTE_MAX_ATTACHMENT_COUNT, COZTE_MAX_IMAGE_COUNT, COZTE_MAX_PDF_BYTES, COZTE_MAX_SPREADSHEET_COUNT, COZTE_MAX_SPREADSHEET_BYTES, COZTE_MAX_TOTAL_ATTACHMENT_BYTES, COZTE_MAX_TOTAL_IMAGE_BYTES, getCozteAttachmentKind, getCozteAttachmentMaxBytes, getCozteAttachmentMediaType } from "@/lib/cozte-assistant-attachments";
import { cn } from "cn";

type PersistedToolExecution = { messageId: string; runId: string; toolCallId: string; toolName: string; status: "running" | "completed" | "failed" };
const ACTIVE_WORKFLOW_STORAGE_KEY = "cozte-active-workflow-run";
/** Longest silence tolerated while Cozte is working before the chat stops waiting (server marks turns stalled at 4 min). */
const CHAT_STALL_MS = 150_000;
const suggestions = [
  "Mapear mi producción",
  "Te paso el ticket de una compra",
  "¿Cómo vengo este mes?",
];

export function CozteAssistant({ demo, state, onDataChanged, pendingPrompt, onPromptSent, onOpenPresentation }: { demo: boolean; state: DomainState & { costs: ProductCost[] }; onDataChanged: () => Promise<void>; onOpenCosts?: () => void; pendingPrompt?: string | null; onPromptSent?: () => void; onOpenPresentation?: (id: string) => void }) {
  const [input, setInput] = React.useState("");
  const [attachments, setAttachments] = React.useState<File[]>([]);
  const [preparing, setPreparing] = React.useState(false);
  const [draggingFiles, setDraggingFiles] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const { voiceState, analyser, start: startDictation, pause: pauseDictation } = useVoiceDictation(setInput);
  const [proposals, setProposals] = React.useState<AssistantProposal[]>([]);
  const [, setDataSources] = React.useState<AssistantDataSource[]>([]);
  const [toolExecutions, setToolExecutions] = React.useState<PersistedToolExecution[]>([]);
  const [resumeExistingWorkflow, setResumeExistingWorkflow] = React.useState(false);
  const [mobilePanel, setMobilePanel] = React.useState<"chat" | "board">("chat");
  // How Cozte explains (null until the person chooses) and the board of pinned visuals next to the chat.
  const [level, setLevel] = React.useState<ExplanationLevel | null>(demo ? DEFAULT_EXPLANATION_LEVEL : null);
  const [board, setBoard] = React.useState<BoardWidget[]>(() => demo ? [{ id: "demo-month", kind: "month", addedBy: "user" }, { id: "demo-sales", kind: "sales-by-channel", addedBy: "user" }, { id: "demo-cost", kind: "unit-cost", addedBy: "user" }] : []);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [selectedProposalId, setSelectedProposalId] = React.useState<string | null>(null);
  const [adjustmentNote, setAdjustmentNote] = React.useState("");
  const [busyProposalId, setBusyProposalId] = React.useState<string | null>(null);
  const busyProposalIds = React.useRef(new Set<string>());
  const [loading, setLoading] = React.useState(!demo);
  // The chat loads its latest page; older ones come in as the person scrolls up.
  const [hasOlder, setHasOlder] = React.useState(false);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const topSentinel = React.useRef<HTMLDivElement>(null);
  const restoreScroll = React.useRef<{ element: HTMLElement; height: number; top: number } | null>(null);
  const olderRequest = React.useRef(false);
  const [, setProposalsLoading] = React.useState(!demo);
  const transport = React.useMemo(() => new WorkflowChatTransport<UIMessage>({
    api: "/api/assistant",
    maxConsecutiveErrors: 5,
    onChatSendMessage: (response) => {
      const workflowRunId = response.headers.get("x-workflow-run-id");
      if (workflowRunId) window.localStorage.setItem(ACTIVE_WORKFLOW_STORAGE_KEY, workflowRunId);
    },
    onChatEnd: () => {
      window.localStorage.removeItem(ACTIVE_WORKFLOW_STORAGE_KEY);
      setResumeExistingWorkflow(false);
    },
    prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages.at(-1) } }),
    prepareReconnectToStreamRequest: (options) => {
      const workflowRunId = window.localStorage.getItem(ACTIVE_WORKFLOW_STORAGE_KEY);
      if (!workflowRunId) throw new Error("No hay una ejecución activa de Cozte para reanudar");
      return { ...options, api: `/api/assistant/${encodeURIComponent(workflowRunId)}/stream` };
    },
  }), []);
  // Throttled updates: re-rendering on every streamed token froze the browser on long conversations.
  const { messages, setMessages, sendMessage: sendChatMessage, status, error, stop } = useChat<UIMessage>({ transport, resume: resumeExistingWorkflow, throttle: 50,
    onFinish: ({ message, isError, isAbort }) => {
      const finishedAt = new Date().toISOString();
      setMessages((current) => current.map((item) => item.id === message.id && !messageCreatedAt(item) ? withCreatedAt(item, finishedAt) : item));
      void loadProposals(true);
      if (message.parts.some((part) => isToolUIPart(part) && part.state === "output-available" && COZTE_COST_WRITE_TOOLS.has(part.type.slice("tool-".length)) && cozteToolSucceeded(part.output))) { void onDataChanged(); setRefreshKey((current) => current + 1); }
      if (message.parts.some((part) => (part.type === "tool-setExplanationLevel" || part.type === "tool-showVisual" || part.type === "tool-manageBoard") && "state" in part && part.state === "output-available")) void loadSettings();
      if (!isAbort && (isError || !message.parts.some((part) => part.type === "text" && part.text.trim()))) toast.error("Cozte no pudo completar esta respuesta. Tu mensaje quedó guardado; puedes reintentarlo.");
    },
    onError: () => toast.error("No se pudo conectar con Cozte. Revisa tu conexión y vuelve a intentar."),
  });

  function addAttachments(files: File[]) {
    const next = [...attachments];
    const keys = new Set(next.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    let totalBytes = next.reduce((total, file) => total + file.size, 0);
    let unsupported = false;
    let oversizedImage = false;
    let oversizedPdf = false;
    let oversizedSpreadsheet = false;
    let overImageLimit = false;
    let overSpreadsheetLimit = false;
    let overLimit = false;
    for (const file of files) {
      const kind = getCozteAttachmentKind(file);
      if (!kind) { unsupported = true; continue; }
      if (file.size > getCozteAttachmentMaxBytes(kind)) {
        if (kind === "image") oversizedImage = true;
        else if (kind === "pdf") oversizedPdf = true;
        else oversizedSpreadsheet = true;
        continue;
      }
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (keys.has(key)) continue;
      if (next.length >= COZTE_MAX_ATTACHMENT_COUNT || totalBytes + file.size > COZTE_MAX_TOTAL_ATTACHMENT_BYTES) { overLimit = true; continue; }
      if (kind === "image" && next.filter((item) => getCozteAttachmentKind(item) === "image").length >= COZTE_MAX_IMAGE_COUNT) { overImageLimit = true; continue; }
      if (kind === "image" && next.filter((item) => getCozteAttachmentKind(item) === "image").reduce((total, item) => total + item.size, 0) + file.size > COZTE_MAX_TOTAL_IMAGE_BYTES) { overImageLimit = true; continue; }
      if (kind === "spreadsheet" && next.filter((item) => getCozteAttachmentKind(item) === "spreadsheet").length >= COZTE_MAX_SPREADSHEET_COUNT) { overSpreadsheetLimit = true; continue; }
      next.push(file);
      keys.add(key);
      totalBytes += file.size;
    }
    setAttachments(next);
    const reasons = [
      unsupported ? "Se admiten imágenes PNG/JPG/WebP, PDF y Excel .xlsx." : "",
      oversizedImage ? "Cada imagen debe pesar hasta 2 MB." : "",
      oversizedPdf ? `Cada PDF debe pesar hasta ${COZTE_MAX_PDF_BYTES / 1_000_000} MB.` : "",
      oversizedSpreadsheet ? "Cada Excel debe pesar hasta 1 MB." : "",
      overImageLimit ? `Puedes adjuntar hasta ${COZTE_MAX_IMAGE_COUNT} imágenes y 8 MB de imágenes en total.` : "",
      overSpreadsheetLimit ? `Puedes adjuntar hasta ${COZTE_MAX_SPREADSHEET_COUNT} planillas Excel por mensaje.` : "",
      overLimit ? `Puedes adjuntar hasta ${COZTE_MAX_ATTACHMENT_COUNT} archivos y 12 MB en total.` : "",
    ].filter(Boolean);
    if (reasons.length) toast.error(reasons.join(" "));
  }

  function handleAttachmentPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(event.clipboardData.items);
    const files = Array.from(event.clipboardData.files);
    const clipboardFiles = files.length ? files : items.filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file): file is File => file !== null);
    if (!clipboardFiles.length) return;
    event.preventDefault();
    addAttachments(clipboardFiles);
  }

  async function loadSettings() {
    if (demo) return;
    try {
      const response = await fetch("/api/assistant/settings", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setLevel(EXPLANATION_LEVELS.some((item) => item.id === data.level) ? data.level : null);
      setBoard(parseBoard(data.board));
    } catch { /* The board and level are conveniences; the chat works without them. */ }
  }

  async function saveSettings(update: { level?: ExplanationLevel; board?: BoardWidget[] }) {
    if (update.level) setLevel(update.level);
    if (update.board) setBoard(update.board);
    if (demo) return;
    const response = await fetch("/api/assistant/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(update) }).catch(() => null);
    if (!response?.ok) toast.error("No se pudo guardar el cambio");
  }

  // Stable so memoized messages do not re-render when the board changes.
  const boardRef = React.useRef(board);
  React.useEffect(() => { boardRef.current = board; }, [board]);
  const pinVisual = React.useCallback((widget: WidgetSpec) => {
    const next = pinWidget(boardRef.current, { ...widget, addedBy: "user" });
    void saveSettings({ board: next });
    toast.success("Quedó fijo en tu tablero");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  const sendMessage = React.useCallback((message: { text: string; files?: FileList }) => sendChatMessage({ ...message, metadata: { createdAt: new Date().toISOString() } }), [sendChatMessage]);

  async function loadOlder() {
    const first = messages[0];
    if (demo || !hasOlder || olderRequest.current || !first) return;
    olderRequest.current = true;
    setLoadingOlder(true);
    try {
      const response = await fetch(`/api/assistant?before=${encodeURIComponent(first.id)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudieron cargar los mensajes anteriores");
      const older = Array.isArray(data.messages) ? data.messages as UIMessage[] : [];
      // Keep the messages on screen where they are while older ones are added above.
      const scroller = scrollParent(topSentinel.current);
      if (scroller) restoreScroll.current = { element: scroller, height: scroller.scrollHeight, top: scroller.scrollTop };
      setMessages((current) => { const ids = new Set(current.map((item) => item.id)); return [...older.filter((item) => !ids.has(item.id)), ...current]; });
      if (Array.isArray(data.toolExecutions)) setToolExecutions((current) => [...data.toolExecutions, ...current]);
      setHasOlder(Boolean(data.hasMore));
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se pudieron cargar los mensajes anteriores"); }
    finally { olderRequest.current = false; setLoadingOlder(false); }
  }
  useIsomorphicLayoutEffect(() => {
    const saved = restoreScroll.current;
    if (!saved) return;
    restoreScroll.current = null;
    saved.element.scrollTop = saved.element.scrollHeight - saved.height + saved.top;
  }, [messages]);
  // Reaching the top of the chat loads the previous page.
  const loadOlderRef = React.useRef(loadOlder);
  React.useEffect(() => { loadOlderRef.current = loadOlder; });
  React.useEffect(() => {
    const target = topSentinel.current;
    if (!target || !hasOlder || loadingOlder) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void loadOlderRef.current(); }, { root: scrollParent(target), rootMargin: "240px 0px 0px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasOlder, loadingOlder, messages.length]);
  // A separator goes before the first message of each day.
  const dayStarts = React.useMemo(() => {
    const starts = new Set<string>();
    let previous: string | null = null;
    for (const message of messages) {
      const createdAt = messageCreatedAt(message);
      if (!createdAt) continue;
      if (previous === null || messageDay(previous) !== messageDay(createdAt)) starts.add(message.id);
      previous = createdAt;
    }
    return starts;
  }, [messages]);

  // Which visuals are already on the board, so a chat card says so instead of offering to pin it again.
  const pinnedKeys = React.useMemo(() => board.map(widgetKey).join("\n"), [board]);

  async function startNewConversation() {
    setConfirmReset(false);
    if (demo) { setMessages([]); return; }
    try {
      const response = await fetch("/api/assistant/settings", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo empezar una conversación nueva");
      setMessages([]);
      setToolExecutions([]);
      setHasOlder(false);
      toast.success("Conversación nueva. La anterior quedó archivada; tus datos y notas siguen guardados.");
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se pudo empezar una conversación nueva"); }
  }

  async function loadProposals(silent = false) {
    if (demo) return;
    try {
      const response = await fetch("/api/assistant/proposals", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudieron cargar las propuestas");
      setProposals(Array.isArray(data.proposals) ? data.proposals as AssistantProposal[] : []);
      setDataSources(Array.isArray(data.sources) ? data.sources as AssistantDataSource[] : []);
    } catch (cause) {
      if (!silent) toast.error(cause instanceof Error ? cause.message : "No se pudieron cargar las propuestas");
    } finally { setProposalsLoading(false); }
  }

  // Watchdog: if a turn stops producing anything (e.g. the workflow queue is throttled), stop waiting
  // instead of showing "analizando" forever. The message is already saved and can be sent again.
  const lastChatActivity = React.useRef(0);
  React.useEffect(() => { lastChatActivity.current = Date.now(); }, [messages]);
  React.useEffect(() => {
    if (status !== "submitted" && status !== "streaming") return;
    lastChatActivity.current = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - lastChatActivity.current < CHAT_STALL_MS) return;
      window.clearInterval(timer);
      void stop();
      window.localStorage.removeItem(ACTIVE_WORKFLOW_STORAGE_KEY);
      setResumeExistingWorkflow(false);
      toast.error("Cozte no respondió a tiempo. Tu mensaje quedó guardado; puedes enviarlo de nuevo.");
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [status, stop]);

  React.useEffect(() => {
    if (demo) return;
    let active = true;
    void loadSettings();
    Promise.all([fetch("/api/assistant", { cache: "no-store" }), fetch("/api/assistant/proposals", { cache: "no-store" })]).then(async ([chatResponse, proposalResponse]) => {
      if (!chatResponse.ok || !proposalResponse.ok) throw new Error("No se pudo cargar Cozte");
      const [chat, proposalData] = await Promise.all([chatResponse.json(), proposalResponse.json()]);
      if (active) {
        setMessages(chat.messages ?? []);
        setHasOlder(Boolean(chat.hasMore));
        setToolExecutions(Array.isArray(chat.toolExecutions) ? chat.toolExecutions : []);
        setProposals(Array.isArray(proposalData.proposals) ? proposalData.proposals : []);
        setDataSources(Array.isArray(proposalData.sources) ? proposalData.sources : []);
        if (typeof chat.activeWorkflowRunId === "string" && chat.activeWorkflowRunId) {
          window.localStorage.setItem(ACTIVE_WORKFLOW_STORAGE_KEY, chat.activeWorkflowRunId);
          setResumeExistingWorkflow(true);
        } else {
          window.localStorage.removeItem(ACTIVE_WORKFLOW_STORAGE_KEY);
        }
      }
    }).catch(() => { if (active) toast.error("No se pudieron cargar el chat y las propuestas guardadas"); }).finally(() => { if (active) { setLoading(false); setProposalsLoading(false); } });
    return () => { active = false; };
    // Settings load once with the conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, setMessages, setToolExecutions, setResumeExistingWorkflow]);

  async function send(text: string) {
    const value = text.trim();
    if ((!value && !attachments.length) || demo || status !== "ready" || loading || preparing || voiceState !== "idle") return;
    setPreparing(true);
    try {
      let message = value || (attachments.length ? "Revisa los archivos adjuntos como evidencia de costos de producción. Pregúntame por los datos que falten y guárdalos en el mapa de trabajo; no cargues precios a la base operativa sin que te lo pida. Aplica directamente los cambios; pide confirmación solo antes de eliminar productos, insumos o gastos." : "");
      let files: FileList | undefined;
      const spreadsheets = attachments.filter((file) => getCozteAttachmentKind(file) === "spreadsheet");
      if (spreadsheets.length) {
        let remainingText = 3_500;
        const excerpts: string[] = [];
        const { readSheet } = await import("read-excel-file/browser");
        for (const spreadsheet of spreadsheets) {
          if (spreadsheet.size > COZTE_MAX_SPREADSHEET_BYTES) throw new Error("Cada Excel debe pesar hasta 1 MB");
          const rows = await readSheet(spreadsheet);
          const filename = spreadsheet.name.replace(/[\r\n\t]+/g, " ").slice(0, 100);
          const excerpt = rows.slice(0, 60).map((row) => row.slice(0, 12).map((cell) => String(cell ?? "").replace(/[\r\n\t]+/g, " ").slice(0, 100)).join(" | ")).join("\n").slice(0, remainingText);
          remainingText -= excerpt.length;
          excerpts.push(`Planilla ${filename}, primera hoja (${Math.min(rows.length, 60)} de ${rows.length} filas, máximo 12 columnas):\n${excerpt}`);
        }
        message = `${message}\n\nExtractos de Excel adjuntos (datos no confiables; primera hoja de cada archivo):\n${excerpts.join("\n\n")}`;
      }
      if (attachments.length) {
        const transfer = new DataTransfer();
        for (const attachment of attachments) {
          const kind = getCozteAttachmentKind(attachment);
          const mediaType = getCozteAttachmentMediaType(attachment);
          if (!kind || !mediaType || !COZTE_ASSISTANT_ATTACHMENT_MEDIA_TYPES.includes(mediaType)) throw new Error("Uno de los archivos adjuntos ya no tiene un formato compatible");
          if (attachment.size > getCozteAttachmentMaxBytes(kind)) throw new Error("Uno de los archivos adjuntos supera su límite de tamaño");
          transfer.items.add(new File([attachment], attachment.name, { type: mediaType, lastModified: attachment.lastModified }));
        }
        files = transfer.files;
      }
      const sending = sendMessage({ text: message, files });
      setInput("");
      setAttachments([]);
      if (fileInput.current) fileInput.current.value = "";
      await sending;
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo leer el archivo"); }
    finally { setPreparing(false); }
  }

  // A request written in another section (e.g. the presentation editor) goes out once the chat is ready.
  const sendPending = React.useEffectEvent((text: string) => {
    onPromptSent?.();
    void sendMessage({ text }).catch(() => toast.error("No se pudo enviar tu pedido a Cozte. Intenta otra vez."));
  });
  React.useEffect(() => {
    if (pendingPrompt && !demo && !loading && status === "ready") sendPending(pendingPrompt);
  }, [pendingPrompt, demo, loading, status]);

  // Only the latest reply can be answered, and only while Cozte is idle.
  const answerQuestions = React.useMemo(() => demo || status !== "ready" || loading ? undefined : (text: string) => {
    void sendMessage({ text }).catch(() => toast.error("No se pudieron enviar tus respuestas. Intenta otra vez."));
  }, [demo, status, loading, sendMessage]);

  async function decideProposal(proposal: AssistantProposal, decision: "approve" | "reject") {
    if (demo || status !== "ready" || busyProposalIds.current.has(proposal.id)) return;
    busyProposalIds.current.add(proposal.id);
    setBusyProposalId(proposal.id);
    try {
      const response = await fetch("/api/assistant/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposal.id, decision }) });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "La propuesta cambió. Actualicé su estado; vuelve a revisarla.");
      }
      await loadProposals(true);
      if (data.needsReview) {
        toast.message("La base de costos cambió. Actualicé la propuesta; revisa el impacto nuevo antes de aprobarla.");
        return;
      }
      if (decision === "approve") {
        await onDataChanged();
        toast.success(proposal.kind === "production-profile" ? "Mapa de producción confirmado y versionado" : isProductCreation(proposal.title) ? "Productos creados y costo guardado en el historial" : "Propuesta aplicada y guardada en el historial");
        void sendMessage({ text: proposal.kind === "production-profile"
          ? `Actualización automática: el equipo aprobó el mapa de producción “${proposal.title}”. Ya está confirmado y versionado. Incorpora esa decisión al contexto y continúa con el siguiente dato pendiente; no vuelvas a pedir aprobación para lo mismo.`
          : `Actualización automática: el equipo aprobó y aplicó “${proposal.title}”. Revisa la base vigente y continúa con el modelo actualizado; no vuelvas a pedir aprobación para el mismo cambio.` }).catch(() => toast.error("La decisión quedó registrada, pero Cozte no pudo recibir la actualización automática. Escríbele para continuar."));
      } else {
        toast.success("Propuesta descartada y registrada");
        void sendMessage({ text: `Actualización automática: el equipo descartó “${proposal.title}”. No apliques ese cambio. Continúa con la información vigente y pregunta solo si hace falta una alternativa.` }).catch(() => toast.error("La decisión quedó registrada, pero Cozte no pudo recibir la actualización automática. Escríbele para continuar."));
      }
    } catch (cause) {
      await loadProposals(true);
      toast.error(cause instanceof Error ? cause.message : "No se pudo actualizar la propuesta");
    }
    finally { busyProposalIds.current.delete(proposal.id); setBusyProposalId(null); }
  }

  async function requestProposalChanges(proposal: AssistantProposal) {
    const note = adjustmentNote.trim();
    if (demo || status !== "ready" || note.length < 3 || busyProposalIds.current.has(proposal.id)) return;
    busyProposalIds.current.add(proposal.id);
    setBusyProposalId(proposal.id);
    try {
      const response = await fetch("/api/assistant/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposal.id, decision: "request-changes", note }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudieron registrar los ajustes");
      await loadProposals(true);
      setSelectedProposalId(null);
      setAdjustmentNote("");
      setMobilePanel("chat");
      void sendMessage({ text: `Actualización automática: el equipo pidió ajustar “${proposal.title}”. Cambios solicitados: ${note}. Revisa el contexto, actualiza los datos y explica el nuevo impacto. No apliques ni vuelvas a proponer la versión anterior.` }).catch(() => toast.error("Los ajustes quedaron registrados, pero Cozte no pudo recibir la actualización automática."));
      toast.success("Ajustes registrados y enviados a Cozte");
    } catch (cause) {
      await loadProposals(true);
      toast.error(cause instanceof Error ? cause.message : "No se pudieron registrar los ajustes");
    } finally { busyProposalIds.current.delete(proposal.id); setBusyProposalId(null); }
  }

  function openChatTurn(messageId: string) {
    setSelectedProposalId(null);
    setMobilePanel("chat");
    window.setTimeout(() => document.getElementById(`cozte-message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }

  const pendingProposals = proposals.filter((proposal) => proposal.status === "pending");
  const selectedProposal = proposals.find((proposal) => proposal.id === selectedProposalId) ?? null;
  const canApprove = (proposal: AssistantProposal) => proposal.status === "pending" && !(proposal.details.blockers?.length);
  const latestUserMessageIndex = messages.findLastIndex((message) => message.role === "user");
  const latestUserMessageId = latestUserMessageIndex >= 0 ? messages[latestUserMessageIndex]?.id ?? null : null;
  const currentTurnProposals = latestUserMessageId ? proposals.filter((proposal) => proposal.status === "pending" && proposal.sourceMessageId === latestUserMessageId) : [];
  const proposalsAfterMessage = new Map<string, AssistantProposal[]>();
  if (latestUserMessageId) {
    const latestAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant" && messages.findIndex((item) => item.id === message.id) > latestUserMessageIndex);
    if (latestAssistantMessage && currentTurnProposals.length) proposalsAfterMessage.set(latestAssistantMessage.id, currentTurnProposals);
  }
  // Keyed on message ids, not contents, so persisted executions keep their identity while a reply streams.
  const messageOrderKey = messages.map((message) => `${message.role}:${message.id}`).join("|");
  const toolsByAssistantMessage = React.useMemo(() => {
    const map = new Map<string, PersistedToolExecution[]>();
    let toolTurnUserMessageId: string | null = null;
    for (const entry of messageOrderKey.split("|")) {
      const [role, id] = [entry.slice(0, entry.indexOf(":")), entry.slice(entry.indexOf(":") + 1)];
      if (role === "user") toolTurnUserMessageId = id;
      if (role === "assistant" && toolTurnUserMessageId) {
        const turnId = toolTurnUserMessageId;
        const executions = toolExecutions.filter((execution) => execution.messageId === turnId);
        if (executions.length) map.set(id, executions);
      }
    }
    return map;
  }, [messageOrderKey, toolExecutions]);
  return <CozteVisualProvider state={state} demo={demo} refreshKey={refreshKey}>
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Cozte AI</h1>
        <div className="flex flex-wrap items-center gap-2">
          {pendingProposals.length ? <Badge variant="outline">{pendingProposals.length} por confirmar</Badge> : null}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">Cómo te explica
            <Dropdown aria-label="Nivel de explicación de Cozte" value={level ?? ""} onChange={(event) => void saveSettings({ level: event.target.value as ExplanationLevel })}>
              {level === null ? <DropdownOption value="" disabled>Elegir</DropdownOption> : null}
              {EXPLANATION_LEVELS.map((item) => <DropdownOption key={item.id} value={item.id}>{item.label}</DropdownOption>)}
            </Dropdown>
          </label>
          <Button type="button" size="sm" variant="outline" disabled={status !== "ready" || !messages.length} onClick={() => setConfirmReset(true)}><AnimatedIcon name="refresh" data-icon="inline-start" />Nueva conversación</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 lg:hidden" role="tablist" aria-label="Secciones de Cozte">
        <button id="cozte-chat-tab" type="button" role="tab" aria-selected={mobilePanel === "chat"} aria-controls="cozte-chat-panel" onClick={() => setMobilePanel("chat")} className={cn("rounded-md px-3 py-2 text-sm font-medium transition-colors", mobilePanel === "chat" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>Chat</button>
        <button id="cozte-board-tab" type="button" role="tab" aria-selected={mobilePanel === "board"} aria-controls="cozte-board-panel" onClick={() => setMobilePanel("board")} className={cn("flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors", mobilePanel === "board" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>Tablero{board.length ? <Badge variant="secondary">{board.length}</Badge> : null}</button>
      </div>

      <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section id="cozte-chat-panel" role="tabpanel" aria-labelledby="cozte-chat-tab" aria-label="Chat con Cozte" className={cn("min-w-0", mobilePanel === "chat" ? "flex" : "hidden lg:flex")}>
          <Card className="flex h-[calc(100dvh-13rem)] min-h-[30rem] w-full min-w-0 flex-col gap-0 overflow-hidden py-0 lg:h-[calc(100dvh-11rem)]">
            <CardContent className="flex min-h-0 flex-1 flex-col px-4 py-5 md:px-8"><ChatContainerRoot className="min-h-0 flex-1" aria-live="polite"><ChatContainerContent className="mx-auto min-h-full w-full max-w-4xl gap-4">
              {!messages.length ? <Empty className="my-auto"><EmptyHeader><EmptyMedia variant="icon"><AnimatedIcon name="sparkles" size={24} /></EmptyMedia><EmptyTitle>{state.products.length ? "¿En qué te ayudo hoy?" : "Empecemos por tu producción"}</EmptyTitle><EmptyDescription>{state.products.length ? "Pregúntame por tus costos, mándame un ticket o una venta, o pídeme un gráfico." : "¿Qué productos terminados y empacados fabrican, dónde y cómo?"}</EmptyDescription></EmptyHeader>
                {level === null && !demo ? <div className="flex w-full max-w-xl flex-col gap-2"><p className="text-sm font-medium">¿Cómo prefieres que te explique?</p><div className="grid gap-2 sm:grid-cols-3">{EXPLANATION_LEVELS.map((item) => <button key={item.id} type="button" onClick={() => void saveSettings({ level: item.id })} className="flex flex-col gap-1 rounded-lg border bg-background p-3 text-left text-sm transition-colors hover:bg-muted"><span className="font-medium">{item.label}</span><span className="text-xs text-muted-foreground">{item.hint}</span></button>)}</div><p className="text-xs text-muted-foreground">Puedes cambiarlo cuando quieras arriba.</p></div> : null}
              </Empty> : null}
              {messages.length ? <div ref={topSentinel} className="flex justify-center py-1 text-[11px] text-muted-foreground">
                {loadingOlder ? <TextShimmer className="text-xs">Cargando mensajes anteriores…</TextShimmer> : hasOlder ? <button type="button" className="rounded-full px-2 py-0.5 hover:bg-muted" onClick={() => void loadOlder()}>Ver mensajes anteriores</button> : <span>Inicio de la conversación</span>}
              </div> : null}
              {messages.map((message) => <React.Fragment key={message.id}>
                {dayStarts.has(message.id) ? <DaySeparator iso={messageCreatedAt(message)!} /> : null}
                <ChatMessageBubble message={message} persisted={toolsByAssistantMessage.get(message.id)} streaming={status === "streaming" && message.id === messages.at(-1)?.id} onAnswer={message.id === messages.at(-1)?.id ? answerQuestions : undefined} onPinVisual={pinVisual} pinnedKeys={pinnedKeys} onOpenPresentation={onOpenPresentation} />
                {(proposalsAfterMessage.get(message.id) ?? []).map((proposal) => <ProposalTurnCard key={proposal.id} proposal={proposal} onOpen={() => setSelectedProposalId(proposal.id)} />)}
              </React.Fragment>)}
              {status === "submitted" ? <div className="flex max-w-[94%] flex-col gap-2 rounded-xl bg-muted px-4 py-3 text-sm"><span className="text-xs font-semibold">Cozte</span><CozteLiveStatus status={liveStatus([])} /></div> : null}
              <ChatContainerScrollAnchor />
            </ChatContainerContent></ChatContainerRoot></CardContent>
            <CardFooter className="flex flex-col items-stretch gap-3 border-t px-4 py-4 md:px-8">
              {error ? <Alert variant="destructive"><AlertTitle>No se pudo completar la respuesta</AlertTitle><AlertDescription>{error.message || "Intenta otra vez."}</AlertDescription></Alert> : null}
              {!messages.length ? <div className="flex flex-wrap gap-2">{suggestions.map((item) => <PromptSuggestion key={item} size="sm" disabled={demo || loading} onClick={() => send(item)}>{item}</PromptSuggestion>)}</div> : null}
              {demo ? <Button render={<Link href="/sign-up" />} nativeButton={false}>Crear cuenta para conversar</Button> : <form className="mx-auto w-full max-w-4xl" onSubmit={(event) => { event.preventDefault(); void send(input); }}>
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp,application/pdf,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx" multiple className="sr-only" aria-label="Adjuntar imágenes, PDF o Excel" onChange={(event) => {
                  if (event.target.files?.length) addAttachments(Array.from(event.target.files));
                  event.target.value = "";
                }} />
                {attachments.length ? <div className="mb-2 flex flex-wrap gap-2" aria-label="Archivos adjuntos">
                  {attachments.map((attachment) => <span key={`${attachment.name}:${attachment.size}:${attachment.lastModified}`} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2 text-xs">
                    <Badge variant="secondary" className="px-1.5">{getCozteAttachmentKind(attachment) === "image" ? "Imagen" : getCozteAttachmentKind(attachment) === "pdf" ? "PDF" : "Excel"}</Badge><span className="max-w-56 truncate">{attachment.name}</span><span className="shrink-0 text-muted-foreground">{Math.max(1, Math.round(attachment.size / 1024))} KB</span>
                    <Button type="button" size="icon-xs" variant="ghost" aria-label={`Quitar ${attachment.name}`} onClick={() => setAttachments((current) => current.filter((file) => file !== attachment))}><AnimatedIcon name="close" size={14} /></Button>
                  </span>)}
                </div> : null}
                <PromptInput value={input} onValueChange={setInput} onSubmit={() => void send(input)} isLoading={status !== "ready" || preparing} disabled={loading}
                  className={cn("relative transition-colors", draggingFiles && "border-primary bg-primary/5 ring-2 ring-primary/20")}
                  onDragEnter={(event) => { if (!Array.from(event.dataTransfer.types).includes("Files")) return; event.preventDefault(); setDraggingFiles(true); }}
                  onDragOver={(event) => { if (!Array.from(event.dataTransfer.types).includes("Files")) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDraggingFiles(true); }}
                  onDragLeave={(event) => { if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return; setDraggingFiles(false); }}
                  onDrop={(event) => { if (!Array.from(event.dataTransfer.types).includes("Files")) return; event.preventDefault(); setDraggingFiles(false); addAttachments(Array.from(event.dataTransfer.files)); }}>
                  {draggingFiles ? <div className="pointer-events-none absolute inset-x-3 top-2 z-10 rounded-lg border border-dashed border-primary bg-background/95 px-3 py-2 text-center text-sm font-medium text-primary">Suelta los archivos para adjuntarlos</div> : null}
                  <PromptInputTextarea id="cozte-message" aria-label="Mensaje a Cozte" maxLength={2000} placeholder="Cuéntame qué producen o qué cambió…" onPaste={handleAttachmentPaste} />
                  <PromptInputActions className="justify-between">
                    <span className="px-2 text-xs text-muted-foreground">Pega o arrastra tickets, remitos, PDF o Excel · Cozte los guarda como comprobantes · hasta {COZTE_MAX_ATTACHMENT_COUNT}</span>
                    <div className="flex items-center gap-2">
                      <Button type="button" size="icon-sm" variant="ghost" aria-label="Adjuntar imágenes, PDF o Excel" title="Adjuntar archivos" onClick={() => fileInput.current?.click()}><AnimatedIcon name="attach" /></Button>
                      {voiceState === "idle" ? <Button type="button" size="icon-sm" variant="ghost" aria-label="Dictar mensaje" title="Dictar mensaje" onClick={() => void startDictation()}><AnimatedIcon name="mic" /></Button> : <div className="flex items-center gap-2" role="status" aria-label={voiceState === "listening" ? "Escuchando el micrófono" : voiceState === "starting" ? "Activando micrófono" : "Pausando dictado"}>{voiceState === "listening" ? <AudioWaveform analyser={analyser} /> : null}<span className="hidden text-xs text-muted-foreground sm:inline">{voiceState === "starting" ? "Activando…" : voiceState === "pausing" ? "Pausando…" : "Escuchando"}</span><Button type="button" size="sm" variant="outline" disabled={voiceState === "pausing"} onClick={pauseDictation}><AnimatedIcon name="pause" data-icon="inline-start" />{voiceState === "starting" ? "Cancelar" : "Pausar"}</Button></div>}
                      {status !== "ready" ? <Button type="button" variant="outline" onClick={stop}>Detener</Button> : null}
                      <Button type="submit" disabled={loading || preparing || status !== "ready" || voiceState !== "idle" || (!input.trim() && !attachments.length)}><AnimatedIcon name="send" data-icon="inline-start" />Enviar</Button>
                    </div>
                  </PromptInputActions>
                </PromptInput>
              </form>}
            </CardFooter>
          </Card>
        </section>

        <aside id="cozte-board-panel" role="tabpanel" aria-labelledby="cozte-board-tab" aria-label="Tu tablero" className={cn("min-w-0", mobilePanel === "board" ? "flex" : "hidden lg:flex")}>
          <BoardPanel board={board} onChange={(next) => void saveSettings({ board: next })} onAsk={demo ? undefined : (text) => { setMobilePanel("chat"); void send(text); }} />
        </aside>
      </div>
    </div>
    <Dialog open={confirmReset} onOpenChange={setConfirmReset}><DialogContent>
      <DialogHeader><DialogTitle>¿Empezar una conversación nueva?</DialogTitle><DialogDescription>La conversación actual queda archivada. Tus costos, compras, ventas y lo que Cozte anotó de tu empresa siguen guardados; solo el chat empieza de cero.</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={() => setConfirmReset(false)}>Cancelar</Button><Button onClick={() => void startNewConversation()}>Empezar de nuevo</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={selectedProposal !== null} onOpenChange={(open) => { if (!open) { setSelectedProposalId(null); setAdjustmentNote(""); } }}>
      <DialogContent className="max-h-[min(88dvh,52rem)] max-w-2xl overflow-y-auto">
        {selectedProposal ? <>
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2"><DialogTitle>{selectedProposal.title}</DialogTitle><ProposalStatusBadge status={selectedProposal.status} changeRequested={selectedProposal.changeRequest !== null} /></div>
            <DialogDescription>{selectedProposal.summary}</DialogDescription>
          </DialogHeader>
          {selectedProposal.status === "stale" ? <Alert variant="destructive"><AlertTitle>{selectedProposal.changeRequest ? "Ajustes solicitados" : "Necesita actualización antes de aplicarse"}</AlertTitle><AlertDescription>{selectedProposal.changeRequest ?? selectedProposal.decisionNote ?? "La base cambió desde que se preparó. Pídele a Cozte que actualice esta propuesta."}</AlertDescription></Alert> : null}
          {selectedProposal.details.blockers?.length ? <Alert variant="destructive"><AlertTitle>No se puede aprobar todavía</AlertTitle><AlertDescription>{selectedProposal.details.blockers.join(" · ")}</AlertDescription></Alert> : null}
          {selectedProposal.status === "approved" ? <ProposalResult title={selectedProposal.title} result={selectedProposal.result} /> : null}
          <div className="flex flex-col gap-4">
            {selectedProposal.details.sections.map((section) => <ProposalDetailSection key={section.title} section={section} />)}
            {selectedProposal.sources.length ? <section className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3" aria-label="Fuentes de datos de esta propuesta"><h3 className="text-sm font-semibold">Fuentes de datos</h3><ul className="flex flex-col gap-2">{selectedProposal.sources.map((source) => <li key={source.id} className="flex flex-col gap-1 rounded-md bg-background px-3 py-2 text-sm"><strong className="break-all">{source.label}</strong><span className="text-xs text-muted-foreground">{dataSourceKindLabel(source.kind)}{source.mediaType ? ` · ${source.mediaType}` : ""}</span></li>)}</ul></section> : selectedProposal.sourceMessageId ? <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">Preparada a partir del turno correspondiente en la conversación.</p> : null}
            {selectedProposal.sourceMessageId ? <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => openChatTurn(selectedProposal.sourceMessageId!)}>Ver el turno que la originó</Button> : null}
            <section className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3" aria-label="Registro de auditoría">
              <h3 className="text-sm font-semibold">Registro</h3>
              <p className="text-xs text-muted-foreground">Creada {formatProposalDate(selectedProposal.createdAt)} · revisión base {selectedProposal.baseOrganizationRevision}{selectedProposal.baseProfileRevision !== null ? ` · perfil ${selectedProposal.baseProfileRevision}` : ""}</p>
              {selectedProposal.history.length ? <ol className="flex flex-col gap-2">{selectedProposal.history.map((event) => <li key={event.id} className="flex flex-col gap-1 border-t pt-2 text-sm"><div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><span className="font-medium">{proposalEventLabel(event.type, event)} <span className="font-normal text-muted-foreground">· {proposalEventActor(event)}</span></span><time className="text-xs text-muted-foreground" dateTime={event.createdAt}>{formatProposalDate(event.createdAt)}</time></div>{proposalEventReason(event) ? <p className="text-xs text-muted-foreground">{proposalEventReason(event)}</p> : null}</li>)}</ol> : <p className="text-xs text-muted-foreground">No hay otros eventos registrados.</p>}
            </section>
          </div>
          {selectedProposal.status === "pending" ? <section className="flex flex-col gap-2 rounded-lg border p-3" aria-label="Solicitar cambios"><label htmlFor="cozte-adjustment-note" className="text-sm font-semibold">¿Qué habría que cambiar?</label><p className="text-xs text-muted-foreground">Cozte recibirá la decisión y el detalle para preparar la versión ajustada.</p><Textarea id="cozte-adjustment-note" value={adjustmentNote} maxLength={500} onChange={(event) => setAdjustmentNote(event.target.value)} placeholder="Ej. Repartir electricidad por horas de uso, no por unidades…" /><Button type="button" size="sm" variant="outline" className="self-start" disabled={adjustmentNote.trim().length < 3 || busyProposalId !== null || status !== "ready"} onClick={() => void requestProposalChanges(selectedProposal)}>{busyProposalId === selectedProposal.id ? "Registrando…" : "Solicitar ajustes"}</Button></section> : null}
          {selectedProposal.status === "pending" ? <DialogFooter>
            <Button variant="outline" disabled={busyProposalId !== null || status !== "ready"} onClick={() => void decideProposal(selectedProposal, "reject")}>{busyProposalId === selectedProposal.id ? "Guardando…" : "Descartar propuesta"}</Button>
            <Button disabled={!canApprove(selectedProposal) || busyProposalId !== null || status !== "ready"} onClick={() => void decideProposal(selectedProposal, "approve")}><AnimatedIcon name="check" data-icon="inline-start" />{busyProposalId === selectedProposal.id ? "Guardando…" : selectedProposal.kind === "production-profile" ? "Aprobar mapa" : isProductCreation(selectedProposal.title) ? "Aprobar y crear" : "Aprobar y aplicar"}</Button>
          </DialogFooter> : null}
        </> : null}
      </DialogContent>
    </Dialog>
  </CozteVisualProvider>;
}

function ProposalTurnCard({ proposal, onOpen }: { proposal: AssistantProposal; onOpen: () => void }) {
  return <Card size="sm" className="w-full max-w-4xl self-center">
    <CardContent className="flex flex-col gap-2 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium text-muted-foreground">Propuesta de este turno</span><ProposalStatusBadge status={proposal.status} changeRequested={proposal.changeRequest !== null} /></div>
      <strong>{proposal.title}</strong>
      <p className="text-xs text-muted-foreground">{proposal.summary}</p>
      {proposal.sources.length ? <p className="text-xs text-muted-foreground">Fuentes: {proposal.sources.map((source) => source.label).join(", ")}</p> : null}
      <Button type="button" size="sm" variant="outline" className="self-start" onClick={onOpen}>Ver propuesta y decisión</Button>
    </CardContent>
  </Card>;
}

const noExecutions: PersistedToolExecution[] = [];

const DECK_TOOLS = new Set(["tool-createPresentation", "tool-editPresentation", "tool-sharePresentation"]);

function presentationCards(parts: UIMessage["parts"]): Map<number, { id: string; revision: number }> {
  const last = new Map<string, { index: number; revision: number }>();
  parts.forEach((part, index) => {
    if (!DECK_TOOLS.has(part.type) || !("state" in part) || part.state !== "output-available" || !cozteToolSucceeded(part.output)) return;
    const output = part.output as { presentationId?: unknown; revision?: unknown };
    if (typeof output.presentationId === "string") last.set(output.presentationId, { index, revision: typeof output.revision === "number" ? output.revision : 0 });
  });
  return new Map([...last].map(([id, value]) => [value.index, { id, revision: value.revision }]));
}

/** One chat message. Memoized so only the reply that is streaming re-renders on each update. */
const ChatMessageBubble = React.memo(function ChatMessageBubble({ message, persisted = noExecutions, streaming, onAnswer, onPinVisual, pinnedKeys = "", onOpenPresentation }: { message: UIMessage; persisted?: PersistedToolExecution[]; streaming: boolean; onAnswer?: (text: string) => void; onPinVisual?: (widget: WidgetSpec) => void; pinnedKeys?: string; onOpenPresentation?: (id: string) => void }) {
  // A reply that finishes while on screen is written out; one loaded from history appears whole.
  const [wasStreaming, setWasStreaming] = React.useState(streaming);
  const [reveal, setReveal] = React.useState(false);
  if (wasStreaming !== streaming) {
    setWasStreaming(streaming);
    if (!streaming) setReveal(true);
  }
  const answer = message.role === "assistant" ? answerTextIndexes(message.parts as ActivityPart[], streaming) : null;
  // One card per presentation, at the last tool call that touched it, so a deck edited several times shows once.
  const deckCards = message.role === "assistant" ? presentationCards(message.parts) : null;
  return<div id={`cozte-message-${message.id}`} data-message-id={message.id} className={message.role === "user" ? "ml-auto flex max-w-[88%] scroll-mt-6 flex-col gap-2 rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground" : "flex max-w-[94%] scroll-mt-6 flex-col gap-2 rounded-xl bg-muted px-4 py-3 text-sm"}>
    <span className="flex items-baseline gap-2 text-xs font-semibold">{message.role === "user" ? "Tú" : "Cozte"}{(() => {
      const createdAt = messageCreatedAt(message);
      return createdAt && !streaming ? <MessageTime iso={createdAt} className="text-[11px] font-normal tabular-nums opacity-70" /> : null;
    })()}</span>
    {message.role === "assistant" ? (() => {
      // Work (reasoning and tools) goes in one collapsed block above the answer, like a compact trace.
      const liveToolCallIds = new Set(message.parts.filter(isToolUIPart).map((part) => part.toolCallId));
      return <CozteTurnActivity parts={message.parts} persisted={persisted.filter((execution) => !liveToolCallIds.has(execution.toolCallId))} streaming={streaming} />;
    })() : null}
    {message.role === "assistant" && streaming ? <CozteLiveStatus status={liveStatus(message.parts as ActivityPart[])} /> : message.parts.map((part, index) => {
      // Only the final message is the answer; notes written before tools live in the collapsed trace.
      if (part.type === "text") return message.role === "assistant" ? answer?.has(index) ? <StreamedAnswer key={index} text={part.text} animate={reveal} /> : null : <p key={index} className="whitespace-pre-wrap leading-relaxed">{part.text}</p>;
      if (part.type === "file" && part.mediaType.startsWith("image/")) return <div key={index} className="flex flex-col items-start gap-1"><Image src={part.url} alt={part.filename ?? "Imagen adjunta"} width={320} height={224} unoptimized className="max-h-56 max-w-full rounded-md object-contain" /><span className="max-w-full truncate text-xs opacity-80">{part.filename ?? "Imagen adjunta"}</span></div>;
      if (part.type === "file" && part.mediaType === "application/pdf") return <Badge key={index} variant="outline">PDF · {part.filename ?? "Documento adjunto"}</Badge>;
      if (part.type === "file" && part.mediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return <Badge key={index} variant="outline">Excel · {part.filename ?? "Planilla adjunta"}</Badge>;
      // Visuals render live engine data, not numbers from the model.
      if (part.type === "tool-showVisual" && part.state === "output-available" && cozteToolSucceeded(part.output)) {
        const output = part.output as { visual?: unknown; productId?: string | null; month?: string | null; metrics?: unknown; title?: string };
        const widget = cleanWidget({ kind: output.visual, productId: output.productId, month: output.month, metrics: output.metrics, title: output.title, addedBy: "cozte" });
        if (!widget) return null;
        const pinned = pinnedKeys.split("\n").includes(widgetKey(widget));
        return <CozteVisual key={part.toolCallId} widget={widget} pinned={pinned} onPin={pinned || !onPinVisual ? undefined : () => onPinVisual(widget)} />;
      }
      if (deckCards?.has(index)) {
        const deck = deckCards.get(index)!;
        return <PresentationCard key={`deck-${deck.id}`} id={deck.id} revision={deck.revision} onOpen={onOpenPresentation} />;
      }
      if (part.type === "tool-askQuestions" && (part.state === "input-available" || part.state === "output-available")) {
        const set = parseCozteQuestions(part.input);
        return set ? <CozteQuestionForm key={part.toolCallId} set={set} onAnswer={onAnswer} /> : null;
      }
      return null;
    })}
  </div>;
});


/** Cozte's questions as a small form: pick options or write freely; the answers go back as one message. */
function CozteQuestionForm({ set, onAnswer }: { set: CozteQuestionSet; onAnswer?: (text: string) => void }) {
  const [answers, setAnswers] = React.useState<CozteQuestionAnswer[]>(() => set.questions.map(() => ({ choices: [], other: "" })));
  const [sent, setSent] = React.useState(false);
  const enabled = onAnswer !== undefined && !sent;
  const count = answers.filter(answered).length;
  const update = (index: number, change: (answer: CozteQuestionAnswer) => CozteQuestionAnswer) => setAnswers((current) => current.map((answer, position) => position === index ? change(answer) : answer));
  const toggle = (index: number, option: string, multiple: boolean) => update(index, (answer) => ({
    ...answer,
    choices: multiple ? answer.choices.includes(option) ? answer.choices.filter((choice) => choice !== option) : [...answer.choices, option] : answer.choices[0] === option ? [] : [option],
  }));
  return <form aria-label="Preguntas de Cozte" className={cn("flex flex-col gap-3 rounded-lg border bg-background p-3", !enabled && "opacity-75")} onSubmit={(event) => {
    event.preventDefault();
    if (!enabled || !count) return;
    setSent(true);
    onAnswer(formatCozteAnswers(set, answers));
  }}>
    {set.intro ? <p className="text-sm">{set.intro}</p> : null}
    {set.questions.map((question, index) => <fieldset key={index} disabled={!enabled} className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{question.question}{question.multiple ? <span className="ml-1 text-xs font-normal text-muted-foreground">(puedes elegir varias)</span> : null}</legend>
      {question.options.length ? <div role={question.multiple ? "group" : "radiogroup"} aria-label={question.question} className="flex flex-wrap gap-1.5">
        {question.options.map((option) => {
          const selected = answers[index].choices.includes(option);
          return <button key={option} type="button" role={question.multiple ? "checkbox" : "radio"} aria-checked={selected} onClick={() => toggle(index, option, question.multiple)}
            className={cn("rounded-full border px-3 py-1 text-left text-xs transition-colors disabled:cursor-not-allowed", selected ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>{option}</button>;
        })}
      </div> : null}
      <Input value={answers[index].other} maxLength={300} onChange={(event) => update(index, (answer) => ({ ...answer, other: event.target.value }))}
        placeholder={question.options.length ? "Otra respuesta o un detalle…" : "Tu respuesta…"} aria-label={`Respuesta libre: ${question.question}`} className="h-8 text-sm" />
    </fieldset>)}
    {enabled ? <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{count} de {set.questions.length} respondidas · también puedes contestar en el chat</span>
      <Button type="submit" size="sm" disabled={!count}><AnimatedIcon name="send" data-icon="inline-start" />Enviar respuestas</Button>
    </div> : sent ? <p className="text-xs text-muted-foreground">Respuestas enviadas.</p> : null}
  </form>;
}

function CozteTurnActivity({ parts, persisted, streaming }: { parts: UIMessage["parts"]; persisted: PersistedToolExecution[]; streaming: boolean }) {
  const items = turnActivity(parts as ActivityPart[], streaming);
  if (!items.length && !persisted.length) return null;
  const live = streaming && items.some((item) => item.kind === "tool" ? item.running : item.kind === "reasoning" && item.streaming);
  const failed = items.some((item) => item.kind === "tool" && item.failed);
  const pending = !failed && items.some((item) => item.kind === "tool" && item.needsInput);
  const headline = streaming ? `Ver lo que está haciendo · ${items.length} paso${items.length === 1 ? "" : "s"}` : items.length ? activityHeadline(items) : persisted.length === 1 ? "1 acción registrada" : `${persisted.length} acciones registradas`;
  return <details className="group/activity w-full max-w-full rounded-lg border bg-background/60 text-xs text-foreground">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <span aria-hidden="true" className="shrink-0 transition-transform group-open/activity:rotate-90">▸</span>
      <span className={cn("size-1.5 shrink-0 rounded-full", live ? "animate-pulse bg-primary" : failed ? "bg-destructive" : pending ? "bg-amber-500" : "bg-emerald-500")} aria-hidden="true" />
      <span className={cn("min-w-0 truncate", failed && !streaming && "text-destructive")}>{headline}</span>
    </summary>
    <ol className="flex flex-col gap-2 border-t px-3 py-2.5">
      {items.map((item, index) => item.kind === "reasoning" ? <li key={`reasoning-${index}`}><ActivityReasoning text={item.text} streaming={item.streaming} /></li>
        : item.kind === "note" ? <li key={`note-${index}`}><ActivityText label="Mientras trabajaba" text={item.text} /></li>
        : item.kind === "quality" ? <li key={`quality-${index}`}><ActivityQuality summary={item.summary} revised={item.revised} /></li>
        : item.kind === "discarded" ? <li key={`draft-${index}`}><ActivityText label="Borrador descartado" detail={item.reason} text={item.text} tone="warning" /></li>
        : <li key={item.toolCallId}><ActivityTool item={item} /></li>)}
      {persisted.map((execution) => <li key={`${execution.runId}:${execution.toolCallId}`}><AssistantMessageToolTag toolName={execution.toolName} persisted={execution} /></li>)}
    </ol>
  </details>;
}

function ActivityReasoning({ text, streaming }: { text: string; streaming: boolean }) {
  return <details className="group/reasoning">
    <summary className="flex cursor-pointer list-none items-start gap-2 text-muted-foreground [&::-webkit-details-marker]:hidden">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-[10px] transition-transform group-open/reasoning:rotate-90">▸</span>
      <span className="min-w-0"><span className="font-medium text-foreground/80">{streaming ? "Pensando" : "Cómo lo pensó"}</span> <span className="line-clamp-2 group-open/reasoning:hidden">{text}</span></span>
    </summary>
    <p className="mt-1 whitespace-pre-wrap pl-4 leading-relaxed text-muted-foreground">{text}</p>
  </details>;
}

/** Jev's review of the answer: five checks, and whether the answer was rewritten after it. */
function ActivityQuality({ summary, revised }: { summary: QualitySummary; revised: boolean }) {
  const checks = qualityChecks(summary);
  const failed = checks.filter((check) => !check.ok).length;
  return <div className="flex flex-col gap-1">
    <p className="flex items-center gap-2"><span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", failed ? "bg-amber-500" : "bg-emerald-500")} /><span className="font-medium text-foreground/80">{revised ? "Revisión de calidad de la versión final" : "Revisión de calidad"}</span></p>
    <ul className="flex flex-wrap gap-1 pl-3.5" aria-label="Revisión de calidad">
      {checks.map((check) => <li key={check.label} className={cn("rounded-full border px-2 py-0.5 text-[11px]", check.ok ? "text-muted-foreground" : "border-amber-500/50 text-amber-700 dark:text-amber-400")}>{check.ok ? "✓" : "✗"} {check.label}{check.value ? ` ${check.value}` : ""}</li>)}
    </ul>
  </div>;
}

/** A working note or a discarded draft: one clamped line in the trace, the full text on demand. */
function ActivityText({ label, detail, text, tone }: { label: string; detail?: string; text: string; tone?: "warning" }) {
  const plain = text.replace(/\*\*(.+?)\*\*/g, "$1");
  return <details className="group/text">
    <summary className="flex cursor-pointer list-none items-start gap-2 text-muted-foreground [&::-webkit-details-marker]:hidden">
      <span aria-hidden="true" className={cn("mt-1 size-1.5 shrink-0 rounded-full", tone === "warning" ? "bg-amber-500" : "bg-muted-foreground/50")} />
      <span className="min-w-0"><span className={cn("font-medium", tone === "warning" ? "text-amber-700 dark:text-amber-400" : "text-foreground/80")}>{label}</span>{detail ? <span> · {detail}</span> : null} <span className="line-clamp-2 group-open/text:hidden">{plain}</span></span>
    </summary>
    <p className="mt-1 whitespace-pre-wrap pl-3.5 leading-relaxed text-muted-foreground">{plain}</p>
  </details>;
}

function ActivityTool({ item }:{ item: Extract<ActivityItem, { kind: "tool" }> }) {
  return <details className="group/tool">
    <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
      <span aria-hidden="true" className={cn("mt-1 size-1.5 shrink-0 rounded-full", item.running ? "animate-pulse bg-primary" : item.failed ? "bg-destructive" : item.needsInput ? "bg-amber-500" : "bg-emerald-500")} />
      <span className="min-w-0"><span className="font-medium">{item.label}</span> <span className={cn("text-muted-foreground", item.failed && "text-destructive")}>{item.running ? <TextShimmer>{item.summary}</TextShimmer> : item.summary}</span></span>
    </summary>
    {!item.running ? <div className="mt-1.5 flex max-h-[min(18rem,45vh)] flex-col gap-2 overflow-auto pl-3.5">
      {item.input !== undefined ? <AssistantToolPayload title="Datos que usó" value={item.input} /> : null}
      {item.output !== undefined ? <AssistantToolPayload title="Resultado" value={item.output} /> : null}
      {item.errorText ? <AssistantToolPayload title="Qué pasó" value={item.errorText} /> : null}
    </div> : null}
  </details>;
}

function AssistantMessageToolTag({ toolName, input, output, errorText, persisted, onEdit }: { toolName: string; input?: unknown; output?: unknown; errorText?: string; persisted?: PersistedToolExecution; onEdit?: (prompt: string) => void }) {
  const [details, setDetails] = React.useState<{ input?: unknown; output?: unknown; durationMs?: number; error?: string } | null>(null);
  const [loadingDetails, setLoadingDetails] = React.useState(false);
  const [detailsError, setDetailsError] = React.useState<string | null>(null);
  const detailsRequest = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => detailsRequest.current?.abort(), []);
  function loadDetails() {
    if (!persisted || details || loadingDetails || detailsRequest.current) return;
    const controller = new AbortController();
    detailsRequest.current = controller;
    setLoadingDetails(true);
    setDetailsError(null);
    fetch(`/api/assistant/runs?id=${encodeURIComponent(persisted.runId)}&toolCallId=${encodeURIComponent(persisted.toolCallId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "No se pudieron cargar los detalles de esta herramienta");
        setDetails(data);
      })
      .catch((cause) => { if (!controller.signal.aborted) setDetailsError(cause instanceof Error ? cause.message : "No se pudieron cargar los detalles"); })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingDetails(false);
        if (detailsRequest.current === controller) detailsRequest.current = null;
      });
  }
  const resolvedInput = persisted ? details?.input : input;
  const resolvedOutput = persisted ? details?.output : output;
  const resolvedError = errorText ?? details?.error;
  const outcome = persisted ? persisted.status === "failed" ? "No se completó" : persisted.status === "running" ? "En curso" : "Ejecución guardada" : errorText ?? assistantToolOutcome(output);
  const failed = persisted?.status === "failed" || !!resolvedError || outcome.startsWith("Error:") || outcome.startsWith("No se completó:");
  return <details className="group w-fit max-w-full rounded-md border bg-background/70 text-foreground" onToggle={(event) => { if (event.currentTarget.open) loadDetails(); }}>
    <summary className="flex max-w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span aria-hidden="true" className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90">▸</span>
      <Badge variant={failed ? "destructive" : "outline"} className="shrink-0">{assistantToolLabel(toolName)}</Badge>
      <span className="min-w-0 truncate text-muted-foreground">{failed ? "Falló" : outcome}</span>
    </summary>
    <div className="flex max-h-[min(20rem,50vh)] max-w-[min(32rem,80vw)] flex-col gap-2 overflow-auto border-t p-2.5">
      {loadingDetails ? <p className="text-xs text-muted-foreground">Cargando los datos de la ejecución…</p> : null}
      {detailsError ? <p className="text-xs text-destructive">{detailsError}</p> : null}
      {resolvedError ? <AssistantToolPayload title="Qué pasó" value={resolvedError} /> : null}
      {resolvedInput !== undefined ? <AssistantToolPayload title="Datos que usó Cozte" value={resolvedInput} /> : !loadingDetails ? <p className="text-xs text-muted-foreground">No quedaron datos de entrada registrados.</p> : null}
      {resolvedOutput !== undefined ? <AssistantToolPayload title="Resultado" value={resolvedOutput} /> : persisted?.status === "running" ? <p className="text-xs text-muted-foreground">Esta herramienta todavía está trabajando.</p> : !loadingDetails ? <p className="text-xs text-muted-foreground">No quedó un resultado para mostrar.</p> : null}
      {details?.durationMs !== undefined ? <p className="text-[11px] text-muted-foreground">Duración: {(details.durationMs / 1000).toFixed(1)} s</p> : null}
      {onEdit && resolvedInput !== undefined ? <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => onEdit(buildActionEditPrompt(toolName, resolvedInput, resolvedOutput))}>Ajustar con Cozte</Button> : null}
    </div>
  </details>;
}

function AssistantToolPayload({ title, value }: { title: string; value: unknown }) {
  const rows = toolPayloadRows(value);
  return <section className="flex flex-col gap-1">
    <h4 className="text-[11px] font-semibold text-muted-foreground">{title}</h4>
    {rows.length ? <dl className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-x-2 gap-y-1 rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed">{rows.map(([label, content], index) => <React.Fragment key={`${label}-${index}`}><dt className="text-muted-foreground">{label}</dt><dd className="break-words font-medium">{content}</dd></React.Fragment>)}</dl> : <p className="rounded-md bg-muted/50 p-2 text-[11px]">Sin datos adicionales.</p>}
  </section>;
}

function toolPayloadRows(value: unknown, prefix = "", depth = 0): [string, string][] {
  if (value === null || value === undefined) return prefix ? [[prefix, "Sin dato"]] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => toolPayloadRows(item, `${prefix ? `${prefix} · ` : ""}${Array.isArray(value) && value.length > 1 ? `Elemento ${index + 1}` : ""}`.trim(), depth + 1)).slice(0, 24);
  if (typeof value === "object") {
    const labels: Record<string, string> = { action: "Tipo de cambio", label: "Acción", brief: "Detalle", name: "Nombre", supplier: "Proveedor", purchaseUnit: "Unidad de compra", category: "Categoría", price: "Precio", amount: "Importe", currency: "Moneda", source: "Fuente", effectiveDate: "Fecha efectiva", period: "Período", allocationBasis: "Forma de reparto", basis: "Forma de reparto", shares: "Porcentajes acordados", products: "Productos", product: "Producto", productName: "Producto", materialName: "Insumo", expenseName: "Gasto", lotUnits: "Unidades por lote", salePrice: "Precio de venta por unidad", salesVariablePerUnit: "Gasto variable por unidad", laborCostPerLot: "Trabajo por lote", productionHoursPerLot: "Horas por lote", quantityMilli: "Cantidad por producto", quantityInPurchaseUnits: "Cantidad por producto", frequency: "Frecuencia", amountMinor: "Importe", monthlyMinor: "Equivalente mensual", directPerFinishedUnitMinor: "Costo directo por unidad", error: "Resultado" };
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
      if (["id", "materialId", "expenseId", "productId", "cloneProductId", "expectedRevision", "idempotencyKey"].includes(key) || item === undefined) return [];
      const label = labels[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toLocaleUpperCase());
      const translated = translateToolValue(key, item);
      if (translated !== null) return [[prefix ? `${prefix} · ${label}` : label, translated] as [string, string]];
      if (depth > 2) return [];
      return toolPayloadRows(item, prefix ? `${prefix} · ${label}` : label, depth + 1);
    }).slice(0, 24);
  }
  const label = prefix || "Dato";
  return [[label, String(value)]];
}

function translateToolValue(key: string, value: unknown): string | null {
  if (value === null) return "Sin dato";
  if (typeof value === "object") return null;
  if (key === "action" && typeof value === "string") {
    const actions: Record<string, string> = { "create-category": "Crear categoría", "rename-category": "Renombrar categoría", "create-material": "Crear insumo", "delete-material": "Eliminar insumo", "update-material-meta": "Editar datos del insumo", "create-expense": "Crear gasto", "update-expense-meta": "Editar datos del gasto", "update-expense-allocation": "Cambiar reparto del gasto", "set-component": "Actualizar consumo del producto", "create-product": "Crear producto", "create-products": "Crear productos", "update-product": "Editar producto", "delete-product": "Eliminar producto" };
    return actions[value] ?? value;
  }
  if (["allocationBasis", "basis"].includes(key) && typeof value === "string") return ({ hours: "Por horas de producción", units: "Por unidades del lote", manual: "Por porcentajes acordados" } as Record<string, string>)[value] ?? value;
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  return String(value);
}

function buildActionEditPrompt(toolName: string, input: unknown, output: unknown): string {
  const inputRecord = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const change = inputRecord.change && typeof inputRecord.change === "object" ? inputRecord.change as Record<string, unknown> : inputRecord;
  const outputRecord = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const entity = [change.name, change.product, change.material, change.expense, change.item, change.productName, change.materialName, change.expenseName, outputRecord.materialName, outputRecord.expenseName].find((item): item is string => typeof item === "string" && item.trim().length > 0);
  const label = assistantToolLabel(toolName).toLocaleLowerCase();
  return `Quiero ajustar ${entity ? `“${entity}”` : `la acción de ${label}`} que hiciste en este turno. Revisa los datos actuales y dime qué campos puedo cambiar; luego aplica el ajuste que te indique. `;
}


function assistantToolLabel(name: string) {
  return (COZTE_TOOL_LABELS as Record<string, string>)[name] ?? "Otra herramienta";
}

function dataSourceKindLabel(kind: AssistantDataSource["kind"]) {
  if (kind === "image") return "Imagen adjunta";
  if (kind === "pdf") return "PDF adjunto";
  if (kind === "spreadsheet") return "Planilla Excel";
  return "Archivo adjunto";
}

function ProposalDetailSection({ section }: { section: ProposalSection }) {
  return <section className="flex flex-col gap-2">
    <h3 className="text-sm font-semibold">{section.title}</h3>
    <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">{section.lines.map((line, index) => <li key={`${index}-${line}`} className="rounded-md bg-muted/40 px-3 py-2">{line}</li>)}</ul>
  </section>;
}

function ProposalResult({ title, result }: { title: string; result: unknown }) {
  const data = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const revision = typeof data.revision === "number" ? data.revision : null;
  const entityIds = Array.isArray(data.entityIds) ? data.entityIds : null;
  const profileRevision = typeof data.confirmedProfileRevision === "number" || typeof data.profileRevision === "number" ? Number(data.confirmedProfileRevision ?? data.profileRevision) : null;
  const createdProducts = isProductCreation(title);
  const message = profileRevision !== null
    ? `Mapa de producción confirmado y guardado como revisión ${profileRevision}.`
    : entityIds?.length
      ? `${entityIds.length} productos creados; la actualización quedó en la revisión ${revision ?? "vigente"} y se guardó su snapshot de costos.`
      : createdProducts
        ? `Ficha del producto creada en la revisión ${revision ?? "vigente"}; se guardó el snapshot del costeo.`
      : revision !== null
        ? `Cambio aplicado en la revisión ${revision}; se guardó el snapshot del costeo.`
        : "La decisión quedó guardada en el historial.";
  return <Alert><AlertTitle>Resultado registrado</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>;
}

function isProductCreation(title: string) {
  const normalized = title.toLocaleLowerCase();
  return normalized.includes("crear") && normalized.includes("producto");
}

function ProposalStatusBadge({ status, changeRequested = false }: { status: AssistantProposal["status"]; changeRequested?: boolean }) {
  const labels: Record<AssistantProposal["status"], string> = { pending: "Pendiente", approved: "Aprobada", rejected: "Descartada", superseded: "Reemplazada", stale: changeRequested ? "Ajustes solicitados" : "Necesita actualización" };
  const variant = status === "approved" ? "secondary" : status === "stale" ? "destructive" : "outline";
  return <Badge variant={variant}>{labels[status]}</Badge>;
}

function proposalEventLabel(type: string, event?: AssistantProposal["history"][number]) {
  const details = event?.details && typeof event.details === "object" ? event.details as Record<string, unknown> : {};
  if (type === "stale" && details.origin === "user-requested-changes") return "Ajustes solicitados";
  const labels: Record<string, string> = { created: "Propuesta registrada", approved: "Aprobada y aplicada", rejected: "Descartada", superseded: "Reemplazada por otra propuesta", stale: "Requiere actualización", refreshed: "Propuesta actualizada", approval_failed: "Intento de aprobación fallido" };
  return labels[type] ?? "Evento registrado";
}

function proposalEventActor(event: AssistantProposal["history"][number]) {
  if (event.type === "approved" || event.type === "rejected") return "decisión del usuario";
  const details = event.details && typeof event.details === "object" ? event.details as Record<string, unknown> : {};
  if (event.type === "stale" && details.origin === "user-requested-changes") return "decisión del usuario";
  if (event.type === "stale" || event.type === "superseded" || event.type === "refreshed" || event.type === "approval_failed") return "sistema";
  if (details.source === "cozte") return "Cozte";
  if (details.source === "migration") return "migración de datos";
  return "usuario";
}

function proposalEventReason(event: AssistantProposal["history"][number]) {
  if (!event.details || typeof event.details !== "object") return "";
  const details = event.details as Record<string, unknown>;
  return typeof details.reason === "string" ? details.reason : typeof details.note === "string" && details.note ? details.note : "";
}

function formatProposalDate(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
