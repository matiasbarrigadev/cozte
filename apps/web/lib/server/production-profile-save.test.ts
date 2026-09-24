import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ dbBatch: vi.fn(), dbQuery: vi.fn() }));
vi.mock("./state", () => ({ loadState: vi.fn() }));

import { demoState } from "../demo";
import { emptyProductionProfile } from "../production-profile";
import { upsertProductDraft } from "../cozte-profile-draft";
import { assertSqlBindings } from "../sql-bindings";
import { dbBatch, dbQuery } from "./db";
import { loadState } from "./state";
import { saveProductionProfileDirectly, saveProductionProfileDraft } from "./production-profile";

const principal = { userId: "owner", organizationId: demoState.organization.id, role: "owner" as const };
const profile = upsertProductDraft(emptyProductionProfile, { name: "Tofu 500 g", goodUnitsPerBatch: 112, hoursPerBatch: 24 });

describe("production map writes", () => {
  beforeEach(() => {
    vi.mocked(dbBatch).mockReset().mockResolvedValue([[], [], [], [], [{ revision: 1 }]]);
    vi.mocked(dbQuery).mockReset().mockResolvedValue([]);
    vi.mocked(loadState).mockResolvedValue(structuredClone(demoState));
  });

  it("saves a partial product draft with aligned SQL parameters", async () => {
    await saveProductionProfileDraft(principal, profile, 0, demoState.revision);
    expect(() => assertSqlBindings(vi.mocked(dbBatch).mock.calls[0][0])).not.toThrow();
  });

  it("saves a directly evaluable map with aligned SQL parameters", async () => {
    await saveProductionProfileDirectly(principal, profile, 0, demoState.revision);
    expect(() => assertSqlBindings(vi.mocked(dbBatch).mock.calls[0][0])).not.toThrow();
  });
});
