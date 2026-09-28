/**
 * How precise money is in each currency, as businesses actually use it. Pesos of high denomination (CLP, ARS, COP,
 * PYG, CRC, UYU, DOP) are priced and booked in whole units: a cent there is worth less than two US cents. The rest
 * (USD, EUR, BRL, MXN, PEN, BOB, GTQ, HNL, NIO, PAB, BZD) need cents: a label that costs USD 0.08 or a price of S/ 2.50
 * cannot be rounded to whole units. Every amount in the app is in currency units with this many decimals at most.
 */
const WHOLE_UNIT_CURRENCIES = new Set(["CLP", "ARS", "COP", "PYG", "CRC", "UYU", "DOP"]);

export function moneyDecimals(currency: string | null | undefined): 0 | 2 {
  return !currency || WHOLE_UNIT_CURRENCIES.has(currency) ? 0 : 2;
}

/** 1 for whole-unit currencies, 100 for currencies with cents: the integer unit money is computed in. */
export const moneyScale = (currency: string | null | undefined) => 10 ** moneyDecimals(currency);

/** An amount rounded to its currency's precision (half away from zero, like an invoice). */
export function roundMoney(value: number, currency: string | null | undefined): number {
  const scale = moneyScale(currency);
  const scaled = Math.round(Math.abs(value) * scale + 1e-9) / scale;
  return value < 0 ? -scaled : scaled;
}

/** An amount as an integer count of its currency's smallest unit (cents or whole units), for exact arithmetic. */
export const toMoneyUnits = (value: number, currency: string | null | undefined) => Math.round(roundMoney(value, currency) * moneyScale(currency));

/** Back from the smallest unit to currency units. */
export const fromMoneyUnits = (units: number, currency: string | null | undefined) => units / moneyScale(currency);

/**
 * Money for people: whole units where the currency has no cents; cents where it has them, shown only when the
 * amount has them ($150, $149.90).
 */
export function formatMoney(value: number, currency: string): string {
  const decimals = moneyDecimals(currency);
  const rounded = roundMoney(value, currency);
  const digits = decimals > 0 && !Number.isInteger(rounded) ? decimals : 0;
  return new Intl.NumberFormat("es-CL", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(rounded);
}
