"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { Check, Mic, Paperclip, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supportedCurrencies, type Currency } from "@/lib/currency";
import type { ProductionProfile } from "@/lib/production-profile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from "@/components/ui/chat-container";
import { PromptInput, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { PromptSuggestion } from "@/components/ui/prompt-suggestion";
import { TextShimmer } from "@/components/ui/text-shimmer";

const priceProposalSchema = z.object({ kind: z.literal("material-price"), materialId: z.string(), materialName: z.string(), amount: z.number().nonnegative(), currency: z.enum(supportedCurrencies), converted: z.number().int().nonnegative(), baseCurrency: z.enum(supportedCurrencies), purchaseUnit: z.string(), affectedProducts: z.array(z.string()).optional() });
const expenseProposalSchema = z.object({ kind: z.literal("expense-amount"), expenseId: z.string(), expenseName: z.string(), amount: z.number().nonnegative(), currency: z.enum(supportedCurrencies), converted: z.number().int().nonnegative(), baseCurrency: z.enum(supportedCurrencies), affectedProducts: z.array(z.string()).optional() });
type ProfileResponse = { confirmed: ProductionProfile | null; draft: ProductionProfile | null; revision: number };

const suggestions = [
  "Mapear mi producción",
  "Repartir gastos compartidos",
  "Cambió mi proceso",
];

export function CozteAssistant({ demo, onMaterialProposal, onExpenseProposal }: {
  demo: boolean; onMaterialProposal: (materialId: string, amount: number, currency: Currency) => void; onExpenseProposal: (expenseId: string, amount: number, currency: Currency) => void;
}) {
  const [input, setInput] = React.useState("");
  const [attachment, setAttachment] = React.useState<File | null>(null);
  const [preparing, setPreparing] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const recognition = React.useRef<{ stop: () => void } | null>(null);
  const [profile, setProfile] = React.useState<ProfileResponse | null>(null);
  const [loading, setLoading] = React.useState(!demo);
  const [confirming, setConfirming] = React.useState(false);
  const transport = React.useMemo(() => new DefaultChatTransport({ api: "/api/assistant", prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages.at(-1) } }) }), []);
  const { messages, setMessages, sendMessage, status, error, stop } = useChat<UIMessage>({ transport,
    onFinish: ({ message, isError, isAbort }) => {
      void loadProfile();
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

  React.useEffect(() => {
    if (demo) return;
    let active = true;
    Promise.all([fetch("/api/assistant", { cache: "no-store" }), fetch("/api/production-profile", { cache: "no-store" })]).then(async ([chatResponse, profileResponse]) => {
      if (!chatResponse.ok || !profileResponse.ok) throw new Error("No se pudo cargar Cozte");
      const [chat, process] = await Promise.all([chatResponse.json(), profileResponse.json()]);
      if (active) { setMessages(chat.messages ?? []); setProfile(process); }
    }).catch(() => { if (active) toast.error("No se pudo recuperar la conversación"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [demo, setMessages]);

  async function send(text: string) {
    const value = text.trim();
    if ((!value && !attachment) || demo || status !== "ready" || loading || preparing) return;
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
      await sendMessage({ text: message, files });
      setInput("");
      setAttachment(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo leer el archivo"); }
    finally { setPreparing(false); }
  }

  function toggleMicrophone() {
    if (listening) { recognition.current?.stop(); return; }
    type SpeechResult = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
    type SpeechRecognition = { lang: string; interimResults: boolean; onresult: ((event: SpeechResult) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void };
    const browser = window as Window & { SpeechRecognition?: new () => SpeechRecognition; webkitSpeechRecognition?: new () => SpeechRecognition };
    const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor) { toast.error("Tu navegador no ofrece dictado por voz. Puedes escribir el mensaje."); return; }
    const session = new Constructor();
    session.lang = "es-419";
    session.interimResults = false;
    session.onresult = (event) => setInput((current) => `${current}${current ? " " : ""}${event.results[0]?.[0]?.transcript ?? ""}`);
    session.onend = () => { setListening(false); recognition.current = null; };
    session.onerror = () => { setListening(false); toast.error("No se pudo transcribir. Revisa el permiso del micrófono."); };
    recognition.current = session;
    session.start();
    setListening(true);
  }

  async function confirmProfile() {
    if (!profile?.draft || confirming) return;
    setConfirming(true);
    try {
      const response = await fetch("/api/production-profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: profile.revision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo confirmar el mapa");
      setProfile(data);
      toast.success("Mapa de producción confirmado");
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se pudo confirmar"); }
    finally { setConfirming(false); }
  }

  return <>
    <h1 className="text-3xl font-semibold tracking-tight">Cozte AI</h1>
    <Card className="flex h-[calc(100dvh-11rem)] min-h-[30rem] min-w-0 flex-col gap-0 overflow-hidden py-0">
        <CardContent className="flex min-h-0 flex-1 flex-col px-4 py-5 md:px-8"><ChatContainerRoot className="min-h-0 flex-1" aria-live="polite"><ChatContainerContent className="mx-auto min-h-full max-w-4xl gap-4">
          {!messages.length ? <Empty className="my-auto"><EmptyHeader><EmptyMedia variant="icon"><Sparkles /></EmptyMedia><EmptyTitle>Empecemos por tu producción</EmptyTitle><EmptyDescription>¿Qué productos terminados y empacados fabrican, dónde y cómo?</EmptyDescription></EmptyHeader></Empty> : null}
          {messages.map((message) => <div key={message.id} className={message.role === "user" ? "ml-auto flex max-w-[88%] flex-col gap-2 rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground" : "flex max-w-[94%] flex-col gap-2 rounded-xl bg-muted px-4 py-3 text-sm"}>
            <span className="text-xs font-semibold">{message.role === "user" ? "Tú" : "Cozte"}</span>
            {message.parts.map((part, index) => {
              if (part.type === "text") return <p key={index} className="whitespace-pre-wrap leading-relaxed">{part.text}</p>;
              if (isToolUIPart(part) && part.state === "output-available" && part.type === "tool-proposeMaterialPrice") {
                const parsed = priceProposalSchema.safeParse(part.output);
                if (parsed.success) return <div key={index} className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-foreground"><strong>{parsed.data.materialName}: {new Intl.NumberFormat("es-CL", { style: "currency", currency: parsed.data.currency, maximumFractionDigits: 3 }).format(parsed.data.amount)} por {parsed.data.purchaseUnit}</strong><span className="text-xs text-muted-foreground">Equivale a {new Intl.NumberFormat("es-CL", { style: "currency", currency: parsed.data.baseCurrency, maximumFractionDigits: 0 }).format(parsed.data.converted)} · Afecta: {parsed.data.affectedProducts?.join(", ") || "sin productos vinculados"}</span><Button size="sm" variant="outline" onClick={() => onMaterialProposal(parsed.data.materialId, parsed.data.amount, parsed.data.currency)}>Agregar al borrador</Button></div>;
              }
              if (isToolUIPart(part) && part.state === "output-available" && part.type === "tool-proposeExpenseAmount") {
                const parsed = expenseProposalSchema.safeParse(part.output);
                if (parsed.success) return <div key={index} className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-foreground"><strong>{parsed.data.expenseName}: {new Intl.NumberFormat("es-CL", { style: "currency", currency: parsed.data.currency, maximumFractionDigits: 3 }).format(parsed.data.amount)}</strong><span className="text-xs text-muted-foreground">Equivale a {new Intl.NumberFormat("es-CL", { style: "currency", currency: parsed.data.baseCurrency, maximumFractionDigits: 0 }).format(parsed.data.converted)} · Afecta: {parsed.data.affectedProducts?.join(", ") || "sin productos"}</span><Button size="sm" variant="outline" onClick={() => onExpenseProposal(parsed.data.expenseId, parsed.data.amount, parsed.data.currency)}>Agregar al borrador</Button></div>;
              }
              if (part.type === "file" && part.mediaType.startsWith("image/")) return <Image key={index} src={part.url} alt={part.filename ?? "Imagen adjunta"} width={320} height={224} unoptimized className="max-h-56 max-w-full rounded-md object-contain" />;
              if (isToolUIPart(part) && part.state === "output-available" && part.type === "tool-proposeProductionProfile") return <Badge key={index} variant="secondary">Propuesta de producción preparada</Badge>;
              if (isToolUIPart(part) && part.state === "output-available") {
                const label = part.type === "tool-inspectCostBase" ? "Base de costos revisada" : part.type === "tool-calculateCostRule" ? "Regla calculada por el motor" : part.type === "tool-findMaterial" ? "Insumo contrastado" : "Herramienta utilizada";
                return <Badge key={index} variant="outline">{label}</Badge>;
              }
              if (isToolUIPart(part) && (part.state === "input-streaming" || part.state === "input-available")) return <TextShimmer key={index} className="text-xs">Consultando datos…</TextShimmer>;
              return null;
            })}
          </div>)}
          {profile?.draft ? <Card size="sm" className="max-w-[94%] gap-2 self-start"><CardContent className="flex flex-col gap-3 py-3 text-sm"><div><strong>Propuesta para revisar</strong><p className="text-muted-foreground">{profile.draft.site?.name ?? "Lugar por definir"} · {profile.draft.products.map((product) => product.name).join(", ") || "Productos por definir"}</p></div><Button size="sm" disabled={confirming || demo} onClick={() => void confirmProfile()}><Check data-icon="inline-start" />{confirming ? "Confirmando…" : "Confirmar propuesta"}</Button></CardContent></Card> : null}
          {status === "submitted" || status === "streaming" ? <TextShimmer className="text-sm">Cozte está analizando…</TextShimmer> : null}
          <ChatContainerScrollAnchor />
        </ChatContainerContent></ChatContainerRoot></CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3 border-t px-4 py-4 md:px-8">
          {error ? <Alert variant="destructive"><AlertTitle>No se pudo completar la respuesta</AlertTitle><AlertDescription>{error.message || "Intenta otra vez."}</AlertDescription></Alert> : null}
          {!messages.length ? <div className="flex flex-wrap gap-2">{suggestions.map((item) => <PromptSuggestion key={item} size="sm" disabled={demo || loading} onClick={() => send(item)}>{item}</PromptSuggestion>)}</div> : null}
          {demo ? <Button render={<Link href="/sign-up" />} nativeButton={false}>Crear cuenta para conversar</Button> : <form className="mx-auto w-full max-w-4xl" onSubmit={(event) => { event.preventDefault(); void send(input); }}><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,.xlsx" className="sr-only" aria-label="Adjuntar imagen o Excel" onChange={(event) => { const file = event.target.files?.[0]; if (file) setAttachment(file); }} />{attachment ? <div className="mb-2 flex items-center gap-2 text-xs"><Badge variant="secondary">{attachment.name}</Badge><Button type="button" size="icon-xs" variant="ghost" aria-label="Quitar archivo" onClick={() => { setAttachment(null); if (fileInput.current) fileInput.current.value = ""; }}><X /></Button></div> : null}<PromptInput value={input} onValueChange={setInput} onSubmit={() => void send(input)} isLoading={status !== "ready" || preparing} disabled={loading}><PromptInputTextarea id="cozte-message" aria-label="Mensaje a Cozte" maxLength={2000} placeholder="Cuéntame qué producen o qué cambió…" /><PromptInputActions className="justify-end"><Button type="button" size="icon-sm" variant="ghost" aria-label="Adjuntar imagen o Excel" title="Adjuntar imagen o Excel" onClick={() => fileInput.current?.click()}><Paperclip /></Button><Button type="button" size="icon-sm" variant={listening ? "destructive" : "ghost"} aria-label={listening ? "Detener dictado" : "Dictar mensaje"} title={listening ? "Detener dictado" : "Dictar mensaje"} onClick={toggleMicrophone}><Mic /></Button>{status !== "ready" ? <Button type="button" variant="outline" onClick={stop}>Detener</Button> : null}<Button type="submit" disabled={loading || preparing || status !== "ready" || (!input.trim() && !attachment)}><Send data-icon="inline-start" />Enviar</Button></PromptInputActions></PromptInput></form>}
        </CardFooter>
    </Card>
  </>;
}
