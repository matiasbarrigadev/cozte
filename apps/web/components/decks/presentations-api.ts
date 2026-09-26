"use client";

import { buildBusinessView } from "@/lib/business";
import { analyzeCosts } from "@/lib/cost-analysis";
import { calculateCosts } from "@/lib/domain";
import { DEMO_MONTH, demoBusinessRecords, demoHistory, demoState } from "@/lib/demo";
import {
  DECK_TEMPLATES, DeckError, applyOperations, dataNeeds, fillClosing, newDeck, templateSlides,
  type DeckOperation, type DeckSources, type DeckTemplate, type DeckTheme, type Presentation, type PresentationSummary, type SlideInput,
} from "@/lib/decks";

export type CreateInput = { title?: string; subtitle?: string; theme?: DeckTheme; month?: string; template?: DeckTemplate; slides?: SlideInput[] };
export type EditResult = { presentation: Presentation; done: string[] };

export type PresentationsApi = {
  list(): Promise<PresentationSummary[]>;
  get(id: string): Promise<Presentation>;
  create(input: CreateInput): Promise<Presentation>;
  update(id: string, operations: DeckOperation[]): Promise<EditResult>;
  action(id: string, action: "share" | "unshare" | "undo"): Promise<EditResult>;
  remove(id: string): Promise<void>;
};

export class PresentationRequestError extends Error {
  constructor(message: string, public options: string[] = []) { super(message); }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body ? { "content-type": "application/json" } : undefined });
  const body = await response.json().catch(() => ({})) as { error?: string; options?: string[] };
  if (!response.ok) throw new PresentationRequestError(body.error ?? "No se pudo completar la operación", body.options ?? []);
  return body as T;
}

export const serverPresentations: PresentationsApi = {
  list: () => request<{ presentations: PresentationSummary[] }>("/api/presentations").then((body) => body.presentations),
  get: (id) => request<Presentation>(`/api/presentations/${encodeURIComponent(id)}`),
  create: (input) => request<Presentation>("/api/presentations", { method: "POST", body: JSON.stringify(input) }),
  update: (id, operations) => request<EditResult>(`/api/presentations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ operations }) }),
  action: (id, action) => request<EditResult>(`/api/presentations/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ action }) }),
  remove: (id) => request<{ ok: true }>(`/api/presentations/${encodeURIComponent(id)}`, { method: "DELETE" }).then(() => undefined),
};

export function summarizePresentation(presentation: Presentation): PresentationSummary {
  const { slides, ...deck } = presentation.deck;
  return { ...presentation, deck, slideCount: slides.length, cover: slides[0] ?? null };
}

/** The demo keeps its decks in memory and computes them in the browser with the same engine. */
function demoSources(needs: { months: string[]; history: boolean }): DeckSources {
  const records = demoBusinessRecords();
  const months = needs.months.length ? needs.months : [DEMO_MONTH];
  return {
    state: demoState, costs: calculateCosts(demoState), now: new Date().toISOString(),
    analysis: needs.history ? analyzeCosts(demoHistory(), { granularity: "month", currency: demoState.organization.currency, productNames: Object.fromEntries(demoState.products.map((product) => [product.id, product.name])) }) : null,
    views: Object.fromEntries(months.map((month) => [month, buildBusinessView(demoState, records, month)])),
  };
}

export function createDemoPresentations(): PresentationsApi {
  const decks = new Map<string, Presentation>();
  const history = new Map<string, Presentation[]>();
  const wrap = async <T,>(work: () => T): Promise<T> => {
    try { return work(); } catch (error) { if (error instanceof DeckError) throw new PresentationRequestError(error.message, error.options); throw error; }
  };
  const find = (id: string) => { const deck = decks.get(id); if (!deck) throw new PresentationRequestError("No encontré esa presentación"); return deck; };
  const create = (input: CreateInput): Presentation => {
    const month = input.month ?? DEMO_MONTH;
    const first = demoSources(dataNeeds(null, [{ slides: input.slides ?? [], month }]));
    const base = input.template ? templateSlides(input.template, month, first) : [];
    const closing = base.at(-1)?.layout === "closing" ? base.splice(-1, 1) : [];
    const slides = [...base, ...(input.slides ?? []), ...closing];
    const title = input.title?.trim() || (input.template ? DECK_TEMPLATES[input.template].title : slides[0]?.title) || "Presentación";
    if (input.template && slides[0]?.layout === "cover") slides[0] = { ...slides[0], title };
    const deck = newDeck({ subtitle: input.subtitle, month, slides }, demoSources(dataNeeds(null, [{ slides, month }])), input.template);
    const now = new Date().toISOString();
    const presentation: Presentation = { id: `demo-${Math.random().toString(36).slice(2, 10)}`, title, theme: input.theme ?? "cozte", deck, revision: 1, shareUrl: null, createdAt: now, updatedAt: now };
    decks.set(presentation.id, presentation);
    return presentation;
  };
  create({ template: "ventas" });
  return {
    list: () => wrap(() => [...decks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summarizePresentation)),
    get: (id) => wrap(() => find(id)),
    create: (input) => wrap(() => create(input)),
    update: (id, operations) => wrap(() => {
      const current = find(id);
      const sources = demoSources(dataNeeds(current.deck, operations));
      const result = applyOperations(current.deck, { title: current.title, theme: current.theme }, operations, sources);
      const deck = operations.some((operation) => operation.action === "refresh" || operation.action === "settings") ? fillClosing(result.deck, sources, false) : result.deck;
      history.set(id, [...(history.get(id) ?? []), current].slice(-30));
      const next = { ...current, ...result.meta, deck, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      decks.set(id, next);
      return { presentation: next, done: result.done };
    }),
    action: (id, action) => wrap(() => {
      const current = find(id);
      if (action !== "undo") throw new PresentationRequestError("En la demostración no se pueden compartir links públicos; crea tu cuenta para hacerlo.");
      const previous = history.get(id)?.pop();
      if (!previous) throw new PresentationRequestError("No hay cambios anteriores para deshacer.");
      const next = { ...previous, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      decks.set(id, next);
      return { presentation: next, done: ["Se volvió a la versión anterior"] };
    }),
    remove: (id) => wrap(() => { decks.delete(id); }),
  };
}
