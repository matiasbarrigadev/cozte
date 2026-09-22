import { z } from "zod";
import { convertNativeMilli, supportedCurrencies, toNativeMilli, type Currency, type FxQuote } from "./currency";

const name = z.string().trim().min(1).max(100);
const evidence = z.object({ quality: z.enum(["measured", "estimated", "missing"]), source: z.string().trim().max(160).nullable(), asOf: z.iso.date().nullable() });
const originalAmount = z.number().nonnegative().max(1_000_000_000).refine((value) => Math.round(value * 1000) / 1000 === value, "Usa hasta tres decimales");

export const productionProfileSchema = z.object({
  businessSummary: z.string().trim().max(500),
  site: z.object({ name, location: z.string().trim().max(160) }).nullable(),
  stages: z.array(z.object({ name, notes: z.string().trim().max(240) })).max(20),
  products: z.array(z.object({ name, finishedUnit: name, goodUnitsPerBatch: z.number().int().positive().nullable(), startedUnitsPerBatch: z.number().int().positive().nullable(), normalScrapUnitsPerBatch: z.number().int().nonnegative().nullable(), batchesPerMonth: z.number().positive().nullable(), hoursPerBatch: z.number().positive().nullable() })).max(30),
  categories: z.array(z.object({
    name,
    kind: z.enum(["raw_material", "packaging", "direct_labor", "utilities", "overhead", "outsourced"]),
    behavior: z.enum(["direct", "shared"]),
  })).max(30),
  inputs: z.array(z.object({
    name,
    category: name,
    purchaseUnit: name,
    consumptionUnit: name,
    unitsPerPurchase: z.number().positive().nullable(),
    usage: z.array(z.object({ product: name, quantityPerBatch: z.number().nonnegative().nullable() })).max(30),
    pricePerPurchaseMinor: z.number().int().nonnegative().nullable(),
    pricePerPurchase: originalAmount.optional(),
    priceCurrency: z.enum(supportedCurrencies).optional(),
    evidence: evidence.optional(),
  })).max(80),
  recurringCosts: z.array(z.object({
    name,
    category: name,
    frequency: z.enum(["monthly", "quarterly", "annual"]),
    amountMinor: z.number().int().nonnegative().nullable(),
    amount: originalAmount.optional(),
    amountCurrency: z.enum(supportedCurrencies).optional(),
    allocation: z.enum(["production_hours", "finished_units", "manual_percentage"]),
    shares: z.array(z.object({ product: name, percent: z.number().min(0).max(100) })).max(30),
    evidence: evidence.optional(),
  })).max(60),
});

export type ProductionProfile = z.infer<typeof productionProfileSchema>;

export const emptyProductionProfile: ProductionProfile = {
  businessSummary: "", site: null, stages: [], products: [], categories: [], inputs: [], recurringCosts: [],
};

export function monthlyEquivalent(amountMinor: number, frequency: "monthly" | "quarterly" | "annual"): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error("Importe inválido");
  return frequency === "annual" ? amountMinor / 12 : frequency === "quarterly" ? amountMinor / 3 : amountMinor;
}

function profileMoney(original: number | null, currency: Currency | undefined, base: Currency, quotes: Partial<Record<Currency, FxQuote>>): number | null {
  if (original === null) return null;
  const code = currency ?? base;
  if (code === base) return Math.round(original);
  const quote = quotes[code];
  return quote?.to === base ? convertNativeMilli(toNativeMilli(original), quote) : null;
}

export function inputCostPerFinishedUnit(input: ProductionProfile["inputs"][number], product: ProductionProfile["products"][number], base: Currency = "CLP", quotes: Partial<Record<Currency, FxQuote>> = {}): number | null {
  const quantity = input.usage.find((item) => item.product.toLocaleLowerCase() === product.name.toLocaleLowerCase())?.quantityPerBatch;
  const price = profileMoney(input.pricePerPurchase ?? input.pricePerPurchaseMinor, input.priceCurrency, base, quotes);
  if (price === null || input.unitsPerPurchase === null || quantity == null || product.goodUnitsPerBatch === null) return null;
  return price / input.unitsPerPurchase * quantity / product.goodUnitsPerBatch;
}

export function allocateRecurringCost(cost: ProductionProfile["recurringCosts"][number], products: ProductionProfile["products"], base: Currency = "CLP", quotes: Partial<Record<Currency, FxQuote>> = {}): Record<string, number> | null {
  const amount = profileMoney(cost.amount ?? cost.amountMinor, cost.amountCurrency, base, quotes);
  if (amount === null || !products.length) return null;
  const monthly = monthlyEquivalent(amount, cost.frequency);
  const weights = products.map((product) => ({ name: product.name, weight: cost.allocation === "manual_percentage"
    ? cost.shares.find((share) => share.product.toLocaleLowerCase() === product.name.toLocaleLowerCase())?.percent ?? 0
    : cost.allocation === "production_hours" ? product.batchesPerMonth != null && product.hoursPerBatch != null ? product.batchesPerMonth * product.hoursPerBatch : null
    : product.batchesPerMonth != null && product.goodUnitsPerBatch != null ? product.batchesPerMonth * product.goodUnitsPerBatch : null }));
  if (weights.some((item) => item.weight === null)) return null;
  const total = weights.reduce((sum, item) => sum + (item.weight ?? 0), 0);
  if (total <= 0 || (cost.allocation === "manual_percentage" && Math.abs(total - 100) > 0.001)) return null;
  return Object.fromEntries(weights.map((item) => [item.name, monthly * (item.weight ?? 0) / total]));
}

export type ProfileCost = { product: string; monthlyMinor: number | null; unitMinor: number | null; directMonthlyMinor: number | null; sharedMonthlyMinor: number | null; warnings: string[] };

export function calculateProductionCosts(profile: ProductionProfile, base: Currency = "CLP", quotes: Partial<Record<Currency, FxQuote>> = {}): ProfileCost[] {
  const allocations = profile.recurringCosts.map((cost) => ({ cost, split: allocateRecurringCost(cost, profile.products, base, quotes) }));
  return profile.products.map((product) => {
    const warnings: string[] = [];
    const monthlyGoodUnits = product.goodUnitsPerBatch != null && product.batchesPerMonth != null ? product.goodUnitsPerBatch * product.batchesPerMonth : null;
    if (monthlyGoodUnits === null) warnings.push("Falta producción mensual apta");
    let directMonthlyMinor = 0;
    for (const input of profile.inputs) {
      if (!input.usage.length) { warnings.push(`${input.name} no está asignado a productos`); continue; }
      if (!input.usage.some((usage) => usage.product.toLocaleLowerCase() === product.name.toLocaleLowerCase())) continue;
      const perUnit = inputCostPerFinishedUnit(input, product, base, quotes);
      if (perUnit === null || monthlyGoodUnits === null) { warnings.push(`Falta consumo, conversión, precio o rendimiento de ${input.name}`); continue; }
      directMonthlyMinor += perUnit * monthlyGoodUnits;
    }
    let sharedMonthlyMinor = 0;
    for (const { cost, split } of allocations) {
      if (!split) { warnings.push(`Falta importe o base de reparto de ${cost.name}`); continue; }
      sharedMonthlyMinor += split[product.name] ?? 0;
    }
    if (warnings.length || monthlyGoodUnits === null || monthlyGoodUnits <= 0) return { product: product.name, monthlyMinor: null, unitMinor: null, directMonthlyMinor: null, sharedMonthlyMinor: null, warnings };
    const monthlyMinor = directMonthlyMinor + sharedMonthlyMinor;
    return { product: product.name, monthlyMinor, unitMinor: monthlyMinor / monthlyGoodUnits, directMonthlyMinor, sharedMonthlyMinor, warnings };
  });
}

export function profileGaps(profile: ProductionProfile): string[] {
  const gaps: string[] = [];
  if (!profile.site) gaps.push("Falta identificar dónde se fabrica");
  if (!profile.products.length) gaps.push("Faltan los productos terminados y empacados");
  if (!profile.stages.length) gaps.push("Faltan las etapas de fabricación y empaque");
  if (!profile.categories.length) gaps.push("Faltan categorías de costos acordadas con la empresa");
  for (const product of profile.products) {
    if (product.goodUnitsPerBatch === null) gaps.push(`Faltan unidades aptas por lote de ${product.name}`);
    if (product.startedUnitsPerBatch === null) gaps.push(`Faltan unidades iniciadas por lote de ${product.name}`);
    if (product.normalScrapUnitsPerBatch === null) gaps.push(`Falta merma normal de ${product.name}`);
    if (product.startedUnitsPerBatch !== null && product.goodUnitsPerBatch !== null && product.normalScrapUnitsPerBatch !== null && product.startedUnitsPerBatch - product.goodUnitsPerBatch !== product.normalScrapUnitsPerBatch) gaps.push(`Revisar pérdidas extraordinarias o diferencia de rendimiento de ${product.name}`);
    if (product.batchesPerMonth === null) gaps.push(`Falta volumen mensual de ${product.name}`);
    if (profile.recurringCosts.some((cost) => cost.allocation === "production_hours") && product.hoursPerBatch === null) gaps.push(`Faltan horas por lote de ${product.name}`);
  }
  for (const input of profile.inputs) {
    if (!input.usage.length) gaps.push(`Falta vincular ${input.name} con productos`);
    if (input.unitsPerPurchase === null) gaps.push(`Falta conversión de ${input.purchaseUnit} a ${input.consumptionUnit} para ${input.name}`);
    for (const usage of input.usage) if (usage.quantityPerBatch === null) gaps.push(`Falta consumo por lote de ${input.name} en ${usage.product}`);
    if (input.pricePerPurchaseMinor === null && input.pricePerPurchase === undefined) gaps.push(`Falta precio vigente de ${input.name}`);
    if (!input.evidence || input.evidence.quality === "missing") gaps.push(`Falta calidad o fuente de ${input.name}`);
  }
  for (const cost of profile.recurringCosts) {
    if (cost.amountMinor === null && cost.amount === undefined) gaps.push(`Falta importe de ${cost.name}`);
    if (!cost.evidence || cost.evidence.quality === "missing") gaps.push(`Falta calidad o fuente de ${cost.name}`);
    if (cost.allocation === "manual_percentage") {
      const total = cost.shares.reduce((sum, share) => sum + share.percent, 0);
      if (Math.abs(total - 100) > 0.001) gaps.push(`El reparto de ${cost.name} debe sumar 100 %`);
    }
  }
  return gaps;
}

export function validateProfileReferences(profile: ProductionProfile): string[] {
  const errors: string[] = [];
  for (const [label, items] of [["producto", profile.products], ["categoría", profile.categories], ["insumo", profile.inputs], ["gasto", profile.recurringCosts]] as const) {
    const names = items.map((item) => item.name.toLocaleLowerCase());
    if (new Set(names).size !== names.length) errors.push(`Hay nombres de ${label} duplicados`);
  }
  const products = new Set(profile.products.map((item) => item.name.toLocaleLowerCase()));
  const categories = new Map(profile.categories.map((item) => [item.name.toLocaleLowerCase(), item]));
  for (const input of profile.inputs) {
    const category = categories.get(input.category.toLocaleLowerCase());
    if (!category) errors.push(`Categoría inexistente: ${input.category}`);
    else if (category.behavior !== "direct") errors.push(`${input.name} necesita una categoría directa`);
    for (const usage of input.usage) if (!products.has(usage.product.toLocaleLowerCase())) errors.push(`Producto inexistente: ${usage.product}`);
  }
  for (const cost of profile.recurringCosts) {
    const category = categories.get(cost.category.toLocaleLowerCase());
    if (!category) errors.push(`Categoría inexistente: ${cost.category}`);
    else if (category.behavior !== "shared") errors.push(`${cost.name} necesita una categoría compartida`);
    for (const share of cost.shares) if (!products.has(share.product.toLocaleLowerCase())) errors.push(`Producto inexistente: ${share.product}`);
    if (new Set(cost.shares.map((share) => share.product.toLocaleLowerCase())).size !== cost.shares.length) errors.push(`Reparto duplicado en ${cost.name}`);
  }
  return errors;
}
