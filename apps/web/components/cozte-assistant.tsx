"use client";

import * as React from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { Check, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import type { DomainState } from "@/lib/domain";
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

const priceProposalSchema = z.object({ kind: z.literal("material-price"), materialId: z.string(), materialName: z.string(), priceMinor: z.number().int().nonnegative(), purchaseUnit: z.string(), affectedProducts: z.array(z.string()).optional() });
type ProfileResponse = { confirmed: ProductionProfile | null; draft: ProductionProfile | null; revision: number };

const suggestions = [
  "Mapear mi producción",
  "Repartir gastos compartidos",
  "Cambió mi proceso",
];

export function CozteAssistant({ state, demo, onMaterialProposal }: {
  state: DomainState; demo: boolean; onMaterialProposal: (materialId: string, priceMinor: number) => void;
}) {
  const [input, setInput] = React.useState("");
  const [profile, setProfile] = React.useState<ProfileResponse | null>(null);
  const [loading, setLoading] = React.useState(!demo);
  const [confirming, setConfirming] = React.useState(false);
  const transport = React.useMemo(() => new DefaultChatTransport({ api: "/api/assistant", prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages.at(-1) } }) }), []);
  const { messages, setMessages, sendMessage, status, error, stop } = useChat<UIMessage>({ transport, onFinish: () => { void loadProfile(); } });

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

  function send(text: string) {
    const value = text.trim();
    if (!value || demo || status !== "ready" || loading) return;
    void sendMessage({ text: value });
    setInput("");
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
                if (parsed.success) return <div key={index} className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-foreground"><strong>{parsed.data.materialName}: {new Intl.NumberFormat("es-CL", { style: "currency", currency: state.organization.currency, maximumFractionDigits: 0 }).format(parsed.data.priceMinor)} por {parsed.data.purchaseUnit}</strong><span className="text-xs text-muted-foreground">Afecta: {parsed.data.affectedProducts?.join(", ") || "sin productos vinculados"}</span><Button size="sm" variant="outline" onClick={() => onMaterialProposal(parsed.data.materialId, parsed.data.priceMinor)}>Agregar al borrador</Button></div>;
              }
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
          {demo ? <Button render={<Link href="/sign-up" />} nativeButton={false}>Crear cuenta para conversar</Button> : <form className="mx-auto w-full max-w-4xl" onSubmit={(event) => { event.preventDefault(); send(input); }}><PromptInput value={input} onValueChange={setInput} onSubmit={() => send(input)} isLoading={status !== "ready"} disabled={loading}><PromptInputTextarea id="cozte-message" aria-label="Mensaje a Cozte" maxLength={2000} placeholder="Cuéntame qué producen o qué cambió…" /><PromptInputActions className="justify-end">{status !== "ready" ? <Button type="button" variant="outline" onClick={stop}>Detener</Button> : null}<Button type="submit" disabled={loading || status !== "ready" || !input.trim()}><Send data-icon="inline-start" />Enviar</Button></PromptInputActions></PromptInput></form>}
        </CardFooter>
    </Card>
  </>;
}
