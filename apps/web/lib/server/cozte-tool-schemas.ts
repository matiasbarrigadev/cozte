import { z } from "zod";
import { supportedCurrencies } from "@/lib/currency";
import { isoDateToolInputSchema } from "@/lib/iso-date";

export const cozteProductFields = {
  name: z.string().trim().min(2).max(120).describe("Nombre claro del producto y su formato"),
  lotUnits: z.number().int().min(1).max(1_000_000_000).describe("Unidades buenas y vendibles que salen de un lote"),
  salePrice: z.number().int().min(0).max(1_000_000_000_000).describe("Precio de venta por unidad, en importes normales de la moneda de la empresa"),
  salesVariablePerUnit: z.number().int().min(0).max(1_000_000_000_000).describe("Gasto variable de venta por unidad, en la moneda de la empresa; usa cero solo si está confirmado que no existe"),
  laborCostPerLot: z.number().int().min(0).max(1_000_000_000_000).describe("Costo de trabajo directo para producir un lote completo, en la moneda de la empresa"),
  productionHoursPerLot: z.number().min(0).max(1_000_000).refine((value) => Math.round(value * 1000) / 1000 === value, "Usa hasta tres decimales").describe("Horas normales de trabajo para producir un lote; por ejemplo, 1.5 significa una hora y media"),
};

const cozteProductCreateToolFields = {
  ...cozteProductFields,
  lotUnits: cozteProductFields.lotUnits.nullable().describe("Unidades buenas vendibles por lote; null si aún no se confirmó"),
  salePrice: cozteProductFields.salePrice.nullable().describe("Precio por unidad; null si no se informó. No uses 0 para representar un dato desconocido"),
  salesVariablePerUnit: cozteProductFields.salesVariablePerUnit.nullable().describe("Gasto variable por unidad; null si no se informó. Usa 0 solo si se confirmó que no existe"),
  laborCostPerLot: cozteProductFields.laborCostPerLot.nullable().describe("Trabajo directo por lote; null si no se informó. No reemplaces lo desconocido por 0"),
  productionHoursPerLot: cozteProductFields.productionHoursPerLot.nullable().describe("Horas por lote; null si no se informó. No reemplaces lo desconocido por 0"),
};

const cozteProductPatchToolFields = {
  name: cozteProductFields.name.optional(),
  lotUnits: cozteProductFields.lotUnits.optional(),
  salePrice: cozteProductFields.salePrice.optional(),
  salesVariablePerUnit: cozteProductFields.salesVariablePerUnit.optional(),
  laborCostPerLot: cozteProductFields.laborCostPerLot.optional(),
  productionHoursPerLot: cozteProductFields.productionHoursPerLot.optional(),
};

function createCostActionSchema(dateSchema: z.ZodType<string>, toolInput = false) {
  return z.discriminatedUnion("action", [
    z.object({ action: z.literal("create-category"), name: z.string() }),
    z.object({ action: z.literal("rename-category"), id: z.string(), name: z.string() }),
    z.object({ action: z.literal("create-material"), name: z.string(), supplier: z.string(), purchaseUnit: z.string(), category: z.string(), price: z.number().optional(), currency: z.enum(supportedCurrencies).optional(), source: z.string().optional(), effectiveDate: z.optional(dateSchema) }),
    z.object({ action: z.literal("delete-material"), id: z.string() }),
    z.object({ action: z.literal("update-material-meta"), id: z.string(), field: z.enum(["name", "supplier", "purchaseUnit", "category"]), value: z.string() }),
    z.object({ action: z.literal("create-expense"), name: z.string(), period: z.string(), amount: z.number(), currency: z.enum(supportedCurrencies), allocationBasis: z.enum(["hours", "units", "manual"]), shares: z.record(z.string(), z.number()).default({}), category: z.string(), source: z.string() }),
    z.object({ action: z.literal("update-expense-meta"), id: z.string(), field: z.enum(["name", "category", "period", "allocationBasis"]), value: z.string() }),
    z.object({ action: z.literal("update-expense-allocation"), id: z.string(), basis: z.enum(["hours", "units", "manual"]), shares: z.record(z.string(), z.number()).default({}) }),
    z.object({ action: z.literal("set-component"), productId: z.string(), materialId: z.string(), quantityMilli: z.number() }),
    z.object({ action: z.literal("create-product"), ...(toolInput ? cozteProductCreateToolFields : cozteProductFields), cloneProductId: z.string().optional() }),
    z.object({ action: z.literal("create-products"), products: z.array(z.object({ ...(toolInput ? cozteProductCreateToolFields : cozteProductFields), cloneProductId: z.string().optional() })).min(2).max(10) }),
    z.object({ action: z.literal("update-product"), id: z.string(), ...(toolInput ? cozteProductPatchToolFields : cozteProductFields) }),
    z.object({ action: z.literal("delete-product"), id: z.string() }),
  ]);
}

export const cozteCostActionSchema = createCostActionSchema(z.iso.date());
export const cozteCostActionToolSchema = createCostActionSchema(isoDateToolInputSchema, true);

export const cozteMaterialPriceSchema = z.object({
  materialId: z.string(),
  amount: z.number().nonnegative(),
  currency: z.enum(supportedCurrencies),
  source: z.string().trim().max(160).nullable(),
  effectiveDate: z.iso.date().optional(),
});

export const cozteMaterialPriceToolSchema = z.object({
  materialId: z.string(),
  amount: z.number().nonnegative(),
  currency: z.enum(supportedCurrencies),
  source: z.string().trim().max(160).nullable(),
  effectiveDate: isoDateToolInputSchema.optional(),
});
