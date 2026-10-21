import { beforeAll, describe, expect, it, vi } from "vitest";

// The superadmin tables and queries against a local D1 bridge when COZTE_BRIDGE_TEST_URL is set.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ users: { getUser: async (id: string) => ({ emailAddresses: [{ emailAddress: id === "admin" ? "admin@example.com" : "otra@example.com", verification: { status: "verified" } }] }) } }),
}));

import { dbBatch, dbQuery } from "./db";
import { adminViewOrganization, listOrganizations, recordAdminAccess, superadminEmail } from "./platform-admin";

describe.skipIf(!bridgeUrl)("superadmin tables against D1", { timeout: 60_000 }, () => {
  const organizationId = `org-test-${crypto.randomUUID()}`;

  beforeAll(async () => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    process.env.CLERK_SECRET_KEY = "sk_test";
    await dbBatch([
      { sql: "INSERT INTO organizations (id, name, currency) VALUES (?, 'Panadería de prueba', 'CLP')", params: [organizationId] },
      { sql: "INSERT INTO memberships (organization_id, user_id, role) VALUES (?, 'someone', 'owner')", params: [organizationId] },
      { sql: "INSERT OR IGNORE INTO platform_admins (email) VALUES ('admin@example.com')", params: [] },
    ]);
  });

  it("knows the superadmin by the e-mail listed in platform_admins, and nobody else", async () => {
    expect(await superadminEmail("admin")).toBe("admin@example.com");
    expect(await superadminEmail("customer")).toBeNull();
    expect(await adminViewOrganization("admin", organizationId)).toEqual({ organizationId, email: "admin@example.com" });
    expect(await adminViewOrganization("customer", organizationId)).toBeNull();
  });

  it("lists every company with its usage and keeps each access", async () => {
    await recordAdminAccess("admin", "admin@example.com", organizationId);
    const row = (await listOrganizations()).find((item) => item.id === organizationId);
    expect(row).toMatchObject({ name: "Panadería de prueba", currency: "CLP", members: 1, products: 0, sales30: 0 });
    expect(row?.lastAdminAccess).toBeTruthy();
    const log = await dbQuery<{ admin_email: string }>("SELECT admin_email FROM platform_admin_access WHERE organization_id=?", [organizationId]);
    expect(log).toEqual([{ admin_email: "admin@example.com" }]);
  });
});
