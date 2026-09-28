import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const session = { userId: "user_1" as string | null, orgId: "org_own" as string | null, orgRole: "org:admin" };
const jar = new Map<string, string>();
const users: Record<string, { emailAddresses: { emailAddress: string; verification: { status: string } }[] }> = {};
const admins = new Set(["matiasbarriga7@gmail.com"]);
const organizations = new Set(["org_own", "org_client"]);

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => session,
  clerkClient: async () => ({ users: { getUser: async (id: string) => users[id] } }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { name, value: jar.get(name)! } : undefined }) }));
vi.mock("./db", () => ({
  dbQuery: async (sql: string, params: string[]) => {
    if (sql.includes("FROM platform_admins")) return params.filter((email) => admins.has(email)).map((email) => ({ email }));
    if (sql.includes("FROM organizations")) return organizations.has(params[0]) ? [{ id: params[0] }] : [];
    return [];
  },
  dbBatch: async () => [[]],
}));

const { requirePrincipal } = await import("./auth");
const { ADMIN_VIEW_COOKIE } = await import("./platform-admin");

let counter = 0;
/** Each case is a new Clerk user, so the per-instance superadmin cache never carries over. */
function signIn(email: string, status = "verified") {
  session.userId = `user_${++counter}`;
  users[session.userId] = { emailAddresses: [{ emailAddress: email, verification: { status } }] };
}

describe("superadmin access", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test";
    process.env.CLERK_SECRET_KEY = "sk_test";
    session.orgId = "org_own";
    session.orgRole = "org:admin";
    jar.clear();
  });

  it("gives everyone else their own company, whatever cookie they send", async () => {
    signIn("ana@example.com");
    jar.set(ADMIN_VIEW_COOKIE, "org_client");
    expect(await requirePrincipal(true)).toEqual({ userId: session.userId, organizationId: "org_own", role: "owner" });
  });

  it("lets the superadmin view another company, read-only and without being its member", async () => {
    signIn("MatiasBarriga7@gmail.com");
    jar.set(ADMIN_VIEW_COOKIE, "org_client");
    expect(await requirePrincipal()).toEqual({ userId: session.userId, organizationId: "org_client", role: "viewer", adminView: { email: "matiasbarriga7@gmail.com" } });
    await expect(requirePrincipal(true)).rejects.toThrow(/superadmin: es solo lectura/);
    // Even without a company of their own selected.
    session.orgId = null;
    expect((await requirePrincipal()).organizationId).toBe("org_client");
  });

  it("does not honor an unverified e-mail or a company that does not exist", async () => {
    signIn("matiasbarriga7@gmail.com", "unverified");
    jar.set(ADMIN_VIEW_COOKIE, "org_client");
    expect((await requirePrincipal()).organizationId).toBe("org_own");
    signIn("matiasbarriga7@gmail.com");
    jar.set(ADMIN_VIEW_COOKIE, "org_made_up");
    expect((await requirePrincipal(true)).organizationId).toBe("org_own");
  });
});
