import Ajv from "ajv";
import { asSchema } from "ai";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { productionProfileSchema, productionProfileToolSchema } from "@/lib/production-profile";
import { cozteCostActionSchema, cozteCostActionToolSchema, cozteMaterialPriceSchema, cozteMaterialPriceToolSchema } from "./cozte-tool-schemas";

const workflowToolSchemas: Array<[string, z.ZodType]> = [
  ["material price", cozteMaterialPriceToolSchema],
  ["cost action", cozteCostActionToolSchema],
  ["production profile", productionProfileToolSchema],
];

describe("Cozte workflow input schemas", () => {
  it.each(workflowToolSchemas)("serializes %s without unsupported date formats", async (_name, schema) => {
    const jsonSchema = await asSchema(schema).jsonSchema;

    expect(JSON.stringify(jsonSchema)).not.toContain('"format":"date"');
    expect(() => new Ajv().compile(jsonSchema)).not.toThrow();
  });

  it("keeps real calendar-date validation inside tool execution", () => {
    const invalidDate = "2026-02-30";
    expect(cozteMaterialPriceToolSchema.safeParse({ materialId: "material-1", amount: 100, currency: "CLP", source: null, effectiveDate: invalidDate }).success).toBe(true);
    expect(cozteMaterialPriceSchema.safeParse({ materialId: "material-1", amount: 100, currency: "CLP", source: null, effectiveDate: invalidDate }).success).toBe(false);

    const profileWithInvalidEvidenceDate = {
      businessSummary: "", site: null, stages: [], products: [], categories: [], recurringCosts: [],
      inputs: [{ name: "Resina", category: "Insumos", purchaseUnit: "kg", consumptionUnit: "kg", unitsPerPurchase: 1, usage: [], pricePerPurchaseMinor: null, evidence: { quality: "measured", source: "Factura", asOf: invalidDate } }],
    };
    expect(productionProfileToolSchema.safeParse(profileWithInvalidEvidenceDate).success).toBe(true);
    expect(productionProfileSchema.safeParse(profileWithInvalidEvidenceDate).success).toBe(false);

    const invalidActionDate = { action: "create-material", name: "Resina", supplier: "", purchaseUnit: "kg", category: "Insumos", effectiveDate: invalidDate };
    expect(cozteCostActionToolSchema.safeParse(invalidActionDate).success).toBe(true);
    expect(cozteCostActionSchema.safeParse(invalidActionDate).success).toBe(false);
  });
});
