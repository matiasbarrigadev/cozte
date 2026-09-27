import type { Currency } from "./currency";

/**
 * Where a business is: its country gives the timezone, how people talk there and the usual currency. The city is
 * for reference (and for choosing among a country's timezones). Costs can still be in other currencies.
 */
export type CountryInfo = {
  code: string;
  name: string;
  currency: Currency;
  /** IANA timezones, the most common first. */
  timeZones: { zone: string; label: string }[];
  /** How to talk to people there: treatment and a few everyday business words. */
  speech: string;
};

const RIOPLATENSE = "Trato de vos (vos tenés, fijate, contame), vocabulario rioplatense";

export const COUNTRIES: CountryInfo[] = [
  { code: "AR", name: "Argentina", currency: "ARS", timeZones: [{ zone: "America/Argentina/Buenos_Aires", label: "Argentina" }], speech: `${RIOPLATENSE}: "remito", "factura", "ticket", "plata", "laburo".` },
  { code: "UY", name: "Uruguay", currency: "UYU", timeZones: [{ zone: "America/Montevideo", label: "Uruguay" }], speech: `${RIOPLATENSE}: "boleta", "factura", "remito", "plata".` },
  { code: "PY", name: "Paraguay", currency: "PYG", timeZones: [{ zone: "America/Asuncion", label: "Paraguay" }], speech: "Trato de vos, cercano: \"factura\", \"boleta\", \"plata\"." },
  { code: "CL", name: "Chile", currency: "CLP", timeZones: [{ zone: "America/Santiago", label: "Chile continental" }, { zone: "America/Punta_Arenas", label: "Magallanes" }, { zone: "Pacific/Easter", label: "Isla de Pascua" }], speech: "Trato de tú, cercano y sin modismos exagerados: \"boleta\", \"factura\", \"guía de despacho\", \"lucas\" solo si la persona lo usa." },
  { code: "BO", name: "Bolivia", currency: "BOB", timeZones: [{ zone: "America/La_Paz", label: "Bolivia" }], speech: "Trato de tú o de usted según la persona: \"factura\", \"nota de venta\"." },
  { code: "PE", name: "Perú", currency: "PEN", timeZones: [{ zone: "America/Lima", label: "Perú" }], speech: "Trato de tú, cordial: \"boleta\", \"factura\", \"guía de remisión\", \"soles\"." },
  { code: "EC", name: "Ecuador", currency: "USD", timeZones: [{ zone: "America/Guayaquil", label: "Ecuador continental" }, { zone: "Pacific/Galapagos", label: "Galápagos" }], speech: "Trato de usted o de tú según la persona, cordial: \"factura\", \"nota de venta\", \"dólares\"." },
  { code: "CO", name: "Colombia", currency: "COP", timeZones: [{ zone: "America/Bogota", label: "Colombia" }], speech: "Trato de usted o de tú según la persona, amable: \"factura\", \"remisión\", \"plata\"." },
  { code: "VE", name: "Venezuela", currency: "USD", timeZones: [{ zone: "America/Caracas", label: "Venezuela" }], speech: "Trato de tú, cercano: \"factura\", \"nota de entrega\"." },
  { code: "MX", name: "México", currency: "MXN", timeZones: [{ zone: "America/Mexico_City", label: "Centro" }, { zone: "America/Cancun", label: "Quintana Roo" }, { zone: "America/Chihuahua", label: "Chihuahua" }, { zone: "America/Hermosillo", label: "Sonora" }, { zone: "America/Tijuana", label: "Baja California" }], speech: "Trato de tú, amable: \"ticket\", \"factura\", \"nota de remisión\", \"pesos\"." },
  { code: "GT", name: "Guatemala", currency: "GTQ", timeZones: [{ zone: "America/Guatemala", label: "Guatemala" }], speech: "Trato de usted en lo comercial, cordial: \"factura\", \"quetzales\"." },
  { code: "HN", name: "Honduras", currency: "HNL", timeZones: [{ zone: "America/Tegucigalpa", label: "Honduras" }], speech: "Trato de usted en lo comercial, cordial: \"factura\", \"lempiras\"." },
  { code: "SV", name: "El Salvador", currency: "USD", timeZones: [{ zone: "America/El_Salvador", label: "El Salvador" }], speech: "Trato de usted en lo comercial, cordial: \"factura\", \"dólares\"." },
  { code: "NI", name: "Nicaragua", currency: "NIO", timeZones: [{ zone: "America/Managua", label: "Nicaragua" }], speech: "Trato de usted en lo comercial, cordial: \"factura\", \"córdobas\"." },
  { code: "CR", name: "Costa Rica", currency: "CRC", timeZones: [{ zone: "America/Costa_Rica", label: "Costa Rica" }], speech: "Trato de usted (ustedeo), cordial: \"factura\", \"colones\"." },
  { code: "PA", name: "Panamá", currency: "PAB", timeZones: [{ zone: "America/Panama", label: "Panamá" }], speech: "Trato de usted o de tú, cordial: \"factura\", \"balboas o dólares\"." },
  { code: "DO", name: "República Dominicana", currency: "DOP", timeZones: [{ zone: "America/Santo_Domingo", label: "República Dominicana" }], speech: "Trato de tú, cercano: \"factura\", \"pesos\"." },
  { code: "BZ", name: "Belice", currency: "BZD", timeZones: [{ zone: "America/Belize", label: "Belice" }], speech: "Español neutro, trato de tú." },
  { code: "BR", name: "Brasil", currency: "BRL", timeZones: [{ zone: "America/Sao_Paulo", label: "Brasilia" }, { zone: "America/Manaus", label: "Amazonas" }, { zone: "America/Recife", label: "Nordeste" }], speech: "Español neutro y claro (la persona puede no ser hispanohablante), trato de tú: \"nota fiscal\", \"reales\"." },
  { code: "ES", name: "España", currency: "EUR", timeZones: [{ zone: "Europe/Madrid", label: "Península" }, { zone: "Atlantic/Canary", label: "Canarias" }], speech: "Trato de tú (vosotros para varias personas), vocabulario peninsular: \"factura\", \"albarán\", \"ticket\", \"euros\"." },
  { code: "US", name: "Estados Unidos", currency: "USD", timeZones: [{ zone: "America/New_York", label: "Este" }, { zone: "America/Chicago", label: "Centro" }, { zone: "America/Denver", label: "Montaña" }, { zone: "America/Los_Angeles", label: "Pacífico" }], speech: "Español neutro, trato de tú: \"factura (invoice)\", \"recibo\", \"dólares\"." },
];

export const countryByCode = (code?: string | null): CountryInfo | undefined => code ? COUNTRIES.find((country) => country.code === code.toUpperCase()) : undefined;

const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** A country by its code or name as someone writes it ("argentina", "Mexico", "EEUU"). */
export function findCountry(text: string): CountryInfo | undefined {
  const value = normalize(text);
  const aliases: Record<string, string> = { eeuu: "US", usa: "US", "estados unidos de america": "US", "rep dominicana": "DO", "republica dominicana": "DO", mejico: "MX" };
  return countryByCode(value.length === 2 ? value : aliases[value.replace(/\./g, "")]) ?? COUNTRIES.find((country) => normalize(country.name) === value);
}

/** The company's timezone: the one chosen, else its country's usual one, else null (the caller falls back). */
export function locationTimeZone(location: { country?: string | null; timeZone?: string | null }): string | null {
  const country = countryByCode(location.country);
  if (location.timeZone && (!country || country.timeZones.some((item) => item.zone === location.timeZone))) return location.timeZone;
  return country?.timeZones[0]?.zone ?? null;
}

export function isValidTimeZone(zone: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
}
