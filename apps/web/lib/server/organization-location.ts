import "server-only";
import { z } from "zod";
import { COUNTRIES, countryByCode, locationTimeZone } from "@/lib/locations";
import { ApiError, type Principal } from "./auth";
import { dbBatch } from "./db";

export const locationInputSchema = z.object({
  country: z.string().trim().toUpperCase().refine((code) => Boolean(countryByCode(code)), "Elige un país de la lista"),
  city: z.string().trim().max(80).optional().default(""),
  timeZone: z.string().trim().max(60).optional(),
});

export type LocationInput = z.input<typeof locationInputSchema>;

/**
 * Saves where the business is. The timezone must be one of the country's (its usual one by default). Costs do not
 * change: only the calendar, how Cozte talks and the currency it suggests.
 */
export async function saveOrganizationLocation(principal: Principal, input: LocationInput, source: "user" | "cozte"): Promise<{ country: string; city: string; timeZone: string }> {
  const value = locationInputSchema.parse(input);
  const country = countryByCode(value.country);
  if (!country) throw new ApiError(400, `Ese país no está en la lista (${COUNTRIES.map((item) => item.name).join(", ")})`);
  if (value.timeZone && !country.timeZones.some((item) => item.zone === value.timeZone)) throw new ApiError(400, `Esa zona horaria no es de ${country.name}`);
  const timeZone = locationTimeZone({ country: country.code, timeZone: value.timeZone })!;
  await dbBatch([
    { sql: "UPDATE organizations SET country=?, city=?, time_zone=? WHERE id=?", params: [country.code, value.city || null, timeZone, principal.organizationId] },
    { sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, 'set-location', ?, ?)", params: [crypto.randomUUID(), principal.organizationId, principal.userId, principal.organizationId, JSON.stringify({ country: country.code, city: value.city, timeZone, source })] },
  ]);
  return { country: country.code, city: value.city, timeZone };
}
