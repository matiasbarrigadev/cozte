"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { toast } from "sonner";
import type { ProductionProfile } from "@/lib/production-profile";
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
import { cn } from "cn";

type ProfileResponse = { confirmed: ProductionProfile | null; draft: ProductionProfile | null; revision: number; organizationRevision: number; catalog?: { actions: { key: string; label: string; details: string; action: Record<string, unknown> }[]; missingProducts: string[]; issues: string[] } };

const suggestions = [
  "Mapear mi producción",
  "Repartir gastos compartidos",
  "Cambió mi proceso",
];

export function CozteAssistant({ demo, onDataChanged }: { demo: boolean; onDataChanged: () => Promise<void> }) {
  const [input, setInput] = React.useState("");
  const [attachment, setAttachment] = React.useState<File | null>(null);
  const [preparing, setPreparing] = React.useState(false);
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
      if (!isAbort && (isError || !message.parts.some((part) => part.type === "text" && part.text.trim()))) toast.error("Cozte no pudo completar esta respuesta. Tu mensaje quedó guardado; puedes reintentarlo.");
    },
    onError: () => toast.error("No se pudo conectar con Cozte. Revisa tu conexión y vuelve a intentar."),
  });

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
    if ((!value && !attachment) || demo || status !== "ready" || loading || preparing || voiceState !== "idle") return;
    setPreparing(true);
    try {
      let message = value;
      let files: FileList | undefined;
      if (attachment) {
        if (attachment.name.toLowerCase().endsWith(".xlsx")) {
          if (attachment.size > 1_000_000) throw new Error("El Excel debe pesar menos de 1 MB");
          const { readSheet } = await import("read-excel-file/browser");
          const rows = await readSheet(attachment);
          const excerpt = rows.slice(0, 60).map((row) => row.slice(0, 12).map((cell) => String(cell ?? "").replace(/[\r\n\t]+/g, " ").slice(0, 100)).join(" | ")).join("\n").slice(0, 5500);
          message = `${value || "Analiza esta planilla de costos y pregúntame lo que falte."}\n\nPlanilla adjunta: ${attachment.name}. Extracto de la primera hoja (${Math.min(rows.length, 60)} de ${rows.length} filas, máximo 12 columnas):\n${excerpt}`;
        } else {
          if (attachment.size > 2_000_000) throw new Error("La imagen debe pesar menos de 2 MB");
          const transfer = new DataTransfer();
          transfer.items.add(attachment);
          files = transfer.files;
          message ||= "Analiza esta imagen como evidencia de costos; no hagas cambios sin mi aprobación.";
        }
      }
      const sending = sendMessage({ text: message, files });
      setInput("");
      setAttachment(null);
      if (fileInput.current) fileInput.current.value = "";
      await sending;
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo leer el archivo"); }
    finally { setPreparing(false); }
  }

  async function decideProposal(proposal: AssistantProposal, decision: "approve" | "reject") {
    if (demo || busyProposalIds.current.has(proposal.id)) return;
    busyProposalIds.current.add(proposal.id);
    setBusyProposalId(proposal.id);
    try {
      const response = await fetch("/api/assistant/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposal.id, decision }) });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "La propuesta cambió. Actualicé su estado; vuelve a revisarla.");
      }
      await Promise.all([loadProposals(true), loadProfile()]);
      if (decision === "approve") {
        await onDataChanged();
        toast.success(proposal.kind === "production-profile" ? "Mapa de producción confirmado y versionado" : isProductCreation(proposal.title) ? "Productos creados y costo guardado en el historial" : "Propuesta aplicada y guardada en el historial");
      } else toast.success("Propuesta descartada y registrada");
    } catch (cause) {
      await Promise.all([loadProposals(true), loadProfile()]);
      toast.error(cause instanceof Error ? cause.message : "No se pudo actualizar la propuesta");
    }
    finally { busyProposalIds.current.delete(proposal.id); setBusyProposalId(null); }
  }

  async function requestProposalChanges(proposal: AssistantProposal) {
    const note = adjustmentNote.trim();
    if (demo || note.length < 3 || busyProposalIds.current.has(proposal.id)) return;
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
      setInput(`Necesito ajustar la propuesta “${proposal.title}”: ${note}. Revisa el proceso, prepara una nueva propuesta con esos cambios y explícame su impacto antes de aplicarla.`);
      toast.success("Ajustes registrados. El mensaje quedó listo para continuar con Cozte.");
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
      await loadProposals(true);
      toast.success(`${label}: propuesta guardada para revisión`);
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
                      const result = part.output as { proposal?: { title?: string; proposalId?: string }; proposalId?: string; title?: string; error?: string };
                      const saved = result.proposal ?? result;
                      if (result.error) return <Badge key={index} variant="destructive">No se guardó la propuesta: {result.error}</Badge>;
                      if (saved.proposalId) return <Badge key={index} variant="secondary">{saved.title ?? "Propuesta guardada"} · disponible en actividad</Badge>;
                    }
                    if (part.type === "file" && part.mediaType.startsWith("image/")) return <Image key={index} src={part.url} alt={part.filename ?? "Imagen adjunta"} width={320} height={224} unoptimized className="max-h-56 max-w-full rounded-md object-contain" />;
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
              {demo ? <Button render={<Link href="/sign-up" />} nativeButton={false}>Crear cuenta para conversar</Button> : <form className="mx-auto w-full max-w-4xl" onSubmit={(event) => { event.preventDefault(); void send(input); }}><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,.xlsx" className="sr-only" aria-label="Adjuntar imagen o Excel" onChange={(event) => { const file = event.target.files?.[0]; if (file) setAttachment(file); }} />{attachment ? <div className="mb-2 flex items-center gap-2 text-xs"><Badge variant="secondary">{attachment.name}</Badge><Button type="button" size="icon-xs" variant="ghost" aria-label="Quitar archivo" onClick={() => { setAttachment(null); if (fileInput.current) fileInput.current.value = ""; }}><AnimatedIcon name="close" size={14} /></Button></div> : null}<PromptInput value={input} onValueChange={setInput} onSubmit={() => void send(input)} isLoading={status !== "ready" || preparing} disabled={loading}><PromptInputTextarea id="cozte-message" aria-label="Mensaje a Cozte" maxLength={2000} placeholder="Cuéntame qué producen o qué cambió…" /><PromptInputActions className="justify-end"><Button type="button" size="icon-sm" variant="ghost" aria-label="Adjuntar imagen o Excel" title="Adjuntar imagen o Excel" onClick={() => fileInput.current?.click()}><AnimatedIcon name="attach" /></Button>{voiceState === "idle" ? <Button type="button" size="icon-sm" variant="ghost" aria-label="Dictar mensaje" title="Dictar mensaje" onClick={() => void startDictation()}><AnimatedIcon name="mic" /></Button> : <div className="flex items-center gap-2" role="status" aria-label={voiceState === "listening" ? "Escuchando el micrófono" : voiceState === "starting" ? "Activando micrófono" : "Pausando dictado"}>{voiceState === "listening" ? <AudioWaveform analyser={analyser} /> : null}<span className="hidden text-xs text-muted-foreground sm:inline">{voiceState === "starting" ? "Activando…" : voiceState === "pausing" ? "Pausando…" : "Escuchando"}</span><Button type="button" size="sm" variant="outline" disabled={voiceState === "pausing"} onClick={pauseDictation}><AnimatedIcon name="pause" data-icon="inline-start" />{voiceState === "starting" ? "Cancelar" : "Pausar"}</Button></div>}{status !== "ready" ? <Button type="button" variant="outline" onClick={stop}>Detener</Button> : null}<Button type="submit" disabled={loading || preparing || status !== "ready" || voiceState !== "idle" || (!input.trim() && !attachment)}><AnimatedIcon name="send" data-icon="inline-start" />Enviar</Button></PromptInputActions></PromptInput></form>}
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
                {!dataSources.length ? <p className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">Las imágenes y planillas que compartas con Cozte aparecerán aquí como referencia. No se conserva el archivo binario; en planillas, el extracto leído queda en la conversación.</p> : null}
                <ol className="flex flex-col gap-2">
                  {dataSources.map((source) => <li key={source.id} className="rounded-lg border p-3">
                    <div className="flex min-w-0 flex-col gap-1"><span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{dataSourceKindLabel(source.kind)}</span><strong className="break-all text-sm">{source.label}</strong><span className="text-xs text-muted-foreground"><time dateTime={source.createdAt}>{formatProposalDate(source.createdAt)}</time>{source.mediaType ? ` · ${source.mediaType}` : ""}</span></div>
                    <Button type="button" size="xs" variant="ghost" className="mt-2" onClick={() => openChatTurn(source.messageId)}>Ver turno del chat</Button>
                  </li>)}
                </ol>
              </section>

              {catalogHasActions && profile?.confirmed ? <section aria-labelledby="cozte-map-actions-title" className="flex flex-col gap-3 border-t pt-4">
                <div><h2 id="cozte-map-actions-title" className="text-sm font-semibold">Acciones del mapa</h2><p className="mt-1 text-xs text-muted-foreground">Cada cambio se prepara como propuesta para revisar.</p></div>
                {profile.catalog?.missingProducts.length ? <div className="flex flex-col gap-2 rounded-lg border p-3 text-xs"><strong>Productos fuera de la planilla</strong><p className="text-muted-foreground">Faltan datos de lote, venta, mano de obra u horas. Cozte no los completará con ceros.</p><Button size="sm" variant="outline" disabled={demo || status !== "ready"} onClick={() => void send("Preparemos la propuesta para crear en Costos de producción las fichas de " + profile.catalog?.missingProducts.join(", ") + ". Primero dime qué datos faltan y no uses ceros para desconocidos.")}>Completar fichas con Cozte</Button></div> : null}
                {profile.catalog?.issues.length ? <ul className="list-inside list-disc text-xs text-muted-foreground">{profile.catalog.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
                <div className="flex flex-col gap-2">{profile.catalog?.actions.map((item) => <div key={item.key} className="flex flex-col gap-2 rounded-lg border p-3 text-xs"><div><strong>{item.label}</strong><p className="mt-1 text-muted-foreground">{item.details}</p></div><Button size="sm" variant="outline" className="self-start" disabled={demo} onClick={() => void proposeCatalogAction(item.action, item.label)}>Preparar propuesta</Button></div>)}</div>
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
          {selectedProposal.status === "pending" ? <section className="flex flex-col gap-2 rounded-lg border p-3" aria-label="Solicitar cambios"><label htmlFor="cozte-adjustment-note" className="text-sm font-semibold">¿Qué habría que cambiar?</label><p className="text-xs text-muted-foreground">Cozte registrará tu decisión y dejará un mensaje listo para preparar una nueva propuesta.</p><Textarea id="cozte-adjustment-note" value={adjustmentNote} maxLength={500} onChange={(event) => setAdjustmentNote(event.target.value)} placeholder="Ej. Repartir electricidad por horas de uso, no por unidades…" /><Button type="button" size="sm" variant="outline" className="self-start" disabled={adjustmentNote.trim().length < 3 || busyProposalId !== null} onClick={() => void requestProposalChanges(selectedProposal)}>{busyProposalId === selectedProposal.id ? "Registrando…" : "Solicitar ajustes"}</Button></section> : null}
          {selectedProposal.status === "pending" ? <DialogFooter>
            <Button variant="outline" disabled={busyProposalId !== null} onClick={() => void decideProposal(selectedProposal, "reject")}>{busyProposalId === selectedProposal.id ? "Guardando…" : "Descartar propuesta"}</Button>
            <Button disabled={!canApprove(selectedProposal) || busyProposalId !== null} onClick={() => void decideProposal(selectedProposal, "approve")}><AnimatedIcon name="check" data-icon="inline-start" />{busyProposalId === selectedProposal.id ? "Guardando…" : selectedProposal.kind === "production-profile" ? "Aprobar mapa" : isProductCreation(selectedProposal.title) ? "Aprobar y crear" : "Aprobar y aplicar"}</Button>
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
  const labels: Record<string, string> = { created: "Propuesta registrada", approved: "Aprobada y aplicada", rejected: "Descartada", superseded: "Reemplazada por otra propuesta", stale: "Requiere actualización", approval_failed: "Intento de aprobación fallido" };
  return labels[type] ?? "Evento registrado";
}

function proposalEventActor(event: AssistantProposal["history"][number]) {
  if (event.type === "approved" || event.type === "rejected") return "decisión del usuario";
  const details = event.details && typeof event.details === "object" ? event.details as Record<string, unknown> : {};
  if (event.type === "stale" && details.origin === "user-requested-changes") return "decisión del usuario";
  if (event.type === "stale" || event.type === "superseded" || event.type === "approval_failed") return "sistema";
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
