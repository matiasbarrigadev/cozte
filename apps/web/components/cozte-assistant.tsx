"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { toast } from "sonner";
import type { ProductionProfile } from "@/lib/production-profile";
import type { Currency } from "@/lib/currency";
import type { AssistantProposal } from "@/lib/server/assistant-proposals";
import type { AssistantDataSource } from "@/lib/server/assistant-trace";
import type { ProposalSection } from "@/lib/proposal-presentation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from "@/components/ui/chat-container";
import { PromptInput, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { PromptSuggestion } from "@/components/ui/prompt-suggestion";
import { Textarea } from "@/components/ui/textarea";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { AudioWaveform, useVoiceDictation } from "@/components/use-voice-dictation";
import { AnimatedIcon } from "@/components/animated-icon";
import { COZTE_ASSISTANT_ATTACHMENT_MEDIA_TYPES, COZTE_MAX_ATTACHMENT_COUNT, COZTE_MAX_IMAGE_COUNT, COZTE_MAX_PDF_BYTES, COZTE_MAX_SPREADSHEET_COUNT, COZTE_MAX_SPREADSHEET_BYTES, COZTE_MAX_TOTAL_ATTACHMENT_BYTES, COZTE_MAX_TOTAL_IMAGE_BYTES, getCozteAttachmentKind, getCozteAttachmentMaxBytes, getCozteAttachmentMediaType } from "@/lib/cozte-assistant-attachments";
import { cn } from "cn";

type ProfileResponse = { confirmed: ProductionProfile | null; draft: ProductionProfile | null; revision: number; organizationRevision: number; currency: Currency; costs: { product: string; unitMinor: number | null; warnings: string[] }[]; gaps: string[]; evaluableProducts: string[]; catalog?: { actions: { key: string; label: string; details: string; action: Record<string, unknown> }[]; missingProducts: string[]; issues: string[] } };

const suggestions = [
  "Mapear mi producción",
  "Repartir gastos compartidos",
  "Cambió mi proceso",
];

export function CozteAssistant({ demo, onDataChanged }: { demo: boolean; onDataChanged: () => Promise<void> }) {
  const [input, setInput] = React.useState("");
  const [attachments, setAttachments] = React.useState<File[]>([]);
  const [preparing, setPreparing] = React.useState(false);
  const [draggingFiles, setDraggingFiles] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const { voiceState, analyser, start: startDictation, pause: pauseDictation } = useVoiceDictation(setInput);
  const [profile, setProfile] = React.useState<ProfileResponse | null>(null);
  const [proposals, setProposals] = React.useState<AssistantProposal[]>([]);
  const [dataSources, setDataSources] = React.useState<AssistantDataSource[]>([]);
  const [mobilePanel, setMobilePanel] = React.useState<"chat" | "activity">("chat");
  const [activityFilter, setActivityFilter] = React.useState<"all" | "pending" | "decisions" | "updates">("all");
  const [selectedProposalId, setSelectedProposalId] = React.useState<string | null>(null);
  const [adjustmentNote, setAdjustmentNote] = React.useState("");
  const [busyProposalId, setBusyProposalId] = React.useState<string | null>(null);
  const busyProposalIds = React.useRef(new Set<string>());
  const [loading, setLoading] = React.useState(!demo);
  const [proposalsLoading, setProposalsLoading] = React.useState(!demo);
  const transport = React.useMemo(() => new DefaultChatTransport({ api: "/api/assistant", prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages.at(-1) } }) }), []);
  const { messages, setMessages, sendMessage, status, error, stop } = useChat<UIMessage>({ transport,
    onFinish: ({ message, isError, isAbort }) => {
      void loadProfile();
      void loadProposals(true);
      if (message.parts.some((part) => isToolUIPart(part) && part.state === "output-available" && ["tool-proposeCostAction", "tool-proposeMaterialPrice", "tool-proposeExpenseAmount", "tool-proposeProductionProfile"].includes(part.type) && !!part.output && typeof part.output === "object" && (part.output as { applied?: boolean }).applied)) void onDataChanged();
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

  async function loadProfile() {
    if (demo) return;
    try {
      const response = await fetch("/api/production-profile", { cache: "no-store" });
      if (!response.ok) throw new Error("No se pudo cargar el mapa de producción");
      setProfile(await response.json());
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se pudo cargar el mapa"); }
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

  React.useEffect(() => {
    if (demo) return;
    let active = true;
    Promise.all([fetch("/api/assistant", { cache: "no-store" }), fetch("/api/production-profile", { cache: "no-store" }), fetch("/api/assistant/proposals", { cache: "no-store" })]).then(async ([chatResponse, profileResponse, proposalResponse]) => {
      if (!chatResponse.ok || !profileResponse.ok || !proposalResponse.ok) throw new Error("No se pudo cargar Cozte");
      const [chat, process, proposalData] = await Promise.all([chatResponse.json(), profileResponse.json(), proposalResponse.json()]);
      if (active) { setMessages(chat.messages ?? []); setProfile(process); setProposals(Array.isArray(proposalData.proposals) ? proposalData.proposals : []); setDataSources(Array.isArray(proposalData.sources) ? proposalData.sources : []); }
    }).catch(() => { if (active) toast.error("No se pudieron cargar el chat y las propuestas guardadas"); }).finally(() => { if (active) { setLoading(false); setProposalsLoading(false); } });
    return () => { active = false; };
  }, [demo, setMessages]);

  async function send(text: string) {
    const value = text.trim();
    if ((!value && !attachments.length) || demo || status !== "ready" || loading || preparing || voiceState !== "idle") return;
    setPreparing(true);
    try {
      let message = value || (attachments.length ? "Revisa los archivos adjuntos como evidencia de costos de producción. Pregúntame por los datos que falten y guárdalos en el mapa de trabajo; no cargues precios a la base operativa sin que te lo pida. Pide aprobación solo si un producto completo inicia evaluación o cambia un costo que afecte productos ya evaluados." : "");
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
      await Promise.all([loadProposals(true), loadProfile()]);
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
      await Promise.all([loadProposals(true), loadProfile()]);
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

  async function proposeCatalogAction(action: Record<string, unknown>, label: string) {
    if (demo || !profile) return;
    try {
      const response = await fetch("/api/assistant/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mutation: { ...action, expectedRevision: profile.organizationRevision, idempotencyKey: crypto.randomUUID() } }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo preparar la propuesta");
      await Promise.all([loadProposals(true), loadProfile()]);
      if (data.applied) {
        await onDataChanged();
        toast.success(`${label}: cambio aplicado y auditado`);
      } else toast.success(`${label}: propuesta guardada para revisión`);
    } catch (cause) {
      await loadProposals(true);
      toast.error(cause instanceof Error ? cause.message : "No se pudo preparar la propuesta");
    }
  }

  function openChatTurn(messageId: string) {
    setSelectedProposalId(null);
    setMobilePanel("chat");
    window.setTimeout(() => document.getElementById(`cozte-message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }

  const pendingProposals = proposals.filter((proposal) => proposal.status === "pending");
  const selectedProposal = proposals.find((proposal) => proposal.id === selectedProposalId) ?? null;
  const canApprove = (proposal: AssistantProposal) => proposal.status === "pending" && !(proposal.details.blockers?.length);
  const visibleProposals = proposals.filter((proposal) => {
    if (activityFilter === "pending") return proposal.status === "pending";
    if (activityFilter === "decisions") return proposal.status === "approved" || proposal.status === "rejected" || proposal.status === "superseded";
    if (activityFilter === "updates") return proposal.status === "stale";
    return true;
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const proposalsAfterMessage = new Map<string, AssistantProposal[]>();
  let latestUserMessageId: string | null = null;
  const placedProposalIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "user") latestUserMessageId = message.id;
    if (message.role === "assistant" && latestUserMessageId) {
      const turnProposals = proposals.filter((proposal) => proposal.sourceMessageId === latestUserMessageId && !placedProposalIds.has(proposal.id));
      if (turnProposals.length) {
        proposalsAfterMessage.set(message.id, turnProposals);
        turnProposals.forEach((proposal) => placedProposalIds.add(proposal.id));
      }
    }
  }
  const catalogHasActions = Boolean(profile?.confirmed && ((profile.catalog?.actions.length ?? 0) > 0 || (profile.catalog?.missingProducts.length ?? 0) > 0 || (profile.catalog?.issues.length ?? 0) > 0));

  return <>
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Cozte AI</h1>
        <Badge variant="outline" className="lg:hidden">{pendingProposals.length} pendientes</Badge>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 lg:hidden" role="tablist" aria-label="Secciones de Cozte">
        <button id="cozte-chat-tab" type="button" role="tab" aria-selected={mobilePanel === "chat"} aria-controls="cozte-chat-panel" onClick={() => setMobilePanel("chat")} className={cn("rounded-md px-3 py-2 text-sm font-medium transition-colors", mobilePanel === "chat" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>Chat</button>
        <button id="cozte-activity-tab" type="button" role="tab" aria-selected={mobilePanel === "activity"} aria-controls="cozte-activity-panel" onClick={() => setMobilePanel("activity")} className={cn("flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors", mobilePanel === "activity" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>Propuestas y actividad{pendingProposals.length ? <Badge variant="secondary">{pendingProposals.length}</Badge> : null}</button>
      </div>

      <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section id="cozte-chat-panel" role="tabpanel" aria-labelledby="cozte-chat-tab" aria-label="Chat con Cozte" className={cn("min-w-0", mobilePanel === "chat" ? "flex" : "hidden lg:flex")}>
          <Card className="flex h-[calc(100dvh-13rem)] min-h-[30rem] w-full min-w-0 flex-col gap-0 overflow-hidden py-0 lg:h-[calc(100dvh-11rem)]">
            <CardContent className="flex min-h-0 flex-1 flex-col px-4 py-5 md:px-8"><ChatContainerRoot className="min-h-0 flex-1" aria-live="polite"><ChatContainerContent className="mx-auto min-h-full w-full max-w-4xl gap-4">
              {!messages.length ? <Empty className="my-auto"><EmptyHeader><EmptyMedia variant="icon"><AnimatedIcon name="sparkles" size={24} /></EmptyMedia><EmptyTitle>Empecemos por tu producción</EmptyTitle><EmptyDescription>¿Qué productos terminados y empacados fabrican, dónde y cómo?</EmptyDescription></EmptyHeader></Empty> : null}
              {messages.map((message) => <React.Fragment key={message.id}>
                <div id={`cozte-message-${message.id}`} data-message-id={message.id} className={message.role === "user" ? "ml-auto flex max-w-[88%] scroll-mt-6 flex-col gap-2 rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground" : "flex max-w-[94%] scroll-mt-6 flex-col gap-2 rounded-xl bg-muted px-4 py-3 text-sm"}>
                  <span className="text-xs font-semibold">{message.role === "user" ? "Tú" : "Cozte"}</span>
                  {message.parts.map((part, index) => {
                    if (part.type === "text") return message.role === "assistant" ? <AssistantMarkdown key={index} text={part.text} /> : <p key={index} className="whitespace-pre-wrap leading-relaxed">{part.text}</p>;
                    if (isToolUIPart(part) && part.state === "output-available" && part.type.startsWith("tool-propose")) {
                      const result = part.output as { kind?: string; applied?: boolean; status?: string; draftRevision?: number; evaluableProducts?: string[]; proposal?: { title?: string; proposalId?: string }; proposalId?: string; title?: string; error?: string };
                      const saved = result.proposal ?? result;
                      if (result.error) return <Badge key={index} variant="destructive">No se guardó la propuesta: {result.error}</Badge>;
                      if (result.kind === "profile-draft") return <Badge key={index} variant="secondary">{result.evaluableProducts?.length ? `Listo para evaluar · ${result.evaluableProducts.join(", ")}` : "Avance guardado · en armado, sin aprobación"}</Badge>;
                      if (result.applied) return <Badge key={index} variant="secondary">Cambio aplicado y auditado</Badge>;
                      if (saved.proposalId) return <Badge key={index} variant="secondary">{saved.title ?? "Propuesta guardada"} · disponible en actividad</Badge>;
                    }
                    if (part.type === "file" && part.mediaType.startsWith("image/")) return <div key={index} className="flex flex-col items-start gap-1"><Image src={part.url} alt={part.filename ?? "Imagen adjunta"} width={320} height={224} unoptimized className="max-h-56 max-w-full rounded-md object-contain" /><span className="max-w-full truncate text-xs opacity-80">{part.filename ?? "Imagen adjunta"}</span></div>;
                    if (part.type === "file" && part.mediaType === "application/pdf") return <Badge key={index} variant="outline">PDF · {part.filename ?? "Documento adjunto"}</Badge>;
                    if (part.type === "file" && part.mediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return <Badge key={index} variant="outline">Excel · {part.filename ?? "Planilla adjunta"}</Badge>;
                    if (isToolUIPart(part) && part.state === "output-available") {
                      const label = part.type === "tool-inspectCostBase" ? "Base de costos revisada" : part.type === "tool-calculateCostRule" ? "Regla calculada por el motor" : part.type === "tool-findMaterial" ? "Insumo contrastado" : "Herramienta utilizada";
                      return <Badge key={index} variant="outline">{label}</Badge>;
                    }
                    if (isToolUIPart(part) && (part.state === "input-streaming" || part.state === "input-available")) return <TextShimmer key={index} className="text-xs">Consultando datos…</TextShimmer>;
                    return null;
                  })}
                </div>
                {(proposalsAfterMessage.get(message.id) ?? []).map((proposal) => <ProposalTurnCard key={proposal.id} proposal={proposal} onOpen={() => setSelectedProposalId(proposal.id)} />)}
              </React.Fragment>)}
              {status === "submitted" || status === "streaming" ? <TextShimmer className="text-sm">Cozte está analizando…</TextShimmer> : null}
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
                    <span className="px-2 text-xs text-muted-foreground">Pega o arrastra imágenes, PDF o Excel · hasta {COZTE_MAX_ATTACHMENT_COUNT} archivos</span>
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

        <aside id="cozte-activity-panel" role="tabpanel" aria-labelledby="cozte-activity-tab" aria-label="Propuestas, decisiones y fuentes" className={cn("min-w-0", mobilePanel === "activity" ? "flex" : "hidden lg:flex")}>
          <Card className="flex h-[calc(100dvh-13rem)] min-h-[30rem] w-full min-w-0 flex-col gap-0 overflow-hidden py-0 lg:h-[calc(100dvh-11rem)]">
            <CardHeader className="shrink-0 border-b px-4 py-4">
              <div className="flex items-center justify-between gap-2"><h2 className="text-base font-semibold">Actividad de Cozte</h2><Badge variant="outline">{pendingProposals.length} pendientes</Badge></div>
              <CardDescription>Propuestas, decisiones y fuentes, en un mismo lugar.</CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
              {profile?.draft ? <section aria-label="Estado del mapa de producción" className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Mapa de producción</h2><Badge variant={pendingProposals.some((proposal) => proposal.kind === "production-profile") ? "outline" : profile.evaluableProducts.length ? "secondary" : "outline"}>{pendingProposals.some((proposal) => proposal.kind === "production-profile") ? "Revisión pendiente" : profile.evaluableProducts.length ? "Listo para evaluar" : "En armado"}</Badge></div>
                <p className="text-xs text-muted-foreground">{profile.evaluableProducts.length ? `Puede iniciar evaluación: ${profile.evaluableProducts.join(", ")}.` : "Los datos parciales se guardan sin pedir aprobación. El permiso aparece al completar un producto para evaluación."}</p>
                {profile.evaluableProducts.length ? <ul className="flex flex-col gap-1 text-xs">{profile.evaluableProducts.map((name) => { const cost = profile.costs.find((item) => item.product.toLocaleLowerCase() === name.toLocaleLowerCase())?.unitMinor; return <li key={name} className="flex items-center justify-between gap-2"><span>{name}</span><strong>{cost === null || cost === undefined ? "Costo pendiente" : `${formatProfileUnitCost(cost, profile.currency)} / unidad`}</strong></li>; })}</ul> : null}
                {!profile.evaluableProducts.length && profile.gaps.length ? <p className="text-xs text-muted-foreground">Pendiente: {profile.gaps.slice(0, 3).join(" · ")}{profile.gaps.length > 3 ? "…" : ""}</p> : null}
              </section> : null}
              <section aria-labelledby="cozte-activity-title" className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2"><h2 id="cozte-activity-title" className="text-sm font-semibold">Propuestas y decisiones</h2>{proposalsLoading ? <span className="text-xs text-muted-foreground">Cargando…</span> : null}</div>
                <div className="flex flex-wrap gap-1" aria-label="Filtrar actividad">
                  {([{ key: "all", label: "Todo" }, { key: "pending", label: "Pendientes" }, { key: "decisions", label: "Decisiones" }, { key: "updates", label: "Por ajustar" }] as const).map((filter) => <Button key={filter.key} type="button" size="xs" variant={activityFilter === filter.key ? "secondary" : "ghost"} aria-pressed={activityFilter === filter.key} onClick={() => setActivityFilter(filter.key)}>{filter.label}</Button>)}
                </div>
                {!proposalsLoading && visibleProposals.length === 0 ? <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">{activityFilter === "all" ? "Cuando Cozte prepare una propuesta, aparecerá aquí y junto a su respuesta en el chat." : "No hay elementos en este filtro."}</p> : null}
                <ol className="flex flex-col gap-2">
                  {visibleProposals.map((proposal) => <li key={proposal.id}>
                    <button type="button" className="flex w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedProposalId(proposal.id)}>
                      <span className="flex w-full items-start justify-between gap-2"><strong className="min-w-0 text-sm leading-snug">{proposal.title}</strong><ProposalStatusBadge status={proposal.status} changeRequested={proposal.changeRequest !== null} /></span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{proposal.summary}</span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><time dateTime={proposal.createdAt}>{formatProposalDate(proposal.createdAt)}</time>{proposal.sources.length ? <Badge variant="outline">{proposal.sources.length} {proposal.sources.length === 1 ? "fuente" : "fuentes"}</Badge> : null}</span>
                    </button>
                  </li>)}
                </ol>
              </section>

              <section aria-labelledby="cozte-sources-title" className="flex flex-col gap-3 border-t pt-4">
                <div><h2 id="cozte-sources-title" className="text-sm font-semibold">Fuentes de datos</h2><p className="mt-1 text-xs text-muted-foreground">Archivos adjuntos y el turno donde se usaron.</p></div>
                {!dataSources.length ? <p className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">Las imágenes, PDF y planillas que compartas aparecerán aquí como referencia. No se guarda el archivo original; el texto leído de Excel queda en la conversación.</p> : null}
                <ol className="flex flex-col gap-2">
                  {dataSources.map((source) => <li key={source.id} className="rounded-lg border p-3">
                    <div className="flex min-w-0 flex-col gap-1"><span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{dataSourceKindLabel(source.kind)}</span><strong className="break-all text-sm">{source.label}</strong><span className="text-xs text-muted-foreground"><time dateTime={source.createdAt}>{formatProposalDate(source.createdAt)}</time>{source.mediaType ? ` · ${source.mediaType}` : ""}</span></div>
                    <Button type="button" size="xs" variant="ghost" className="mt-2" onClick={() => openChatTurn(source.messageId)}>Ver turno del chat</Button>
                  </li>)}
                </ol>
              </section>

              {catalogHasActions && profile?.confirmed ? <section aria-labelledby="cozte-map-actions-title" className="flex flex-col gap-3 border-t pt-4">
                <div><h2 id="cozte-map-actions-title" className="text-sm font-semibold">Acciones del mapa</h2><p className="mt-1 text-xs text-muted-foreground">Los avances sin impacto en productos evaluados no piden aprobación. La revisión se activa al completar un producto o cambiar costos que lo afectan.</p></div>
                {profile.catalog?.missingProducts.length ? <div className="flex flex-col gap-2 rounded-lg border p-3 text-xs"><strong>Productos fuera de la planilla</strong><p className="text-muted-foreground">Faltan datos de lote, venta, mano de obra u horas. Cozte no los completará con ceros.</p><Button size="sm" variant="outline" disabled={demo || status !== "ready"} onClick={() => void send("Preparemos la propuesta para crear en Costos de producción las fichas de " + profile.catalog?.missingProducts.join(", ") + ". Primero dime qué datos faltan y no uses ceros para desconocidos.")}>Completar fichas con Cozte</Button></div> : null}
                {profile.catalog?.issues.length ? <ul className="list-inside list-disc text-xs text-muted-foreground">{profile.catalog.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
                <div className="flex flex-col gap-2">{profile.catalog?.actions.map((item) => <div key={item.key} className="flex flex-col gap-2 rounded-lg border p-3 text-xs"><div><strong>{item.label}</strong><p className="mt-1 text-muted-foreground">{item.details}</p></div><Button size="sm" variant="outline" className="self-start" disabled={demo} onClick={() => void proposeCatalogAction(item.action, item.label)}>Aplicar o revisar</Button></div>)}</div>
              </section> : null}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
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
  </>;
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

function formatProfileUnitCost(value: number, currency: Currency) {
  return new Intl.NumberFormat("es", { style: "currency", currency, maximumFractionDigits: currency === "CLP" || currency === "ARS" ? 0 : 2 }).format(value);
}
