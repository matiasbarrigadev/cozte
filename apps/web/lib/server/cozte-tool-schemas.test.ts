import Ajv from "ajv";
import { asSchema } from "ai";
import type { z } from "zod";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { productionProfileSchema, productionProfileToolSchema } from "@/lib/production-profile";
import { COZTE_TOOL_NAMES } from "@/lib/cozte-tool-catalog";
import { cozteToolInputSchemas } from "./cozte-agent-tools";

describe("Cozte tool input schemas", () => {
  it("defines a schema for every tool in the catalog", () => {
    expect(Object.keys(cozteToolInputSchemas).sort()).toEqual([...COZTE_TOOL_NAMES].sort());
  });

  it.each(COZTE_TOOL_NAMES)("serializes %s for the model without unsupported formats", async (name) => {
    const jsonSchema = await asSchema(cozteToolInputSchemas[name] as z.ZodType).jsonSchema;
    expect(JSON.stringify(jsonSchema)).not.toContain('"format":"date"');
    expect(() => new Ajv().compile(jsonSchema)).not.toThrow();
  });

  it("keeps real calendar-date validation inside the stored profile", () => {
    const invalidDate = "2026-02-30";
    const profileWithInvalidEvidenceDate = {
      businessSummary: "", site: null, stages: [], products: [], categories: [], recurringCosts: [],
      inputs: [{ name: "Resina", category: "Insumos", purchaseUnit: "kg", consumptionUnit: "kg", unitsPerPurchase: 1, usage: [], pricePerPurchaseMinor: null, evidence: { quality: "measured", source: "Factura", asOf: invalidDate } }],
    };
    expect(productionProfileToolSchema.safeParse(profileWithInvalidEvidenceDate).success).toBe(true);
    expect(productionProfileSchema.safeParse(profileWithInvalidEvidenceDate).success).toBe(false);
  });

  it("accepts the flat inputs a model sends for common requests", () => {
    expect(cozteToolInputSchemas.saveProduct.safeParse({ name: "Tofu 500g", goodUnitsPerLot: 112, lotsPerMonth: 23, salePrice: null }).success).toBe(true);
    expect(cozteToolInputSchemas.saveRecipe.safeParse({ product: "Tofu 300g", items: [{ material: "Cloruro", quantity: 7, per: "unit", unit: "g" }] }).success).toBe(true);
    expect(cozteToolInputSchemas.saveExpense.safeParse({ name: "Luz", amount: 350000, splitBy: "hours" }).success).toBe(true);
    expect(cozteToolInputSchemas.saveRecipe.safeParse({ product: "Tofu", items: [{ material: "Soja", quantity: 1, per: "batch" }] }).success).toBe(false);
  });
});
