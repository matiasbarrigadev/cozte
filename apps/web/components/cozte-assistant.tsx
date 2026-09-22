"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { toast } from "sonner";
import type { ProductionProfile } from "@/lib/production-profile";
import type { AssistantProposal } from "@/lib/server/assistant-proposals";
import type { ProposalSection } from "@/lib/proposal-presentation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from "@/components/ui/chat-container";
import { PromptInput, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { PromptSuggestion } from "@/components/ui/prompt-suggestion";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { AudioWaveform, useVoiceDictation } from "@/components/use-voice-dictation";
import { AnimatedIcon } from "@/components/animated-icon";

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
  const [selectedProposalId, setSelectedProposalId] = React.useState<string | null>(null);
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
      if (active) { setMessages(chat.messages ?? []); setProfile(process); setProposals(Array.isArray(proposalData.proposals) ? proposalData.proposals : []); }
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

  const pendingProposals = proposals.filter((proposal) => proposal.status === "pending");
  const historyProposals = proposals.filter((proposal) => proposal.status !== "pending");
  const selectedProposal = proposals.find((proposal) => proposal.id === selectedProposalId) ?? null;
  const canApprove = (proposal: AssistantProposal) => proposal.status === "pending" && !(proposal.details.blockers?.length);

  return <>
    <h1 className="text-3xl font-semibold tracking-tight">Cozte AI</h1>
    <Card className="flex h-[calc(100dvh-11rem)] min-h-[30rem] min-w-0 flex-col gap-0 overflow-hidden py-0">
        <CardContent className="flex min-h-0 flex-1 flex-col px-4 py-5 md:px-8"><ChatContainerRoot className="min-h-0 flex-1" aria-live="polite"><ChatContainerContent className="mx-auto min-h-full max-w-4xl gap-4">
          {!messages.length ? <Empty className="my-auto"><EmptyHeader><EmptyMedia variant="icon"><AnimatedIcon name="sparkles" size={24} /></EmptyMedia><EmptyTitle>Empecemos por tu producción</EmptyTitle><EmptyDescription>¿Qué productos terminados y empacados fabrican, dónde y cómo?</EmptyDescription></EmptyHeader></Empty> : null}
          {messages.map((message) => <div key={message.id} className={message.role === "user" ? "ml-auto flex max-w-[88%] flex-col gap-2 rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground" : "flex max-w-[94%] flex-col gap-2 rounded-xl bg-muted px-4 py-3 text-sm"}>
            <span className="text-xs font-semibold">{message.role === "user" ? "Tú" : "Cozte"}</span>
            {message.parts.map((part, index) => {
              if (part.type === "text") return message.role === "assistant" ? <AssistantMarkdown key={index} text={part.text} /> : <p key={index} className="whitespace-pre-wrap leading-relaxed">{part.text}</p>;
              if (isToolUIPart(part) && part.state === "output-available" && part.type.startsWith("tool-propose")) {
                const result = part.output as { proposal?: { title?: string; proposalId?: string }; proposalId?: string; title?: string; error?: string };
                const saved = result.proposal ?? result;
                if (result.error) return <Badge key={index} variant="destructive">No se guardó la propuesta: {result.error}</Badge>;
                if (saved.proposalId) return <Badge key={index} variant="secondary">{saved.title ?? "Propuesta guardada"} · pendiente de revisar abajo</Badge>;
              }
              if (part.type === "file" && part.mediaType.startsWith("image/")) return <Image key={index} src={part.url} alt={part.filename ?? "Imagen adjunta"} width={320} height={224} unoptimized className="max-h-56 max-w-full rounded-md object-contain" />;
              if (isToolUIPart(part) && part.state === "output-available") {
                const label = part.type === "tool-inspectCostBase" ? "Base de costos revisada" : part.type === "tool-calculateCostRule" ? "Regla calculada por el motor" : part.type === "tool-findMaterial" ? "Insumo contrastado" : "Herramienta utilizada";
                return <Badge key={index} variant="outline">{label}</Badge>;
              }
              if (isToolUIPart(part) && (part.state === "input-streaming" || part.state === "input-available")) return <TextShimmer key={index} className="text-xs">Consultando datos…</TextShimmer>;
              return null;
            })}
          </div>)}
          <section aria-labelledby="cozte-proposals-title" className="flex w-full max-w-4xl flex-col gap-3 self-center py-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="cozte-proposals-title" className="text-sm font-semibold">Propuestas de Cozte</h2><Badge variant="outline">{pendingProposals.length} pendientes</Badge></div>
            {proposalsLoading ? <p className="text-sm text-muted-foreground">Cargando propuestas guardadas…</p> : null}
            {!proposalsLoading && pendingProposals.length === 0 ? <p className="text-sm text-muted-foreground">No hay propuestas pendientes. Las aprobadas y descartadas quedan en el historial.</p> : null}
            {pendingProposals.map((proposal) => <Card key={proposal.id} size="sm"><CardContent className="flex flex-col gap-3 py-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="flex min-w-0 flex-col gap-1"><strong>{proposal.title}</strong><p className="text-muted-foreground">{proposal.summary}</p></div><ProposalStatusBadge status={proposal.status} /></div>
              {proposal.details.blockers?.length ? <Alert variant="destructive"><AlertTitle>Faltan referencias por corregir</AlertTitle><AlertDescription>{proposal.details.blockers.join(" · ")}</AlertDescription></Alert> : null}
              <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => setSelectedProposalId(proposal.id)}>Ver propuesta completa</Button><Button size="sm" variant="outline" disabled={busyProposalId !== null} onClick={() => void decideProposal(proposal, "reject")}>Descartar</Button><Button size="sm" disabled={!canApprove(proposal) || busyProposalId !== null} onClick={() => void decideProposal(proposal, "approve")}><AnimatedIcon name="check" data-icon="inline-start" />{busyProposalId === proposal.id ? "Guardando…" : proposal.kind === "production-profile" ? "Aprobar mapa" : isProductCreation(proposal.title) ? "Aprobar y crear" : "Aprobar y aplicar"}</Button></div>
            </CardContent></Card>)}
            {historyProposals.length ? <details className="rounded-lg border bg-card px-3 py-2 text-sm"><summary className="cursor-pointer font-medium">Historial de propuestas ({historyProposals.length})</summary><div className="mt-3 flex flex-col gap-2">{historyProposals.map((proposal) => <button key={proposal.id} type="button" className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3 text-left hover:bg-muted/50" onClick={() => setSelectedProposalId(proposal.id)}><span className="flex min-w-0 flex-col gap-1"><strong className="truncate">{proposal.title}</strong><span className="truncate text-xs text-muted-foreground">{proposal.summary}</span></span><ProposalStatusBadge status={proposal.status} /></button>)}</div></details> : null}
          </section>
          {profile?.confirmed && ((profile.catalog?.actions.length ?? 0) > 0 || (profile.catalog?.missingProducts.length ?? 0) > 0 || (profile.catalog?.issues.length ?? 0) > 0) ? <Card size="sm" className="w-full max-w-4xl self-center"><CardContent className="flex flex-col gap-3 py-3 text-sm"><strong>Incorporar el mapa a tus costos</strong><p className="text-muted-foreground">Cada incorporación también queda como propuesta para aprobar y consultar después.</p>{profile.catalog?.missingProducts.length ? <div className="flex flex-col gap-2 rounded-lg border p-3"><strong>Productos aún fuera de la planilla</strong><p>{profile.catalog.missingProducts.join(", ")}</p><p className="text-xs text-muted-foreground">Para crear sus fichas faltan datos de lote, venta, mano de obra y horas. Cozte no los completa con ceros: pídele que prepare una propuesta cuando tengas esa información.</p><Button size="sm" variant="outline" className="self-start" disabled={demo || status !== "ready"} onClick={() => void send("Preparemos la propuesta para crear en Costos de producción las fichas de " + profile.catalog?.missingProducts.join(", ") + ". Primero dime qué datos faltan y no uses ceros para desconocidos.")}>Completar fichas con Cozte</Button></div> : null}{profile.catalog?.issues.length ? <ul className="list-inside list-disc text-xs text-muted-foreground">{profile.catalog.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}<div className="flex flex-col gap-2">{profile.catalog?.actions.map((item) => <div key={item.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2"><div><strong>{item.label}</strong><p className="text-xs text-muted-foreground">{item.details}</p></div><Button size="sm" variant="outline" disabled={demo} onClick={() => void proposeCatalogAction(item.action, item.label)}>Preparar propuesta</Button></div>)}</div></CardContent></Card> : null}
          {status === "submitted" || status === "streaming" ? <TextShimmer className="text-sm">Cozte está analizando…</TextShimmer> : null}
          <ChatContainerScrollAnchor />
        </ChatContainerContent></ChatContainerRoot></CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3 border-t px-4 py-4 md:px-8">
          {error ? <Alert variant="destructive"><AlertTitle>No se pudo completar la respuesta</AlertTitle><AlertDescription>{error.message || "Intenta otra vez."}</AlertDescription></Alert> : null}
          {!messages.length ? <div className="flex flex-wrap gap-2">{suggestions.map((item) => <PromptSuggestion key={item} size="sm" disabled={demo || loading} onClick={() => send(item)}>{item}</PromptSuggestion>)}</div> : null}
          {demo ? <Button render={<Link href="/sign-up" />} nativeButton={false}>Crear cuenta para conversar</Button> : <form className="mx-auto w-full max-w-4xl" onSubmit={(event) => { event.preventDefault(); void send(input); }}><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,.xlsx" className="sr-only" aria-label="Adjuntar imagen o Excel" onChange={(event) => { const file = event.target.files?.[0]; if (file) setAttachment(file); }} />{attachment ? <div className="mb-2 flex items-center gap-2 text-xs"><Badge variant="secondary">{attachment.name}</Badge><Button type="button" size="icon-xs" variant="ghost" aria-label="Quitar archivo" onClick={() => { setAttachment(null); if (fileInput.current) fileInput.current.value = ""; }}><AnimatedIcon name="close" size={14} /></Button></div> : null}<PromptInput value={input} onValueChange={setInput} onSubmit={() => void send(input)} isLoading={status !== "ready" || preparing} disabled={loading}><PromptInputTextarea id="cozte-message" aria-label="Mensaje a Cozte" maxLength={2000} placeholder="Cuéntame qué producen o qué cambió…" /><PromptInputActions className="justify-end"><Button type="button" size="icon-sm" variant="ghost" aria-label="Adjuntar imagen o Excel" title="Adjuntar imagen o Excel" onClick={() => fileInput.current?.click()}><AnimatedIcon name="attach" /></Button>{voiceState === "idle" ? <Button type="button" size="icon-sm" variant="ghost" aria-label="Dictar mensaje" title="Dictar mensaje" onClick={() => void startDictation()}><AnimatedIcon name="mic" /></Button> : <div className="flex items-center gap-2" role="status" aria-label={voiceState === "listening" ? "Escuchando el micrófono" : voiceState === "starting" ? "Activando micrófono" : "Pausando dictado"}>{voiceState === "listening" ? <AudioWaveform analyser={analyser} /> : null}<span className="hidden text-xs text-muted-foreground sm:inline">{voiceState === "starting" ? "Activando…" : voiceState === "pausing" ? "Pausando…" : "Escuchando"}</span><Button type="button" size="sm" variant="outline" disabled={voiceState === "pausing"} onClick={pauseDictation}><AnimatedIcon name="pause" data-icon="inline-start" />{voiceState === "starting" ? "Cancelar" : "Pausar"}</Button></div>}{status !== "ready" ? <Button type="button" variant="outline" onClick={stop}>Detener</Button> : null}<Button type="submit" disabled={loading || preparing || status !== "ready" || voiceState !== "idle" || (!input.trim() && !attachment)}><AnimatedIcon name="send" data-icon="inline-start" />Enviar</Button></PromptInputActions></PromptInput></form>}
        </CardFooter>
    </Card>
    <Dialog open={selectedProposal !== null} onOpenChange={(open) => { if (!open) setSelectedProposalId(null); }}>
      <DialogContent className="max-h-[min(88dvh,52rem)] max-w-2xl overflow-y-auto">
        {selectedProposal ? <>
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2"><DialogTitle>{selectedProposal.title}</DialogTitle><ProposalStatusBadge status={selectedProposal.status} /></div>
            <DialogDescription>{selectedProposal.summary}</DialogDescription>
          </DialogHeader>
          {selectedProposal.status === "stale" ? <Alert variant="destructive"><AlertTitle>Requiere una propuesta nueva</AlertTitle><AlertDescription>{selectedProposal.decisionNote ?? "La base cambió desde que se preparó. Pídele a Cozte que actualice esta propuesta."}</AlertDescription></Alert> : null}
          {selectedProposal.details.blockers?.length ? <Alert variant="destructive"><AlertTitle>No se puede aprobar todavía</AlertTitle><AlertDescription>{selectedProposal.details.blockers.join(" · ")}</AlertDescription></Alert> : null}
          {selectedProposal.status === "approved" ? <ProposalResult title={selectedProposal.title} result={selectedProposal.result} /> : null}
          <div className="flex flex-col gap-4">
            {selectedProposal.details.sections.map((section) => <ProposalDetailSection key={section.title} section={section} />)}
            <section className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3" aria-label="Registro de auditoría">
              <h3 className="text-sm font-semibold">Registro</h3>
              <p className="text-xs text-muted-foreground">Creada {formatProposalDate(selectedProposal.createdAt)} · revisión base {selectedProposal.baseOrganizationRevision}{selectedProposal.baseProfileRevision !== null ? ` · perfil ${selectedProposal.baseProfileRevision}` : ""}</p>
              {selectedProposal.history.length ? <ol className="flex flex-col gap-2">{selectedProposal.history.map((event) => <li key={event.id} className="flex flex-col gap-1 border-t pt-2 text-sm"><div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><span className="font-medium">{proposalEventLabel(event.type)} <span className="font-normal text-muted-foreground">· {proposalEventActor(event)}</span></span><time className="text-xs text-muted-foreground" dateTime={event.createdAt}>{formatProposalDate(event.createdAt)}</time></div>{proposalEventReason(event) ? <p className="text-xs text-muted-foreground">{proposalEventReason(event)}</p> : null}</li>)}</ol> : <p className="text-xs text-muted-foreground">No hay otros eventos registrados.</p>}
            </section>
          </div>
          {selectedProposal.status === "pending" ? <DialogFooter>
            <Button variant="outline" disabled={busyProposalId !== null} onClick={() => void decideProposal(selectedProposal, "reject")}>{busyProposalId === selectedProposal.id ? "Guardando…" : "Descartar propuesta"}</Button>
            <Button disabled={!canApprove(selectedProposal) || busyProposalId !== null} onClick={() => void decideProposal(selectedProposal, "approve")}><AnimatedIcon name="check" data-icon="inline-start" />{busyProposalId === selectedProposal.id ? "Guardando…" : selectedProposal.kind === "production-profile" ? "Aprobar mapa" : isProductCreation(selectedProposal.title) ? "Aprobar y crear" : "Aprobar y aplicar"}</Button>
          </DialogFooter> : null}
        </> : null}
      </DialogContent>
    </Dialog>
  </>;
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

function ProposalStatusBadge({ status }: { status: AssistantProposal["status"] }) {
  const labels: Record<AssistantProposal["status"], string> = { pending: "Pendiente", approved: "Aprobada", rejected: "Descartada", superseded: "Reemplazada", stale: "Requiere actualización" };
  const variant = status === "approved" ? "secondary" : status === "stale" ? "destructive" : "outline";
  return <Badge variant={variant}>{labels[status]}</Badge>;
}

function proposalEventLabel(type: string) {
  const labels: Record<string, string> = { created: "Propuesta registrada", approved: "Aprobada y aplicada", rejected: "Descartada", superseded: "Reemplazada por otra propuesta", stale: "Marcada para actualizar", approval_failed: "Intento de aprobación fallido" };
  return labels[type] ?? "Evento registrado";
}

function proposalEventActor(event: AssistantProposal["history"][number]) {
  if (event.type === "approved" || event.type === "rejected") return "decisión del usuario";
  if (event.type === "stale" || event.type === "superseded" || event.type === "approval_failed") return "sistema";
  const details = event.details && typeof event.details === "object" ? event.details as Record<string, unknown> : {};
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
