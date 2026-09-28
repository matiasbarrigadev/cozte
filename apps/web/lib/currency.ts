import { moneyScale } from "./money";

export const supportedCurrencies = ["CLP", "ARS", "USD", "EUR", "BRL", "MXN", "COP", "PEN", "UYU", "PYG", "BOB", "CRC", "DOP", "GTQ", "HNL", "NIO", "PAB", "BZD"] as const;
export type Currency = (typeof supportedCurrencies)[number];

export type FxQuote = {
  from: Currency;
  to: Currency;
  ratePpm: number;
  asOf: string;
  source: "FXRatesAPI" | "BCRA";
  sourceUrl: string;
};

export function isCurrency(value: string): value is Currency {
  return supportedCurrencies.includes(value as Currency);
}

export function toNativeMilli(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000 || Math.round(amount * 1000) / 1000 !== amount) throw new Error("Importe inválido: usa hasta tres decimales");
  return Math.round(amount * 1000);
}

/** An amount in thousandths of another currency, in the quote's target currency at its money precision (cents or whole units). */
export function convertNativeMilli(nativeMilli: number, quote: FxQuote): number {
  if (!Number.isSafeInteger(nativeMilli) || nativeMilli < 0 || !Number.isSafeInteger(quote.ratePpm) || quote.ratePpm <= 0) throw new Error("Conversión inválida");
  const scale = moneyScale(quote.to);
  const converted = (BigInt(nativeMilli) * BigInt(quote.ratePpm) * BigInt(scale) + 500_000_000n) / 1_000_000_000n;
  const value = Number(converted);
  if (!Number.isSafeInteger(value)) throw new Error("Importe convertido fuera de rango");
  return value / scale;
}

export function makeQuote(from: Currency, to: Currency, rates: Record<string, number>, asOf: string, source: FxQuote["source"] = "BCRA"): FxQuote | null {
  const fromBase = source === "BCRA" && from === "ARS" || source === "FXRatesAPI" && from === "USD" ? 1 : rates[from];
  const toBase = source === "BCRA" && to === "ARS" || source === "FXRatesAPI" && to === "USD" ? 1 : rates[to];
  if (!Number.isFinite(fromBase) || !Number.isFinite(toBase) || fromBase <= 0 || toBase <= 0) return null;
  const ratePpm = Math.round((source === "BCRA" ? fromBase / toBase : toBase / fromBase) * 1_000_000);
  if (!Number.isSafeInteger(ratePpm) || ratePpm <= 0) return null;
  return { from, to, ratePpm, asOf, source, sourceUrl: source === "BCRA" ? "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones" : "https://api.fxratesapi.com/latest" };
}
