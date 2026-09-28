import "server-only";
import { dbBatch, dbQuery } from "./db";

/**
 * Cozte's superadmins: people of Cozte's own team, listed by e-mail in `platform_admins`, who can open any
 * organization in read-only mode. A person is one only while their Clerk account has that e-mail verified. The
 * organization being viewed travels in an httpOnly cookie that means nothing for anyone else: it is honored only after
 * the superadmin check, on every request.
 */
export const ADMIN_VIEW_COOKIE = "cozte-admin-org";

const CACHE_MS = 5 * 60_000;
const known = new Map<string, { email: string | null; at: number }>();

/** The verified e-mails of a Clerk user, lowercase; empty when Clerk is not configured or unreachable. */
async function verifiedEmails(userId: string): Promise<string[]> {
  if (!process.env.CLERK_SECRET_KEY) return [];
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const user = await (await clerkClient()).users.getUser(userId);
    return user.emailAddresses.filter((item) => item.verification?.status === "verified").map((item) => item.emailAddress.trim().toLowerCase());
  } catch (error) {
    console.error("Superadmin lookup failed", error);
    return [];
  }
}

/** The superadmin e-mail of a user, or null when they are not one. Remembered for a few minutes per instance. */
export async function superadminEmail(userId: string): Promise<string | null> {
  const cached = known.get(userId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.email;
  const emails = await verifiedEmails(userId);
  const rows = emails.length ? await dbQuery<{ email: string }>(`SELECT email FROM platform_admins WHERE lower(email) IN (${emails.map(() => "?").join(", ")}) LIMIT 1`, emails) : [];
  const email = rows[0]?.email ?? null;
  known.set(userId, { email, at: Date.now() });
  return email;
}

/** The organization a superadmin chose to view, when the user is one and it exists; null otherwise. */
export async function adminViewOrganization(userId: string, organizationId: string | undefined): Promise<{ organizationId: string; email: string } | null> {
  if (!organizationId || organizationId.length > 120) return null;
  const email = await superadminEmail(userId);
  if (!email) return null;
  const [row] = await dbQuery<{ id: string }>("SELECT id FROM organizations WHERE id=?", [organizationId]);
  return row ? { organizationId: row.id, email } : null;
}

/** Keeps who opened which organization and when. */
export async function recordAdminAccess(userId: string, email: string, organizationId: string): Promise<void> {
  await dbBatch([{ sql: "INSERT INTO platform_admin_access (id, admin_user_id, admin_email, organization_id) VALUES (?, ?, ?, ?)", params: [crypto.randomUUID(), userId, email, organizationId] }]);
}

export type OrganizationOverview = {
  id: string; name: string; currency: string; country: string | null; city: string | null; createdAt: string;
  members: number; products: number; sales30: number; revenue30: number; lastActivity: string | null; lastAdminAccess: string | null;
};

/** Every organization with how much it uses Cozte, the most recently active first. */
export async function listOrganizations(): Promise<OrganizationOverview[]> {
  const rows = await dbQuery<{ id: string; name: string; currency: string; country: string | null; city: string | null; created_at: string; members: number; products: number; sales30: number; revenue30: number | null; last_activity: string | null; last_admin_access: string | null }>(
    `SELECT o.id, o.name, o.currency, o.country, o.city, o.created_at,
      (SELECT count(*) FROM memberships m WHERE m.organization_id=o.id) AS members,
      (SELECT count(*) FROM products p WHERE p.organization_id=o.id AND p.archived_at IS NULL) AS products,
      (SELECT count(*) FROM sales s WHERE s.organization_id=o.id AND s.archived_at IS NULL AND s.sold_on >= date('now', '-30 days')) AS sales30,
      (SELECT sum(s.total_minor) FROM sales s WHERE s.organization_id=o.id AND s.archived_at IS NULL AND s.sold_on >= date('now', '-30 days')) AS revenue30,
      (SELECT max(a.created_at) FROM audit_events a WHERE a.organization_id=o.id) AS last_activity,
      (SELECT max(x.started_at) FROM platform_admin_access x WHERE x.organization_id=o.id) AS last_admin_access
    FROM organizations o ORDER BY coalesce(last_activity, o.created_at) DESC LIMIT 500`,
  );
  return rows.map((row) => ({
    id: row.id, name: row.name, currency: row.currency, country: row.country, city: row.city, createdAt: row.created_at,
    members: row.members, products: row.products, sales30: row.sales30, revenue30: row.revenue30 ?? 0, lastActivity: row.last_activity, lastAdminAccess: row.last_admin_access,
  }));
}
