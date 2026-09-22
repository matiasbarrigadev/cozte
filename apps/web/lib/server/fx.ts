import "server-only";
import { z } from "zod";
import { makeQuote, supportedCurrencies, type Currency, type FxQuote } from "@/lib/currency";
import { ApiError } from "./auth";
import { dbQuery } from "./db";

type FxTable = { asOf: string; rates: Record<string, number>; source: FxQuote["source"] };
const marketSchema = z.object({ success: z.literal(true), base: z.literal("USD"), date: z.iso.datetime(), rates: z.record(z.string(), z.number().positive()) });
const bankSchema = z.object({ results: z.object({ fecha: z.iso.date(), detalle: z.array(z.object({ codigoMoneda: z.string(), tipoCotizacion: z.number() })) }) });
const hourSlot = () => new Date().toISOString().slice(0, 13);
let memory: { slot: string; table: FxTable } | null = null;

async function fetchMarket(): Promise<FxTable> {
  const url = new URL("https://api.fxratesapi.com/latest");
  url.searchParams.set("base", "USD");
  url.searchParams.set("currencies", supportedCurrencies.filter((currency) => currency !== "USD").join(","));
  url.searchParams.set("resolution", "1h");
  const response = await fetch(url, { headers: process.env.FXRATES_API_KEY ? { Authorization: `Bearer ${process.env.FXRATES_API_KEY}` } : {}, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`FXRatesAPI HTTP ${response.status}`);
  const parsed = marketSchema.parse(await response.json());
  if (!parsed.rates.CLP || !parsed.rates.ARS || !parsed.rates.BRL || !parsed.rates.EUR) throw new Error("FXRatesAPI missing currencies");
  return { asOf: parsed.date, rates: parsed.rates, source: "FXRatesAPI" };
}

async function fetchBank(): Promise<FxTable> {
  const response = await fetch("https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones", { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`BCRA HTTP ${response.status}`);
  const parsed = bankSchema.parse(await response.json());
  const rates = Object.fromEntries(parsed.results.detalle.filter((item) => supportedCurrencies.includes(item.codigoMoneda as Currency) && item.tipoCotizacion > 0).map((item) => [item.codigoMoneda, item.tipoCotizacion]));
  if (!rates.USD || !rates.CLP) throw new Error("BCRA missing currencies");
  return { asOf: parsed.results.fecha, rates, source: "BCRA" };
}

function valid(table: FxTable): boolean {
  const age = Date.now() - new Date(table.asOf).getTime();
  const maxAge = table.source === "FXRatesAPI" ? 3 * 3_600_000 : 7 * 86_400_000;
  return Number.isFinite(age) && age < maxAge && age > -86_400_000;
}

async function latestStored(): Promise<FxTable | null> {
  const rows = await dbQuery<{ as_of: string; rates_json: string; source: FxQuote["source"] }>("SELECT as_of, rates_json, source FROM fx_publications ORDER BY hour_slot DESC LIMIT 1");
  if (!rows.length) return null;
  const table: FxTable = { asOf: rows[0].as_of, rates: JSON.parse(rows[0].rates_json), source: rows[0].source };
  return valid(table) ? table : null;
}

// D1 lease: one refresh per UTC hour across all Vercel instances and organizations.
export async function officialFxTable(): Promise<FxTable> {
  const slot = hourSlot();
  if (memory?.slot === slot && valid(memory.table)) return memory.table;
  const stored = await latestStored();
  const owner = crypto.randomUUID();
  const claimed = await dbQuery<{ owner: string }>(
    "INSERT INTO fx_refresh_locks (hour_slot, owner) VALUES (?, ?) ON CONFLICT(hour_slot) DO UPDATE SET owner=excluded.owner, requested_at=CURRENT_TIMESTAMP WHERE requested_at < datetime('now', '-2 minutes') RETURNING owner",
    [slot, owner],
  );
  if (claimed[0]?.owner !== owner) {
    if (stored) return stored;
    throw new ApiError(503, "Las cotizaciones se están actualizando. Reintenta en un momento");
  }
  try {
    let table: FxTable;
    try { table = await fetchMarket(); }
    catch (error) { console.error("Market FX unavailable; trying central bank", error); table = await fetchBank(); }
    if (!valid(table)) throw new Error("FX publication is outdated");
    await dbQuery("INSERT OR REPLACE INTO fx_publications (hour_slot, as_of, rates_json, source) VALUES (?, ?, ?, ?)", [slot, table.asOf, JSON.stringify(table.rates), table.source]);
    memory = { slot, table };
    return table;
  } catch (error) {
    if (stored) return stored;
    console.error("FX refresh failed", error);
    throw new ApiError(503, "No hay cotizaciones vigentes disponibles. Reintenta más tarde");
  }
}

export function quotesFor(base: Currency, table: FxTable): Record<string, FxQuote> {
  return Object.fromEntries(supportedCurrencies.flatMap((currency) => {
    const quote = makeQuote(currency, base, table.rates, table.asOf, table.source);
    return quote ? [[currency, quote]] : [];
  }));
}
