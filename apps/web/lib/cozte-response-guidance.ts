import type { Currency } from "./currency";

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

export function getCozteLocaleGuidance(currency: Currency, hasRegisteredLocation = false): string {
  const currencyHint = countryHints[currency];
  const locale = hasRegisteredLocation
    ? "El perfil de la empresa ya contiene su ubicación; úsala como referencia regional."
    : currencyHint
      ? `${currency} puede sugerir ${currencyHint}, pero la moneda no confirma el país.`
      : `${currency} no permite inferir un país.`;

  return `${locale} Usa la moneda de la empresa al hablar de importes, adapta palabras y ejemplos solo con señales suficientes y refleja el trato que usa la persona. No afirmes una ubicación inferida ni supongas impuestos, reglas o costumbres locales.`;
}
