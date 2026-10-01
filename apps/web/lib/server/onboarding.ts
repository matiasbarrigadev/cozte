import "server-only";
import { z } from "zod";
import { supportedCurrencies, type Currency } from "@/lib/currency";
import { countryByCode } from "@/lib/locations";
import type { Onboarding } from "@/lib/onboarding";
import { ApiError, type Principal } from "./auth";
import { dbBatch, dbQuery } from "./db";
import { saveOrganizationLocation } from "./organization-location";
import { saveExplanationLevel } from "./cozte-settings";
import { DEFAULT_ORGANIZATION_NAME, ensureOrganization, rememberOrganizationName } from "./state";

/**
 * The first-time questions of a new company: how the person likes to be called, the company's name and its country
 * (which sets the main currency, the calendar and how Cozte talks). Asked once, to the company's owner.
 */

export type { Onboarding } from "@/lib/onboarding";

const personNameSchema = z.string().trim().min(2, "Escribe tu nombre").max(80);
const companyNameSchema = z.string().trim().min(2, "Escribe el nombre de tu empresa").max(120);

export const onboardingInputSchema = z.object({
  personName: personNameSchema,
  companyName: companyNameSchema,
  country: z.string().trim().toUpperCase().refine((code) => Boolean(countryByCode(code)), "Elige un país de la lista"),
  city: z.string().trim().max(80).optional().default(""),
  currency: z.enum(supportedCurrencies).optional(),
  /** How much the person knows about costs: how Cozte explains and whether the menu opens step by step. */
  level: z.enum(["simple", "medium", "advanced"]).optional(),
  /** Whether the company already sells: a business in operation or a project being planned. */
  selling: z.boolean().optional(),
});

async function clerk() {
  if (!process.env.CLERK_SECRET_KEY) return null;
  const { clerkClient } = await import("@clerk/nextjs/server");
  return clerkClient();
}

/** The name in the account (Clerk), when the person gave one. */
async function accountName(userId: string): Promise<string> {
  try {
    const user = await (await clerk())?.users.getUser(userId);
    return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  } catch (error) {
    console.error("User name lookup failed", error);
    return "";
  }
}

/** What the first-time questions start from, and whether the company still needs them. */
export async function loadOnboarding(principal: Principal): Promise<Onboarding> {
  await ensureOrganization(principal);
  const [[organization], [member]] = await Promise.all([
    dbQuery<{ name: string; country: string | null; onboarded_at: string | null }>("SELECT name, country, onboarded_at FROM organizations WHERE id=?", [principal.organizationId]),
    dbQuery<{ display_name: string }>("SELECT display_name FROM memberships WHERE organization_id=? AND user_id=?", [principal.organizationId, principal.userId]),
  ]);
  let personName = member?.display_name ?? "";
  if (!personName && !principal.adminView) {
    personName = await accountName(principal.userId);
    // Remembered once, so Cozte can call the person by name without asking the account on every message.
    if (personName) await dbBatch([{ sql: "UPDATE memberships SET display_name=? WHERE organization_id=? AND user_id=? AND display_name=''", params: [personName.slice(0, 80), principal.organizationId, principal.userId] }]);
  }
  const companyName = organization?.name && organization.name !== DEFAULT_ORGANIZATION_NAME ? organization.name : "";
  const owner = !principal.adminView && principal.role === "owner";
  return { needed: owner && !organization?.onboarded_at, personName, companyName, country: organization?.country ?? null, owner };
}

/** How the person likes to be called, for Cozte. Empty when unknown. */
export async function loadMemberName(principal: Principal): Promise<string> {
  if (principal.adminView) return "";
  const [member] = await dbQuery<{ display_name: string }>("SELECT display_name FROM memberships WHERE organization_id=? AND user_id=?", [principal.organizationId, principal.userId]);
  return member?.display_name ?? "";
}

/** Renames the company in the account and in Cozte; the account's name is the one other screens show. */
export async function saveCompanyName(principal: Principal, input: string): Promise<string> {
  if (principal.adminView || principal.role !== "owner") throw new ApiError(403, "Solo el propietario puede cambiar el nombre de la empresa");
  const name = companyNameSchema.parse(input);
  const client = await clerk();
  if (client) {
    try { await client.organizations.updateOrganization(principal.organizationId, { name }); }
    catch (error) { console.error("Organization rename failed", error); throw new ApiError(502, "No pudimos guardar el nombre de la empresa. Intenta de nuevo"); }
  }
  rememberOrganizationName(principal.organizationId, name);
  await dbBatch([
    { sql: "UPDATE organizations SET name=?, name_set_at=CURRENT_TIMESTAMP WHERE id=?", params: [name, principal.organizationId] },
    { sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, 'rename-organization', ?, ?)", params: [crypto.randomUUID(), principal.organizationId, principal.userId, principal.organizationId, JSON.stringify({ name })] },
  ]);
  return name;
}

/**
 * Saves the answers: the person's name (in the account too), the company's name, where it is and its main currency
 * (the country's unless another is chosen; it only changes while no costs are loaded). Then the company is set up.
 */
export async function completeOnboarding(principal: Principal, input: z.input<typeof onboardingInputSchema>): Promise<{ personName: string; companyName: string; country: string; currency: Currency }> {
  if (principal.adminView || principal.role !== "owner") throw new ApiError(403, "Solo el propietario de la empresa puede completar estos datos");
  const value = onboardingInputSchema.parse(input);
  const country = countryByCode(value.country)!;
  const currency: Currency = value.currency ?? ((supportedCurrencies as readonly string[]).includes(country.currency) ? country.currency : "USD");
  await ensureOrganization(principal);
  const companyName = await saveCompanyName(principal, value.companyName);
  const [firstName, ...rest] = value.personName.split(/\s+/);
  try { await (await clerk())?.users.updateUser(principal.userId, { firstName, ...(rest.length ? { lastName: rest.join(" ") } : {}) }); }
  catch (error) { console.error("User rename failed", error); }
  await saveOrganizationLocation(principal, { country: country.code, city: value.city }, "user");
  const org = principal.organizationId;
  await dbBatch([
    { sql: "UPDATE memberships SET display_name=? WHERE organization_id=? AND user_id=?", params: [value.personName, org, principal.userId] },
    // The main currency follows the answer only while nothing is costed yet (afterwards it stays fixed).
    { sql: "UPDATE organizations SET currency=?, revision=revision+1 WHERE id=? AND currency<>? AND NOT EXISTS (SELECT 1 FROM products WHERE organization_id=?) AND NOT EXISTS (SELECT 1 FROM materials WHERE organization_id=?) AND NOT EXISTS (SELECT 1 FROM shared_expenses WHERE organization_id=?)", params: [currency, org, currency, org, org, org] },
    ...(value.selling !== undefined ? [{ sql: "UPDATE organizations SET business_mode=? WHERE id=?", params: [value.selling ? "operating" : "project", org] }] : []),
    { sql: "UPDATE organizations SET onboarded_at=COALESCE(onboarded_at, CURRENT_TIMESTAMP) WHERE id=?", params: [org] },
    { sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, 'complete-onboarding', ?, ?)", params: [crypto.randomUUID(), org, principal.userId, org, JSON.stringify({ companyName, country: country.code, currency, level: value.level ?? null, selling: value.selling ?? null })] },
  ]);
  if (value.level) await saveExplanationLevel(principal, value.level);
  const [saved] = await dbQuery<{ currency: Currency }>("SELECT currency FROM organizations WHERE id=?", [org]);
  return { personName: value.personName, companyName, country: country.code, currency: saved?.currency ?? currency };
}
