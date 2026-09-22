"use client";

import * as React from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { Bot, Check, ClipboardCheck, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import type { DomainState } from "@/lib/domain";
import { allocateRecurringCost, inputCostPerFinishedUnit, monthlyEquivalent, type ProductionProfile, type ProfileCost } from "@/lib/production-profile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from "@/components/ui/chat-container";
import { PromptInput, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { PromptSuggestion } from "@/components/ui/prompt-suggestion";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const priceProposalSchema = z.object({ kind: z.literal("material-price"), materialId: z.string(), materialName: z.string(), priceMinor: z.number().int().nonnegative(), purchaseUnit: z.string(), affectedProducts: z.array(z.string()).optional() });
type ProfileResponse = { confirmed: ProductionProfile | null; draft: ProductionProfile | null; revision: number; gaps: string[]; costs: ProfileCost[] };

const suggestions = [
  "Fabricamos tres productos en un mismo taller. Quiero mapear el proceso.",
  "Quiero revisar cómo repartimos electricidad y mano de obra.",
  "Cambió nuestro proceso de empaque. Revisemos los costos.",
];

export function CozteAssistant({ state, demo, onMaterialProposal, onOpenProductionCosts }: {
  state: DomainState; demo: boolean; onMaterialProposal: (materialId: string, priceMinor: number) => void; onOpenProductionCosts: () => void;
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

  const activeProfile = profile?.draft ?? profile?.confirmed;
  const money = (value: number | null) => value === null ? "Falta dato" : new Intl.NumberFormat("es-CL", { style: "currency", currency: state.organization.currency, maximumFractionDigits: 2 }).format(value);
  return <>
    <div><p className="text-sm text-muted-foreground">Tu copiloto de producción</p><h1 className="text-3xl font-semibold tracking-tight">Cozte</h1><p className="text-sm text-muted-foreground">Entiende tu proceso y te ayuda a mantener los costos al día.</p></div>
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="min-w-0"><CardHeader><CardTitle className="flex items-center gap-2"><Bot className="size-5" /> Conversación</CardTitle><CardDescription>{state.organization.name} · {state.products.length} productos en la planilla</CardDescription></CardHeader>
        <CardContent><ChatContainerRoot className="max-h-[58vh] min-h-80" aria-live="polite"><ChatContainerContent className="gap-4">
          {!messages.length ? <Empty><EmptyHeader><EmptyMedia variant="icon"><Sparkles /></EmptyMedia><EmptyTitle>Empecemos por tu producción</EmptyTitle><EmptyDescription>¿Qué productos terminados y empacados fabrican, dónde y cómo?</EmptyDescription></EmptyHeader></Empty> : null}
          {messages.map((message) => <div key={message.id} className={message.role === "user" ? "ml-auto flex max-w-[88%] flex-col gap-2 rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground" : "flex max-w-[94%] flex-col gap-2 rounded-xl bg-muted px-4 py-3 text-sm"}>
            <span className="text-xs font-semibold">{message.role === "user" ? "Tú" : "Cozte"}</span>
            {message.parts.map((part, index) => {
              if (part.type === "text") return <p key={index} className="whitespace-pre-wrap leading-relaxed">{part.text}</p>;
              if (isToolUIPart(part) && part.state === "output-available" && part.type === "tool-proposeMaterialPrice") {
                const parsed = priceProposalSchema.safeParse(part.output);
                if (parsed.success) return <div key={index} className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-foreground"><strong>{parsed.data.materialName}: {new Intl.NumberFormat("es-CL", { style: "currency", currency: state.organization.currency, maximumFractionDigits: 0 }).format(parsed.data.priceMinor)} por {parsed.data.purchaseUnit}</strong><span className="text-xs text-muted-foreground">Afecta: {parsed.data.affectedProducts?.join(", ") || "sin productos vinculados"}</span><Button size="sm" variant="outline" onClick={() => onMaterialProposal(parsed.data.materialId, parsed.data.priceMinor)}>Agregar al borrador</Button></div>;
              }
              if (isToolUIPart(part) && part.state === "output-available" && part.type === "tool-proposeProductionProfile") return <Badge key={index} variant="secondary">Mapa de producción propuesto · revisar a la derecha</Badge>;
              if (isToolUIPart(part) && part.state === "output-available") {
                const label = part.type === "tool-inspectCostBase" ? "Base de costos revisada" : part.type === "tool-calculateCostRule" ? "Regla calculada por el motor" : part.type === "tool-findMaterial" ? "Insumo contrastado" : "Herramienta utilizada";
                return <Badge key={index} variant="outline">{label}</Badge>;
              }
              if (isToolUIPart(part) && (part.state === "input-streaming" || part.state === "input-available")) return <TextShimmer key={index} className="text-xs">Consultando datos…</TextShimmer>;
              return null;
            })}
          </div>)}
          {status === "submitted" || status === "streaming" ? <TextShimmer className="text-sm">Cozte está analizando…</TextShimmer> : null}
          <ChatContainerScrollAnchor />
        </ChatContainerContent></ChatContainerRoot></CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3 border-t">
          {error ? <Alert variant="destructive"><AlertTitle>No se pudo completar la respuesta</AlertTitle><AlertDescription>{error.message || "Intenta otra vez."}</AlertDescription></Alert> : null}
          {!messages.length ? <div className="flex flex-wrap gap-2">{suggestions.map((item) => <PromptSuggestion key={item} size="sm" disabled={demo || loading} onClick={() => send(item)}>{item}</PromptSuggestion>)}</div> : null}
          {demo ? <Button render={<Link href="/sign-up" />} nativeButton={false}>Crear cuenta para conversar</Button> : <form className="flex w-full flex-col gap-2" onSubmit={(event) => { event.preventDefault(); send(input); }}><label className="text-sm font-medium" htmlFor="cozte-message">Mensaje a Cozte</label><PromptInput value={input} onValueChange={setInput} onSubmit={() => send(input)} isLoading={status !== "ready"} disabled={loading}><PromptInputTextarea id="cozte-message" maxLength={2000} placeholder="Cuéntame qué producen o qué cambió…" /><PromptInputActions className="justify-end">{status !== "ready" ? <Button type="button" variant="outline" onClick={stop}>Detener</Button> : null}<Button type="submit" disabled={loading || status !== "ready" || !input.trim()}><Send data-icon="inline-start" />Enviar</Button></PromptInputActions></PromptInput></form>}
        </CardFooter>
      </Card>
      <div className="flex flex-col gap-4"><Card><CardHeader><CardTitle>Mapa de producción</CardTitle><CardDescription>{profile?.draft ? "Propuesta pendiente de revisión" : profile?.confirmed ? "Configuración confirmada" : "Se construye conversando con Cozte"}</CardDescription></CardHeader><CardContent className="flex flex-col gap-4 text-sm">
        {activeProfile ? <>
          <div><span className="text-muted-foreground">Lugar</span><p className="font-medium">{activeProfile.site?.name ?? "Por definir"}</p></div>
          <div><span className="text-muted-foreground">Productos</span><div className="mt-1 flex flex-wrap gap-1">{activeProfile.products.length ? activeProfile.products.map((item) => <Badge key={item.name} variant="secondary">{item.name}</Badge>) : "Por definir"}</div></div>
          <div><span className="text-muted-foreground">Etapas</span><p>{activeProfile.stages.map((item) => item.name).join(" → ") || "Por definir"}</p></div>
          <div><span className="text-muted-foreground">Categorías acordadas</span><div className="mt-1 flex flex-wrap gap-1">{activeProfile.categories.length ? activeProfile.categories.map((item) => <Badge key={item.name} variant="outline">{item.name}</Badge>) : "Por definir"}</div></div>
          <div><span className="text-muted-foreground">Reglas</span><p>{activeProfile.inputs.length} insumos directos · {activeProfile.recurringCosts.length} gastos recurrentes</p></div>
        </> : <p className="text-muted-foreground">Empieza contándome qué fabrican y en qué lugar.</p>}
        {profile?.gaps.length ? <Alert><AlertTitle>Para afinar el costeo</AlertTitle><AlertDescription><ul className="flex list-disc flex-col gap-1 pl-4">{profile.gaps.slice(0, 5).map((gap) => <li key={gap}>{gap}</li>)}</ul>{profile.gaps.length > 5 ? <span>Y {profile.gaps.length - 5} puntos más.</span> : null}</AlertDescription></Alert> : null}
      </CardContent><CardFooter className="flex flex-col items-stretch gap-2">{profile?.draft ? <Button disabled={confirming || demo} onClick={() => void confirmProfile()}><Check data-icon="inline-start" />Confirmar mapa</Button> : null}<Button variant="outline" onClick={onOpenProductionCosts}><ClipboardCheck data-icon="inline-start" />Costos de producción</Button></CardFooter></Card>
      <p className="px-1 text-xs text-muted-foreground">El mapa orienta la entrevista y muestra brechas; sus propuestas no modifican importes de la planilla sin tu aprobación.</p></div>
    </div>
    {profile?.costs.length ? <Card><CardHeader><CardTitle>Vista calculada del proceso</CardTitle><CardDescription>{profile.draft ? "Previsualización de la propuesta; aún no aprobada" : "Mapa confirmado"} · costo de fabricación hasta producto terminado y empacado.</CardDescription></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Producto</TableHead><TableHead className="text-right">Directo mensual</TableHead><TableHead className="text-right">Compartido mensual</TableHead><TableHead className="text-right">Por unidad apta</TableHead></TableRow></TableHeader><TableBody>{profile.costs.map((cost) => <TableRow key={cost.product}><TableCell className="font-medium">{cost.product}{cost.warnings.length ? <div className="text-xs text-muted-foreground">{cost.warnings[0]}</div> : null}</TableCell><TableCell className="text-right tabular-nums">{money(cost.directMonthlyMinor)}</TableCell><TableCell className="text-right tabular-nums">{money(cost.sharedMonthlyMinor)}</TableCell><TableCell className="text-right font-semibold tabular-nums">{money(cost.unitMinor)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card> : null}
    {activeProfile && (activeProfile.inputs.length > 0 || activeProfile.recurringCosts.length > 0) ? <Card><CardHeader><CardTitle>Reglas descubiertas</CardTitle><CardDescription>Conversión y reparto definidos como datos; “falta dato” nunca equivale a cero.</CardDescription></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Costo</TableHead><TableHead>Regla</TableHead><TableHead>Referencia</TableHead></TableRow></TableHeader><TableBody>
      {activeProfile.inputs.flatMap((item) => item.usage.map((usage) => { const product = activeProfile.products.find((entry) => entry.name === usage.product); return <TableRow key={`${item.name}-${usage.product}`}><TableCell><strong>{item.name}</strong><div className="text-xs text-muted-foreground">{item.category} · {usage.product}</div></TableCell><TableCell>{item.unitsPerPurchase == null ? "Conversión pendiente" : `1 ${item.purchaseUnit} = ${item.unitsPerPurchase} ${item.consumptionUnit}`}<div className="text-xs text-muted-foreground">{usage.quantityPerBatch == null ? "Consumo pendiente" : `${usage.quantityPerBatch} ${item.consumptionUnit} por lote`}</div></TableCell><TableCell>{product ? money(inputCostPerFinishedUnit(item, product)) : "Producto pendiente"} / unidad apta</TableCell></TableRow>; }))}
      {activeProfile.recurringCosts.map((item) => { const allocation = allocateRecurringCost(item, activeProfile.products); return <TableRow key={item.name}><TableCell><strong>{item.name}</strong><div className="text-xs text-muted-foreground">{item.category}</div></TableCell><TableCell>{item.frequency === "annual" ? "Anual" : item.frequency === "quarterly" ? "Trimestral" : "Mensual"} · {item.allocation === "production_hours" ? "por horas" : item.allocation === "finished_units" ? "por unidades aptas" : "por porcentajes"}</TableCell><TableCell>{item.amountMinor === null ? "Importe pendiente" : `${money(monthlyEquivalent(item.amountMinor, item.frequency))} / mes`}{allocation ? <div className="text-xs text-muted-foreground">{Object.entries(allocation).map(([product, amount]) => `${product}: ${money(amount)}`).join(" · ")}</div> : <div className="text-xs text-muted-foreground">Reparto pendiente</div>}</TableCell></TableRow>; })}
    </TableBody></Table></CardContent></Card> : null}
  </>;
}
