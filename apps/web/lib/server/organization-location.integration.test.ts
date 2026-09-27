import { beforeAll, describe, expect, it, vi } from "vitest";

// Saves where a business is (by the person and by Cozte) against a local D1 bridge when COZTE_BRIDGE_TEST_URL is set.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./fx", () => ({ officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { USD: 1 }, source: "FXRatesAPI" }), quotesFor: () => ({}) }));

import { createCozteTools } from "./cozte-agent-tools";
import { saveOrganizationLocation } from "./organization-location";
import { loadState } from "./state";
import { businessTimeZone } from "@/lib/business";
import { buildCozteInstructions } from "./cozte-instructions";

type Output = { ok: boolean; done?: string[]; error?: string; options?: string[]; note?: string };

describe.skipIf(!bridgeUrl)("company location against D1", { timeout: 90_000 }, () => {
  const principal = { userId: "tester", organizationId: `org-test-${crypto.randomUUID()}`, role: "owner" as const };
  const tools = createCozteTools(principal, crypto.randomUUID());
  const run = async (input: Record<string, unknown>) => await (tools.setCompanyLocation.execute as (input: unknown, options: { toolCallId: string }) => Promise<Output>)(input, { toolCallId: crypto.randomUUID() });

  beforeAll(async () => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    await loadState(principal);
  });

  it("asks where the business is while it is unknown", async () => {
    const state = await loadState(principal);
    expect(state.organization.country ?? null).toBeNull();
    expect(buildCozteInstructions({ state, notes: [], legacyProfile: null })).toContain("setCompanyLocation");
  });

  it("lets Cozte save it from what the person says, and then uses its time and way of talking", async () => {
    const saved = await run({ country: "argentina", city: "Córdoba" });
    expect(saved.ok).toBe(true);
    expect(saved.done?.[0]).toBe("Ubicación guardada: Córdoba, Argentina (hora de Argentina)");
    // The test organization uses CLP: Cozte says the usual currency there is another one.
    expect(saved.note).toContain("la usual allá es ARS");
    const state = await loadState(principal);
    expect(state.organization).toMatchObject({ country: "AR", city: "Córdoba", timeZone: "America/Argentina/Buenos_Aires" });
    expect(businessTimeZone(state.organization)).toBe("America/Argentina/Buenos_Aires");
    const instructions = buildCozteInstructions({ state, notes: [], legacyProfile: null });
    expect(instructions).toContain("La empresa está en Córdoba, Argentina");
    expect(instructions).toContain("Trato de vos");
    expect(instructions).not.toContain("Todavía no sabemos dónde está la empresa");
  });

  it("keeps a timezone only when it belongs to the country, and rejects unknown countries", async () => {
    const cancun = await saveOrganizationLocation(principal, { country: "MX", city: "Cancún", timeZone: "America/Cancun" }, "user");
    expect(cancun.timeZone).toBe("America/Cancun");
    expect((await loadState(principal)).organization.timeZone).toBe("America/Cancun");
    await expect(saveOrganizationLocation(principal, { country: "MX", timeZone: "Europe/Madrid" }, "user")).rejects.toThrow(/no es de México/);
    const unknown = await run({ country: "Narnia" });
    expect(unknown.ok).toBe(false);
    expect(unknown.options).toContain("Chile");
  });
});
