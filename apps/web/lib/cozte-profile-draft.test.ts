import { describe, expect, it } from "vitest";
import { emptyProductionProfile } from "./production-profile";
import { upsertProductDraft } from "./cozte-profile-draft";

describe("upsertProductDraft", () => {
  it("saves partial facts without manufacturing missing costs or deleting neighbors", () => {
    const first = upsertProductDraft(emptyProductionProfile, { name: "Tofu 500 g", goodUnitsPerBatch: 112, hoursPerBatch: 24 });
    const both = upsertProductDraft(first, { name: "Tofu 300 g", goodUnitsPerBatch: 93 });
    const updated = upsertProductDraft(both, { name: "tofu 500 G", batchesPerMonth: 10 });
    expect(updated.products).toHaveLength(2);
    expect(updated.products[0]).toMatchObject({ name: "Tofu 500 g", goodUnitsPerBatch: 112, hoursPerBatch: 24, batchesPerMonth: 10, startedUnitsPerBatch: null });
    expect(updated.products[1]).toMatchObject({ name: "Tofu 300 g", goodUnitsPerBatch: 93, hoursPerBatch: null });
  });
});
