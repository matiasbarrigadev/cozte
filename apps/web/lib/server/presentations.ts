import "server-only";
import { randomBytes } from "node:crypto";
import { buildBusinessView, businessToday } from "@/lib/business";
import { calculateCosts } from "@/lib/domain";
import { normalizeName } from "@/lib/cozte-cost-view";
import {
  DECK_TEMPLATES, DeckError, applyOperations, dataNeeds, engineAmounts, fillClosing, isDeckTheme, isMonth, newDeck, parseDeck, templateSlides, unbackedAmounts,
  type Deck, type DeckOperation, type DeckSources, type DeckTemplate, type DeckTheme, type Presentation, type PresentationSummary, type SlideInput,
} from "@/lib/decks";
import { ApiError, type Principal } from "./auth";
import { dbBatch, dbQuery } from "./db";
import { loadBusinessRecords, loadDeliveries } from "./business";
import { loadCostAnalysis } from "./cost-insights";
import { loadState } from "./state";

type Row = { id: string; title: string; theme: string; deck_json: string; share_token: string | null; revision: number; created_at: string; updated_at: string };

const MAX_DECK_BYTES = 90_000;
const MAX_VERSIONS = 30;
const COLUMNS = "id, title, theme, deck_json, share_token, revision, created_at, updated_at";

/** Public origin for shared links: the configured site, the production domain on Vercel, or cozte.com. */
export function siteOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return production ? `https://${production}` : "https://cozte.com";
}

export const publicPath = (token: string) => `/p/${token}`;
export const appPresentationPath = (id: string) => `/app/presentaciones/${encodeURIComponent(id)}`;

function toPresentation(row: Row): Presentation {
  const deck = parseDeck(row.deck_json);
  if (!deck) throw new ApiError(500, "La presentación guardada no se pudo leer");
  return {
    id: row.id, title: row.title, theme: isDeckTheme(row.theme) ? row.theme : "cozte", deck, revision: row.revision,
    shareUrl: row.share_token ? `${siteOrigin()}${publicPath(row.share_token)}` : null, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function summarize(presentation: Presentation): PresentationSummary {
  const { slides, ...deck } = presentation.deck;
  return { ...presentation, deck, slideCount: slides.length, cover: slides[0] ?? null };
}

const today = () => businessToday().slice(0, 7);

/** The engine data a deck needs: current costs, each month's business view and, for evolution charts, the history. */
export async function loadDeckSources(principal: Principal, needs: { months: string[]; history: boolean; deliveries?: boolean }): Promise<DeckSources> {
  const months = [...new Set(needs.months.filter(isMonth))].slice(0, 6);
  const [state, analysis, deliveries, ...records] = await Promise.all([
    loadState(principal),
    needs.history ? loadCostAnalysis(principal, "month").catch(() => null) : Promise.resolve(null),
    needs.deliveries ? loadDeliveries(principal, months[0] ?? today()).catch(() => undefined) : Promise.resolve(undefined),
    ...months.map((month) => loadBusinessRecords(principal, month)),
  ]);
  return {
    state, costs: calculateCosts(state), analysis, deliveries, now: new Date().toISOString(), today: businessToday(state.organization.currency),
    views: Object.fromEntries(months.map((month, index) => [month, buildBusinessView(state, records[index], month)])),
  };
}

export async function listPresentations(principal: Principal): Promise<PresentationSummary[]> {
  const rows = await dbQuery<Row>(`SELECT ${COLUMNS} FROM presentations WHERE organization_id=? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 60`, [principal.organizationId]);
  return rows.flatMap((row) => { try { return [summarize(toPresentation(row))]; } catch { return []; } });
}

export async function getPresentation(principal: Principal, id: string): Promise<Presentation> {
  const rows = await dbQuery<Row>(`SELECT ${COLUMNS} FROM presentations WHERE id=? AND organization_id=? AND archived_at IS NULL`, [id, principal.organizationId]);
  if (!rows[0]) throw new ApiError(404, "No encontré esa presentación");
  return toPresentation(rows[0]);
}

/** Finds a deck by id or by (part of) its title; without a reference, the most recently edited one. */
export async function resolvePresentation(principal: Principal, reference?: string): Promise<Presentation> {
  const list = await listPresentations(principal);
  if (!list.length) throw new DeckError("Todavía no hay presentaciones creadas.");
  if (!reference?.trim()) return getPresentation(principal, list[0].id);
  const byId = list.find((item) => item.id === reference.trim());
  if (byId) return getPresentation(principal, byId.id);
  const key = normalizeName(reference);
  const exact = list.filter((item) => normalizeName(item.title) === key);
  const partial = exact.length ? exact : list.filter((item) => normalizeName(item.title).includes(key) || key.includes(normalizeName(item.title)));
  if (partial.length >= 1) return getPresentation(principal, partial[0].id);
  throw new DeckError(`No encontré la presentación "${reference}".`, list.slice(0, 10).map((item) => item.title));
}

function serialize(deck: Deck): string {
  const json = JSON.stringify(deck);
  if (new TextEncoder().encode(json).byteLength > MAX_DECK_BYTES) throw new DeckError("La presentación quedó demasiado grande: quita diapositivas o acorta textos.");
  return json;
}

export type CreatePresentationInput = { title?: string; subtitle?: string; theme?: DeckTheme; month?: string; template?: DeckTemplate; slides?: SlideInput[] };

/** Amounts in the deck's texts that neither its charts nor the engine can back: Cozte must fix them. */
const textWarnings = (deck: Deck, sources: DeckSources) => unbackedAmounts(deck, engineAmounts(sources, deck.month));

export async function createPresentation(principal: Principal, input: CreatePresentationInput): Promise<Presentation & { warnings: string[] }> {
  const month = input.month ?? today();
  if (!isMonth(month)) throw new DeckError(`El mes "${month}" no es válido; usa AAAA-MM.`);
  if (!input.template && !input.slides?.length) throw new DeckError("Indica una plantilla o las diapositivas.");
  // Template slides need the deck's month; custom ones may name their own months and charts.
  const first = await loadDeckSources(principal, dataNeeds(null, [{ slides: input.slides ?? [], month }]));
  const base = input.template ? templateSlides(input.template, month, first) : [];
  // Extra slides join the template before its closing slide, so the deck still ends with the summary.
  const closing = base.at(-1)?.layout === "closing" ? base.splice(-1, 1) : [];
  const slides = [...base, ...(input.slides ?? []), ...closing];
  const sources = input.template ? await loadDeckSources(principal, dataNeeds(null, [{ slides, month }])) : first;
  const title = input.title?.trim() || (input.template ? DECK_TEMPLATES[input.template].title : slides[0]?.title) || "Presentación";
  // The cover takes the deck's title when it came from a template.
  if (input.template && slides[0]?.layout === "cover") slides[0] = { ...slides[0], title, ...(input.subtitle ? { subtitle: input.subtitle } : {}) };
  const deck = newDeck({ subtitle: input.subtitle, month, slides }, sources, input.template);
  const id = crypto.randomUUID();
  const theme = input.theme && isDeckTheme(input.theme) ? input.theme : "cozte";
  await dbBatch([{ sql: "INSERT INTO presentations (id, organization_id, title, theme, deck_json, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)", params: [id, principal.organizationId, title.slice(0, 140), theme, serialize(deck), principal.userId, principal.userId] }]);
  return { ...await getPresentation(principal, id), warnings: textWarnings(deck, sources) };
}

/**
 * Saves a new version of a deck. The previous one goes to the history first, in the same transaction, and only if
 * nobody changed the deck in between; on a race the caller rebuilds from the latest version.
 */
async function writeVersion(principal: Principal, current: Presentation, next: { title: string; theme: DeckTheme; deck: Deck }, note: string): Promise<boolean> {
  const org = principal.organizationId;
  const [, , check] = await dbBatch<{ revision: number }>([
    { sql: "INSERT INTO presentation_versions (id, presentation_id, organization_id, revision, title, theme, deck_json, change_note, created_by) SELECT ?, id, organization_id, revision, title, theme, deck_json, ?, ? FROM presentations WHERE id=? AND organization_id=? AND revision=?", params: [crypto.randomUUID(), note.slice(0, 500), principal.userId, current.id, org, current.revision] },
    { sql: "UPDATE presentations SET title=?, theme=?, deck_json=?, revision=revision+1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND revision=?", params: [next.title, next.theme, serialize(next.deck), principal.userId, current.id, org, current.revision] },
    { sql: "SELECT revision FROM presentations WHERE id=? AND organization_id=?", params: [current.id, org] },
    { sql: `DELETE FROM presentation_versions WHERE presentation_id=? AND id NOT IN (SELECT id FROM presentation_versions WHERE presentation_id=? ORDER BY revision DESC LIMIT ${MAX_VERSIONS})`, params: [current.id, current.id] },
  ]);
  return check[0]?.revision === current.revision + 1;
}

export async function updatePresentation(principal: Principal, id: string, operations: DeckOperation[]): Promise<{ presentation: Presentation; done: string[]; warnings: string[] }> {
  if (!operations.length) throw new DeckError("No indicaste ningún cambio.");
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await getPresentation(principal, id);
    const sources = await loadDeckSources(principal, dataNeeds(current.deck, operations));
    const result = applyOperations(current.deck, { title: current.title, theme: current.theme }, operations, sources);
    const deck = operations.some((operation) => operation.action === "refresh" || operation.action === "settings") ? fillClosing(result.deck, sources, false) : result.deck;
    if (await writeVersion(principal, current, { ...result.meta, deck }, result.done.join(" · "))) return { presentation: await getPresentation(principal, id), done: result.done, warnings: textWarnings(deck, sources) };
    await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
  }
  throw new ApiError(409, "La presentación cambió mientras se editaba; vuelve a intentarlo");
}

/** Goes back to the version before the last change. The undone version is dropped, so undoing again goes further back. */
export async function undoPresentation(principal: Principal, id: string): Promise<{ presentation: Presentation; done: string[] }> {
  const current = await getPresentation(principal, id);
  const rows = await dbQuery<{ id: string; title: string; theme: string; deck_json: string; change_note: string }>("SELECT id, title, theme, deck_json, change_note FROM presentation_versions WHERE presentation_id=? AND organization_id=? ORDER BY revision DESC LIMIT 1", [id, principal.organizationId]);
  const previous = rows[0];
  const deck = previous ? parseDeck(previous.deck_json) : null;
  if (!previous || !deck) throw new DeckError("No hay cambios anteriores para deshacer.");
  const [, , check] = await dbBatch<{ revision: number }>([
    { sql: "DELETE FROM presentation_versions WHERE id=? AND organization_id=?", params: [previous.id, principal.organizationId] },
    { sql: "UPDATE presentations SET title=?, theme=?, deck_json=?, revision=revision+1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND revision=?", params: [previous.title, previous.theme, previous.deck_json, principal.userId, id, principal.organizationId, current.revision] },
    { sql: "SELECT revision FROM presentations WHERE id=? AND organization_id=?", params: [id, principal.organizationId] },
  ]);
  if (check[0]?.revision !== current.revision + 1) throw new ApiError(409, "La presentación cambió mientras se deshacía; vuelve a intentarlo");
  return { presentation: await getPresentation(principal, id), done: [previous.change_note ? `Deshecho: ${previous.change_note}` : "Se volvió a la versión anterior"] };
}

/** Opens or closes the public link. Closing it invalidates the old link for good. */
export async function setPresentationSharing(principal: Principal, id: string, shared: boolean): Promise<Presentation> {
  const current = await getPresentation(principal, id);
  if (shared && current.shareUrl) return current;
  const token = shared ? randomBytes(18).toString("base64url") : null;
  await dbBatch([{ sql: "UPDATE presentations SET share_token=?, shared_at=CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END, updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?", params: [token, token, id, principal.organizationId] }]);
  return getPresentation(principal, id);
}

export async function archivePresentation(principal: Principal, id: string): Promise<void> {
  await getPresentation(principal, id);
  await dbBatch([{ sql: "UPDATE presentations SET archived_at=CURRENT_TIMESTAMP, share_token=NULL WHERE id=? AND organization_id=?", params: [id, principal.organizationId] }]);
}

/** A shared deck for anyone with the link; only what the deck itself contains, never the organization's data. */
export async function loadSharedPresentation(token: string): Promise<Presentation | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const rows = await dbQuery<Row>(`SELECT ${COLUMNS} FROM presentations WHERE share_token=? AND archived_at IS NULL`, [token]);
  if (!rows[0]) return null;
  try { return toPresentation(rows[0]); } catch { return null; }
}
