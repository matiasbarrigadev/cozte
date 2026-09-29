import { beforeAll, describe, expect, it, vi } from "vitest";

// Runs the first-time questions of a new company against a local D1 bridge when COZTE_BRIDGE_TEST_URL is set.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./fx", () => ({ officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { USD: 1 }, source: "FXRatesAPI" }), quotesFor: () => ({}) }));

import { completeOnboarding, loadMemberName, loadOnboarding, saveCompanyName } from "./onboarding";
import { dbBatch, dbQuery } from "./db";
import { loadState } from "./state";
import { buildCozteInstructions } from "./cozte-instructions";

describe.skipIf(!bridgeUrl)("onboarding against D1", { timeout: 60_000 }, () => {
  const owner = { userId: "owner", organizationId: `org-test-${crypto.randomUUID()}`, role: "owner" as const };

  beforeAll(() => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
  });

  it("asks a new company once, saves the names, the country and its currency, and Cozte knows who writes", async () => {
    expect(await loadOnboarding(owner)).toMatchObject({ needed: true, personName: "", companyName: "", country: null, owner: true });
    // Only the owner answers for the company.
    expect(await loadOnboarding({ ...owner, userId: "editor", role: "editor" })).toMatchObject({ needed: false, owner: false });
    await expect(completeOnboarding({ ...owner, userId: "editor", role: "editor" }, { personName: "Ana", companyName: "Otra", country: "CL" })).rejects.toThrow(/propietario/);
    await expect(completeOnboarding(owner, { personName: "M", companyName: "Tofu del Valle", country: "AR" })).rejects.toThrow();

    const saved = await completeOnboarding(owner, { personName: "Matías Barriga", companyName: "Tofu del Valle", country: "ar", city: "Córdoba" });
    expect(saved).toEqual({ personName: "Matías Barriga", companyName: "Tofu del Valle", country: "AR", currency: "ARS" });
    const state = await loadState(owner);
    expect(state.organization).toMatchObject({ name: "Tofu del Valle", currency: "ARS", country: "AR", city: "Córdoba", timeZone: "America/Argentina/Buenos_Aires" });
    expect(await loadOnboarding(owner)).toMatchObject({ needed: false, personName: "Matías Barriga", companyName: "Tofu del Valle", country: "AR" });
    expect(await loadMemberName(owner)).toBe("Matías Barriga");
    expect(buildCozteInstructions({ state, notes: [], legacyProfile: null, personName: "Matías Barriga" })).toContain('Quien escribe se llama "Matías Barriga"');
    const [row] = await dbQuery<{ name_set_at: string | null; onboarded_at: string | null }>("SELECT name_set_at, onboarded_at FROM organizations WHERE id=?", [owner.organizationId]);
    expect(row.name_set_at).toBeTruthy();
    expect(row.onboarded_at).toBeTruthy();
  });

  it("keeps the main currency once there are costs, and renames the company later", async () => {
    await dbBatch([{ sql: "INSERT INTO products (id, organization_id, name, lot_units, sale_price_minor) VALUES (?, ?, 'Tofu', 100, 0)", params: [crypto.randomUUID(), owner.organizationId] }]);
    const again = await completeOnboarding(owner, { personName: "Matías", companyName: "Tofu del Valle", country: "CL", currency: "CLP" });
    expect(again.currency).toBe("ARS");
    expect((await loadState(owner)).organization).toMatchObject({ currency: "ARS", country: "CL" });
    expect(await saveCompanyName(owner, "  Tofu del Valle SRL ")).toBe("Tofu del Valle SRL");
    expect((await loadState(owner)).organization.name).toBe("Tofu del Valle SRL");
    await expect(saveCompanyName({ ...owner, role: "editor" }, "Nope")).rejects.toThrow(/propietario/);
  });
});
