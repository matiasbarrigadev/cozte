import "server-only";
import { dbBatch, dbQuery } from "./db";

/**
 * Prices from the web: Cozte searches current pages and reads the lines that carry prices, always with the page and
 * the date. What pages say is data, never instructions. Each company has a monthly allowance of searches.
 */

export type WebResult = { title: string; url: string; snippet: string; excerpt?: string };
export type WebSearch = { ok: true; query: string; searchedAt: string; country: string; results: WebResult[]; remainingThisMonth: number } | { ok: false; error: string };

const ENDPOINT = "https://api.firecrawl.dev/v2/search";
export const webSearchMonthlyLimit = () => Math.max(1, Number(process.env.COZTE_WEB_SEARCH_MONTHLY_LIMIT ?? 60));

/** Keeps the text readable as data: no tags, no runs of whitespace, a bounded length. */
const clean = (text: string, max: number) => text.replace(/<[^>]*>/g, " ").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** The lines of a page that talk about prices, not the whole page. */
export function priceExcerpt(markdown: string, max = 1500): string {
  const lines = markdown.split(/\r?\n/).map((line) => line.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim()).filter(Boolean);
  const priced = lines.filter((line) => /\d/.test(line) && /(\$|ars|clp|uyu|pyg|cop|mxn|pen|bob|usd|eur|precio|valor|kg|kilo|gramo|litro|\blt\b|\bl\b|unidad|bolsa|caja|pack|tarifa|kwh|m3|por\s)/i.test(line) && line.length <= 300);
  const text = (priced.length ? priced : lines).join(" · ");
  return clean(text, max);
}

async function usedThisMonth(organizationId: string): Promise<number> {
  const [row] = await dbQuery<{ used: number }>("SELECT COUNT(*) AS used FROM web_searches WHERE organization_id=? AND created_at >= datetime('now', '-30 days')", [organizationId]);
  return row?.used ?? 0;
}

/**
 * One web search for a company. `readPages` also reads the top pages and keeps their price lines (more credits);
 * `recent` keeps only pages from the last month.
 */
export async function searchWeb(organizationId: string, input: { query: string; country?: string | null; readPages?: boolean; recent?: boolean; purpose: "chat" | "monthly" }, fetcher: typeof fetch = fetch): Promise<WebSearch> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return { ok: false, error: "La búsqueda web todavía no está configurada en Cozte. Pedile a la persona el precio o usá una estimación marcada como tal." };
  const query = clean(input.query, 300);
  if (query.length < 3) return { ok: false, error: "Escribí qué precio buscar (producto, presentación y lugar)." };
  const limit = webSearchMonthlyLimit();
  const used = await usedThisMonth(organizationId);
  if (used >= limit) return { ok: false, error: `Ya se usaron las ${limit} búsquedas web de este mes. Pedile a la persona el precio o usá el último que tengas.` };
  const country = (input.country || "AR").toUpperCase();
  let body: { success?: boolean; data?: { web?: { url?: string; title?: string; description?: string; markdown?: string }[] }; creditsUsed?: number; error?: string };
  try {
    const response = await fetcher(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        query, limit: input.readPages ? 3 : 5, country, sources: ["web"], timeout: 45_000,
        ...(input.recent ? { tbs: "qdr:m" } : {}),
        ...(input.readPages ? { scrapeOptions: { formats: [{ type: "markdown" }], onlyMainContent: true } } : {}),
      }),
      signal: AbortSignal.timeout(55_000),
    });
    body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      console.error("Web search failed", response.status, body.error);
      return { ok: false, error: response.status === 402 ? "La búsqueda web se quedó sin créditos este mes." : "La búsqueda web no respondió. Probá de nuevo en un rato o pedile el precio a la persona." };
    }
  } catch (error) {
    console.error("Web search unreachable", error);
    return { ok: false, error: "La búsqueda web no respondió. Probá de nuevo en un rato o pedile el precio a la persona." };
  }
  const results: WebResult[] = (body.data?.web ?? []).filter((item) => item.url && /^https?:\/\//.test(item.url)).map((item) => ({
    title: clean(item.title ?? item.url ?? "", 160),
    url: item.url!.slice(0, 500),
    snippet: clean(item.description ?? "", 300),
    ...(input.readPages && item.markdown ? { excerpt: priceExcerpt(item.markdown) } : {}),
  }));
  await dbBatch([{ sql: "INSERT INTO web_searches (id, organization_id, query, purpose, results, credits) VALUES (?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), organizationId, query, input.purpose, results.length, Math.max(0, Math.round(body.creditsUsed ?? 0))] }]);
  return { ok: true, query, searchedAt: new Date().toISOString().slice(0, 10), country, results, remainingThisMonth: Math.max(0, limit - used - 1) };
}
