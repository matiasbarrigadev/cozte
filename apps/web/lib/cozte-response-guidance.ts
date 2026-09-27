import type { Currency } from "./currency";
import { countryByCode } from "./locations";

const countryHints: Partial<Record<Currency, string>> = {
  ARS: "Argentina",
  CLP: "Chile",
  BRL: "Brasil",
  MXN: "México",
  COP: "Colombia",
  PEN: "Perú",
  UYU: "Uruguay",
  PYG: "Paraguay",
  BOB: "Bolivia",
  CRC: "Costa Rica",
  DOP: "República Dominicana",
  GTQ: "Guatemala",
  HNL: "Honduras",
  NIO: "Nicaragua",
  PAB: "Panamá",
  BZD: "Belice",
};

export function getCozteLocaleGuidance(currency: Currency, hasRegisteredLocation = false, location?: { country?: string | null; city?: string | null }): string {
  // With the company's location, the treatment and everyday words of its country; the person's own way of talking wins.
  const country = countryByCode(location?.country);
  if (country) {
    const place = location?.city ? `${location.city}, ${country.name}` : country.name;
    return `La empresa está en ${place}. Cómo hablar: ${country.speech} Si la persona usa otro trato, sigue el suyo. Moneda principal: ${currency}${country.currency !== currency ? ` (la usual allá es ${country.currency})` : ""}; algunos costos pueden estar en otras monedas. No supongas impuestos ni reglas locales que la persona no te dio.`;
  }
  const currencyHint = countryHints[currency];
  const locale = hasRegisteredLocation
    ? "El perfil de la empresa ya contiene su ubicación; úsala como referencia regional."
    : currencyHint
      ? `${currency} puede sugerir ${currencyHint}, pero la moneda no confirma el país.`
      : `${currency} no permite inferir un país.`;

  return `${locale} Usa la moneda de la empresa al hablar de importes, adapta palabras y ejemplos solo con señales suficientes y refleja el trato que usa la persona. No afirmes una ubicación inferida ni supongas impuestos, reglas o costumbres locales. Todavía no sabemos dónde está la empresa: en tu primera respuesta de una conversación (o cuando venga al caso), pregúntale con askQuestions en qué país y ciudad está, y guárdalo con setCompanyLocation; con eso quedan bien la hora, el trato y la moneda.`;
}
