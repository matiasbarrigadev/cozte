import "server-only";
import { z } from "zod";
import { allocateMinor, calculateCosts, convertToOrganizationCurrency, type DomainState } from "@/lib/domain";
import { supportedCurrencies, toNativeMilli, type Currency } from "@/lib/currency";
import { ApiError, type Principal } from "./auth";
import { dbBatch, type SqlStatement } from "./db";
import { loadState } from "./state";
import { loadProductionProfile } from "./production-profile";
import { officialFxTable, quotesFor } from "./fx";
import { calculateProductionCosts, type ProductionProfile } from "@/lib/production-profile";

const name = z.string().trim().min(2).max(120);
const money = z.number().int().min(0).max(1_000_000_000_000);
const positive = z.number().int().min(1).max(1_000_000_000);
const id = z.string().min(1).max(120);
const category = z.string().trim().min(2).max(40);
const sourceAmount = z.number().nonnegative().max(1_000_000_000).refine((value) => Math.round(value * 1000) / 1000 === value, "Usa hasta tres decimales");
const currency = z.enum(supportedCurrencies);
const common = z.object({
  expectedRevision: z.number().int().min(0),
  idempotencyKey: z.uuid(),
});
const newProduct = z.object({
  name, lotUnits: positive, salePriceMinor: money,
  salesVariableMinor: money, laborLotMinor: money,
  productionHoursMilli: z.number().int().min(0).max(1_000_000_000),
  batchesPerMonthMilli: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
  cloneProductId: id.optional(),
});

export const mutationSchema = z.discriminatedUnion("action", [
  common.extend({
    action: z.literal("bulk-prices"),
    materials: z.array(z.object({ id, amount: sourceAmount, currency })).max(100),
    expenses: z.array(z.object({ id, amount: sourceAmount, currency })).max(100),
    expectedFxRates: z.record(z.string(), z.number().int().positive()).default({}),
    source: z.string().trim().min(2).max(200),
    effectiveDate: z.iso.date(),
  }),
  common.extend({
    action: z.literal("create-material"),
    name, supplier: z.string().trim().max(120), purchaseUnit: name,
    category: category.optional(), effectiveDate: z.iso.date().optional(),
    price: sourceAmount.optional(), currency: currency.optional(), source: z.string().trim().max(200).optional(),
  }),
  common.extend({ action: z.literal("delete-material"), id }),
  common.extend({
    action: z.literal("update-material-meta"), id,
    field: z.enum(["name", "supplier", "purchaseUnit", "category"]),
    value: z.string().trim().max(120),
    acknowledgeImpact: z.boolean().optional(),
  }),
  common.extend({
    action: z.literal("create-product"),
    ...newProduct.shape,
  }),
  common.extend({
    action: z.literal("create-products"),
    products: z.array(newProduct).min(2).max(10).refine((items) => new Set(items.map((item) => item.name.toLocaleLowerCase())).size === items.length, "Los productos deben tener nombres únicos"),
  }),
  common.extend({
    action: z.literal("update-product"), id, name,
    lotUnits: positive, salePriceMinor: money, salesVariableMinor: money,
    laborLotMinor: money, productionHoursMilli: z.number().int().min(0).max(1_000_000_000),
    batchesPerMonthMilli: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
  }),
  common.extend({ action: z.literal("delete-product"), id }),
  common.extend({
    action: z.literal("set-component"), productId: id, materialId: id,
    quantityMilli: z.number().int().min(0).max(1_000_000_000),
  }),
  common.extend({
    action: z.literal("set-components"), productId: id,
    items: z.array(z.object({ materialId: id, quantityMilli: z.number().int().min(0).max(1_000_000_000) })).min(1).max(40)
      .refine((items) => new Set(items.map((item) => item.materialId)).size === items.length, "Cada insumo debe aparecer una sola vez"),
  }),
  common.extend({
    action: z.literal("create-expense"), name, period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    amount: sourceAmount, currency, allocationBasis: z.enum(["hours", "units", "manual"]), shares: z.record(z.string(), z.number().int().min(0).max(10000)).default({}), category: category.optional(), source: name,
  }),
  common.extend({
    action: z.literal("update-expense-meta"), id,
    field: z.enum(["name", "category", "allocationBasis", "period"]),
    value: z.string().trim().max(120),
    acknowledgeImpact: z.boolean().optional(),
  }),
  common.extend({ action: z.literal("create-category"), name: category }),
  common.extend({ action: z.literal("rename-category"), id, name: category }),
  common.extend({ action: z.literal("update-expense-allocation"), id, basis: z.enum(["hours", "units", "manual"]), shares: z.record(z.string(), z.number().int().min(0).max(10000)).default({}), acknowledgeImpact: z.boolean().optional() }),
  common.extend({
    action: z.literal("record-decision"), productId: id,
    kind: z.enum(["price", "supplier", "production", "other"]),
    note: z.string().trim().min(3).max(2000),
  }),
]);

export type Mutation = z.infer<typeof mutationSchema>;

function assertUnique(values: string[]) {
  if (new Set(values).size !== values.length) throw new ApiError(400, "Hay filas duplicadas");
}

function projection(state: DomainState, input: Mutation): DomainState {
  const next = structuredClone(state);
  switch (input.action) {
    case "bulk-prices":
      assertUnique(input.materials.map((item) => item.id));
      assertUnique(input.expenses.map((item) => item.id));
      for (const item of input.materials) {
        const material = next.materials.find((row) => row.id === item.id);
        if (!material) throw new ApiError(404, "Insumo no encontrado");
        const nativeMilli = toNativeMilli(item.amount);
        const converted = convertToOrganizationCurrency(next, nativeMilli, item.currency);
        if (converted === null) throw new ApiError(503, `Falta cotización vigente de ${item.currency} a ${next.organization.currency}`);
        material.priceMinor = converted;
        material.currency = item.currency;
        material.nativeAmountMilli = nativeMilli;
        material.version++;
        material.source = input.source;
        material.effectiveDate = input.effectiveDate;
      }
      for (const item of input.expenses) {
        const expense = next.expenses.find((row) => row.id === item.id);
        if (!expense) throw new ApiError(404, "Gasto no encontrado");
        if (expense.period !== next.activePeriod) throw new ApiError(400, "Solo puedes editar los gastos del período activo");
        const nativeMilli = toNativeMilli(item.amount);
        const converted = convertToOrganizationCurrency(next, nativeMilli, item.currency);
        if (converted === null) throw new ApiError(503, `Falta cotización vigente de ${item.currency} a ${next.organization.currency}`);
        expense.amountMinor = converted;
        expense.currency = item.currency;
        expense.nativeAmountMilli = nativeMilli;
        expense.fxMissing = false;
        expense.version++;
      }
      break;
    case "create-material":
      if (!next.categories?.some((item) => item.name.toLocaleLowerCase() === (input.category ?? "Materia prima").toLocaleLowerCase())) next.categories = [...next.categories ?? [], { id: "new-category", name: input.category ?? "Materia prima" }];
      next.materials.push({ id: "new", name: input.name, supplier: input.supplier,
        purchaseUnit: input.purchaseUnit, category: input.category ?? "Materia prima",
        priceMinor: input.price === undefined ? null : convertToOrganizationCurrency(next, toNativeMilli(input.price), input.currency ?? next.organization.currency),
        currency: input.currency ?? next.organization.currency, nativeAmountMilli: input.price === undefined ? null : toNativeMilli(input.price),
        source: input.source ?? null, effectiveDate: input.price === undefined ? null : input.effectiveDate ?? new Date().toISOString().slice(0, 10), version: 1 });
      if (input.price !== undefined && next.materials.at(-1)?.priceMinor === null) throw new ApiError(503, "Falta cotización vigente para el nuevo insumo");
      break;
    case "update-material-meta": {
      const material = next.materials.find((item) => item.id === input.id);
      if (!material) throw new ApiError(404, "Insumo no encontrado");
      if (input.field !== "supplier" && input.value.length < 2) throw new ApiError(400, "Escribe al menos dos caracteres");
      if (input.field === "category" && input.value.length > 40) throw new ApiError(400, "La categoría es demasiado larga");
      if (input.field === "category" && !next.categories?.some((item) => item.name.toLocaleLowerCase() === input.value.toLocaleLowerCase())) next.categories = [...next.categories ?? [], { id: "new-category", name: input.value }];
      if (input.field === "purchaseUnit" && input.value !== material.purchaseUnit && next.components.some((item) => item.materialId === input.id) && !input.acknowledgeImpact) throw new ApiError(400, "Confirma el cambio de unidad para los productos afectados");
      material[input.field] = input.value;
      break;
    }
    case "create-product": {
      if (next.products.some((item) => item.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) throw new ApiError(400, `El producto ${input.name} ya existe`);
      if (input.cloneProductId && !next.products.some((item) => item.id === input.cloneProductId)) throw new ApiError(404, "Producto base no encontrado");
      next.products.push({ id: "new", name: input.name, lotUnits: input.lotUnits,
        salePriceMinor: input.salePriceMinor, salesVariableMinor: input.salesVariableMinor,
        laborLotMinor: input.laborLotMinor, productionHoursMilli: input.productionHoursMilli, batchesPerMonthMilli: input.batchesPerMonthMilli ?? null, version: 1 });
      if (input.cloneProductId) {
        next.components.push(...next.components.filter((item) => item.productId === input.cloneProductId).map((item) => ({ ...item, productId: "new" })));
      }
      break;
    }
    case "delete-material": {
      if (!next.materials.some((item) => item.id === input.id)) throw new ApiError(404, "Insumo no encontrado");
      next.materials = next.materials.filter((item) => item.id !== input.id);
      next.components = next.components.filter((item) => item.materialId !== input.id);
      break;
    }
    case "create-products": {
      const existing = new Set(next.products.map((item) => item.name.toLocaleLowerCase()));
      for (const [index, product] of input.products.entries()) {
        if (existing.has(product.name.toLocaleLowerCase())) throw new ApiError(400, `El producto ${product.name} ya existe`);
        if (product.cloneProductId && !next.products.some((item) => item.id === product.cloneProductId)) throw new ApiError(404, `No encontramos el producto base de ${product.name}`);
        existing.add(product.name.toLocaleLowerCase());
        next.products.push({ id: `new:${index}`, name: product.name, lotUnits: product.lotUnits,
          salePriceMinor: product.salePriceMinor, salesVariableMinor: product.salesVariableMinor,
          laborLotMinor: product.laborLotMinor, productionHoursMilli: product.productionHoursMilli, batchesPerMonthMilli: product.batchesPerMonthMilli ?? null, version: 1 });
        if (product.cloneProductId) {
          next.components.push(...next.components.filter((item) => item.productId === product.cloneProductId).map((item) => ({ ...item, productId: `new:${index}` })));
        }
      }
      break;
    }
    case "update-product": {
      const product = next.products.find((item) => item.id === input.id);
      if (!product) throw new ApiError(404, "Producto no encontrado");
      Object.assign(product, { name: input.name, lotUnits: input.lotUnits,
        salePriceMinor: input.salePriceMinor, salesVariableMinor: input.salesVariableMinor,
        laborLotMinor: input.laborLotMinor, productionHoursMilli: input.productionHoursMilli,
        batchesPerMonthMilli: input.batchesPerMonthMilli === undefined ? product.batchesPerMonthMilli ?? null : input.batchesPerMonthMilli,
        version: product.version + 1 });
      break;
    }
    case "delete-product": {
      if (!next.products.some((item) => item.id === input.id)) throw new ApiError(404, "Producto no encontrado");
      next.products = next.products.filter((item) => item.id !== input.id);
      next.components = next.components.filter((item) => item.productId !== input.id);
      for (const expense of next.expenses) {
        if (expense.allocationBasis !== "manual" || !expense.allocationShares?.[input.id]) continue;
        const remainingActivities = next.products.map((product) => ({ id: product.id, weight: expense.allocationShares?.[product.id] ?? 0 }));
        const total = remainingActivities.reduce((sum, item) => sum + item.weight, 0);
        expense.allocationShares = total > 0 ? allocateMinor(10_000, remainingActivities) : {};
      }
      break;
    }
    case "set-component":
      if (!next.products.some((item) => item.id === input.productId) || !next.materials.some((item) => item.id === input.materialId)) throw new ApiError(404, "Producto o insumo no encontrado");
      next.components = next.components.filter((item) => item.productId !== input.productId || item.materialId !== input.materialId);
      if (input.quantityMilli > 0) next.components.push({ productId: input.productId, materialId: input.materialId, quantityMilli: input.quantityMilli });
      break;
    case "set-components": {
      if (!next.products.some((item) => item.id === input.productId)) throw new ApiError(404, "Producto no encontrado");
      for (const item of input.items) if (!next.materials.some((material) => material.id === item.materialId)) throw new ApiError(404, "Insumo no encontrado");
      const touched = new Set(input.items.map((item) => item.materialId));
      next.components = next.components.filter((item) => item.productId !== input.productId || !touched.has(item.materialId));
      for (const item of input.items) if (item.quantityMilli > 0) next.components.push({ productId: input.productId, materialId: item.materialId, quantityMilli: item.quantityMilli });
      break;
    }
    case "create-expense":
      if (!next.categories?.some((item) => item.name.toLocaleLowerCase() === (input.category ?? "Gastos generales").toLocaleLowerCase())) next.categories = [...next.categories ?? [], { id: "new-category", name: input.category ?? "Gastos generales" }];
      if (input.period < next.activePeriod) throw new ApiError(400, "El período es anterior al costeo activo");
      next.activePeriod = input.period;
      const converted = convertToOrganizationCurrency(next, toNativeMilli(input.amount), input.currency);
      if (converted === null) throw new ApiError(503, "Falta cotización vigente para el nuevo gasto");
      if (input.allocationBasis === "manual" && (Object.keys(input.shares).some((key) => !next.products.some((item) => item.id === key)) || next.products.reduce((sum, item) => sum + (input.shares[item.id] ?? 0), 0) !== 10000)) throw new ApiError(400, "Los porcentajes deben sumar 100 % entre los productos actuales");
      next.expenses.push({ id: "new", name: input.name, period: input.period,
        amountMinor: converted, currency: input.currency, nativeAmountMilli: toNativeMilli(input.amount),
        allocationBasis: input.allocationBasis, allocationShares: input.allocationBasis === "manual" ? input.shares : {}, category: input.category ?? "Gastos generales", version: 1 });
      break;
    case "update-expense-meta": {
      const expense = next.expenses.find((item) => item.id === input.id);
      if (!expense) throw new ApiError(404, "Gasto no encontrado");
      if (expense.period !== next.activePeriod) throw new ApiError(400, "Solo puedes editar los gastos del período activo");
      if (input.field === "period" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.value)) throw new ApiError(400, "Elige un período válido");
      if (input.field !== "allocationBasis" && input.field !== "period" && (input.value.length < 2 || (input.field === "category" && input.value.length > 40))) throw new ApiError(400, "Revisa el nombre o categoría");
      if (input.field === "category" && !next.categories?.some((item) => item.name.toLocaleLowerCase() === input.value.toLocaleLowerCase())) next.categories = [...next.categories ?? [], { id: "new-category", name: input.value }];
      if (input.field === "allocationBasis") {
        if (input.value !== "hours" && input.value !== "units") throw new ApiError(400, "Base de reparto inválida");
        if (input.value !== expense.allocationBasis && expense.amountMinor > 0 && next.products.length > 0 && !input.acknowledgeImpact) throw new ApiError(400, "Confirma el nuevo reparto antes de aplicar");
        expense.allocationBasis = input.value;
      } else if (input.field === "period") {
        if (input.value !== expense.period && expense.amountMinor > 0 && next.products.length > 0 && !input.acknowledgeImpact) throw new ApiError(400, "Confirma el cambio de período y su impacto antes de aplicar");
        expense.period = input.value;
        next.activePeriod = next.expenses.map((item) => item.period).sort().at(-1) ?? next.activePeriod;
      } else expense[input.field] = input.value;
      break;
    }
    case "create-category":
      if (next.categories?.some((item) => item.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) throw new ApiError(400, "La categoría ya existe");
      next.categories = [...next.categories ?? [], { id: "new", name: input.name }];
      break;
    case "rename-category": {
      const current = next.categories?.find((item) => item.id === input.id);
      if (!current) throw new ApiError(404, "Categoría no encontrada");
      if (next.categories?.some((item) => item.id !== input.id && item.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) throw new ApiError(400, "La categoría ya existe");
      next.materials.forEach((item) => { if (item.category.toLocaleLowerCase() === current.name.toLocaleLowerCase()) item.category = input.name; });
      next.expenses.forEach((item) => { if (item.category.toLocaleLowerCase() === current.name.toLocaleLowerCase()) item.category = input.name; });
      current.name = input.name;
      break;
    }
    case "update-expense-allocation": {
      const expense = next.expenses.find((item) => item.id === input.id);
      if (!expense) throw new ApiError(404, "Gasto no encontrado");
      if (expense.period !== next.activePeriod) throw new ApiError(400, "Solo puedes editar los gastos del período activo");
      if (input.basis === "manual") {
        const productIds = new Set(next.products.map((item) => item.id));
        if (Object.keys(input.shares).some((key) => !productIds.has(key)) || next.products.reduce((sum, item) => sum + (input.shares[item.id] ?? 0), 0) !== 10000) throw new ApiError(400, "Los porcentajes deben sumar 100 % entre los productos actuales");
      }
      if (!input.acknowledgeImpact && expense.amountMinor > 0 && next.products.length) throw new ApiError(400, "Confirma el reparto antes de aplicar");
      expense.allocationBasis = input.basis;
      expense.allocationShares = input.basis === "manual" ? input.shares : {};
      break;
    }
    case "record-decision":
      if (!next.products.some((item) => item.id === input.productId)) throw new ApiError(404, "Producto no encontrado");
      break;
  }
  next.revision++;
  return next;
}

export function previewMutation(state: DomainState, input: Mutation) {
  if (state.revision !== input.expectedRevision) throw new ApiError(409, "Los datos cambiaron. Actualiza la página antes de continuar");
  const next = projection(state, input);
  return { next, before: calculateCosts(state), after: calculateCosts(next) };
}

export async function commitMutation(principal: Principal, input: Mutation, options: { assistantProposalId?: string; source?: "cozte" | "user" } = {}) {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para modificar costos");
  const [state, profile] = await Promise.all([loadState(principal), loadProductionProfile(principal)]);
  const inputCurrencies: Currency[] = input.action === "bulk-prices" ? [...input.materials, ...input.expenses].map((item) => item.currency) : input.action === "create-material" ? [input.currency ?? state.organization.currency] : input.action === "create-expense" ? [input.currency] : [];
  const existingForeign = [...state.materials, ...state.expenses].some((item) => item.currency && item.currency !== state.organization.currency);
  if (existingForeign || inputCurrencies.some((item) => item !== state.organization.currency)) {
    state.fxQuotes = quotesFor(state.organization.currency, await officialFxTable());
    for (const material of state.materials) if (material.currency && material.currency !== state.organization.currency && material.nativeAmountMilli != null) {
      material.priceMinor = convertToOrganizationCurrency(state, material.nativeAmountMilli, material.currency);
      if (material.priceMinor === null) throw new ApiError(503, `Falta cotización vigente para ${material.currency}`);
    }
    for (const expense of state.expenses) if (expense.currency && expense.currency !== state.organization.currency && expense.nativeAmountMilli != null) {
      const converted = convertToOrganizationCurrency(state, expense.nativeAmountMilli, expense.currency);
      if (converted === null) throw new ApiError(503, `Falta cotización vigente para ${expense.currency}`);
      expense.amountMinor = converted;
      expense.fxMissing = false;
    }
  }
  if (input.action === "bulk-prices") {
    const reviewedCurrencies = new Set<Currency>([...inputCurrencies, ...state.materials.map((item) => item.currency ?? state.organization.currency), ...state.expenses.map((item) => item.currency ?? state.organization.currency)]);
    for (const code of reviewedCurrencies) if (code !== state.organization.currency && state.fxQuotes?.[code]?.ratePpm !== input.expectedFxRates[code]) throw new ApiError(409, "La cotización cambió. Revisa el impacto otra vez");
  }
  const { next, before } = previewMutation(state, input);
  const organizationId = principal.organizationId;
  const actorId = principal.userId;
  const changeSetId = crypto.randomUUID();
  const entityId = input.action === "delete-material" || input.action === "delete-product" ? input.id : crypto.randomUUID();
  const proposalAssertionId = options.assistantProposalId ? crypto.randomUUID() : null;
  const productEntityIds = input.action === "create-products" ? input.products.map((_, index) => index === 0 ? entityId : crypto.randomUUID()) : [entityId];
  const statements: SqlStatement[] = [
    ...(options.assistantProposalId ? [{ sql: "INSERT INTO assistant_proposal_assertions (id, valid) VALUES (?, (SELECT CASE WHEN status='pending' AND kind='cost-mutation' AND organization_id=? THEN 1 ELSE 0 END FROM assistant_proposals WHERE id=?))", params: [proposalAssertionId, organizationId, options.assistantProposalId] }] : []),
    { sql: "INSERT INTO change_sets (id, organization_id, idempotency_key, actor_id, expected_revision, payload_json) VALUES (?, ?, ?, ?, ?, ?)", params: [changeSetId, organizationId, input.idempotencyKey, actorId, input.expectedRevision, JSON.stringify(input)] },
    { sql: "INSERT INTO commit_assertions (change_set_id, valid) VALUES (?, (SELECT CASE WHEN revision=? THEN 1 ELSE 0 END FROM organizations WHERE id=?))", params: [changeSetId, input.expectedRevision, organizationId] },
  ];
  const usedCurrencies = new Set<Currency>([...inputCurrencies, ...next.materials.map((item) => item.currency ?? next.organization.currency), ...next.expenses.map((item) => item.currency ?? next.organization.currency)]);
  for (const code of usedCurrencies) {
    if (code === next.organization.currency) continue;
    const quote = next.fxQuotes?.[code];
    if (!quote) throw new ApiError(503, `Falta cotización vigente para ${code}`);
    statements.push({ sql: "INSERT OR IGNORE INTO fx_quotes (id, from_currency, to_currency, rate_ppm, as_of, source, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), quote.from, quote.to, quote.ratePpm, quote.asOf, quote.source, quote.sourceUrl] });
  }
  const fxFields = (code: Currency, nativeMilli: number): (string | number | null)[] => {
    const quote = code === next.organization.currency ? null : next.fxQuotes?.[code];
    return [code, nativeMilli, quote?.ratePpm ?? 1_000_000, quote?.asOf ?? null, quote?.source ?? null];
  };
  const newCategory = next.categories?.find((item) => item.id === "new-category");
  if (newCategory) statements.push({ sql: "INSERT OR IGNORE INTO cost_categories (id, organization_id, name) VALUES (?, ?, ?)", params: [crypto.randomUUID(), organizationId, newCategory.name] });
  switch (input.action) {
    case "bulk-prices":
      for (const item of input.materials) {
        const current = state.materials.find((row) => row.id === item.id)!;
        statements.push(
          { sql: "UPDATE materials SET version=version+1 WHERE id=? AND organization_id=?", params: [item.id, organizationId] },
          { sql: "INSERT INTO material_prices (id, organization_id, material_id, version, amount_minor, source, effective_date, actor_id, currency, native_amount_milli, fx_rate_ppm, fx_as_of, fx_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), organizationId, item.id, current.version + 1, next.materials.find((row) => row.id === item.id)!.priceMinor, input.source, input.effectiveDate, actorId, ...fxFields(item.currency, toNativeMilli(item.amount))] },
          { sql: "UPDATE cost_alerts SET status='resolved', resolved_at=CURRENT_TIMESTAMP, last_checked_at=CURRENT_TIMESTAMP WHERE organization_id=? AND material_id=? AND kind='stale_price' AND status='open'", params: [organizationId, item.id] },
        );
      }
      for (const item of input.expenses) {
        const current = state.expenses.find((row) => row.id === item.id)!;
        statements.push(
          { sql: "UPDATE shared_expenses SET amount_minor=?, currency=?, native_amount_milli=?, fx_rate_ppm=?, fx_as_of=?, fx_source=?, version=version+1 WHERE id=? AND organization_id=?", params: [next.expenses.find((row) => row.id === item.id)!.amountMinor, ...fxFields(item.currency, toNativeMilli(item.amount)), item.id, organizationId] },
          { sql: "INSERT INTO shared_expense_versions (id, organization_id, expense_id, version, amount_minor, source, actor_id, currency, native_amount_milli, fx_rate_ppm, fx_as_of, fx_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), organizationId, item.id, current.version + 1, next.expenses.find((row) => row.id === item.id)!.amountMinor, input.source, actorId, ...fxFields(item.currency, toNativeMilli(item.amount))] },
        );
      }
      break;
    case "create-material":
      statements.push({ sql: "INSERT INTO materials (id, organization_id, name, supplier, purchase_unit, category) VALUES (?, ?, ?, ?, ?, ?)", params: [entityId, organizationId, input.name, input.supplier, input.purchaseUnit, input.category ?? "Materia prima"] });
      if (input.price !== undefined) statements.push({ sql: "INSERT INTO material_prices (id, organization_id, material_id, version, amount_minor, source, effective_date, actor_id, currency, native_amount_milli, fx_rate_ppm, fx_as_of, fx_source) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), organizationId, entityId, next.materials.find((item) => item.id === "new")!.priceMinor, input.source || "Carga manual", input.effectiveDate ?? new Date().toISOString().slice(0, 10), actorId, ...fxFields(input.currency ?? next.organization.currency, toNativeMilli(input.price))] });
      next.materials.find((item) => item.id === "new")!.id = entityId;
      break;
    case "delete-material":
      statements.push({ sql: "UPDATE materials SET archived_at=CURRENT_TIMESTAMP, version=version+1 WHERE id=? AND organization_id=? AND archived_at IS NULL", params: [input.id, organizationId] });
      break;
    case "update-material-meta": {
      const column = { name: "name", supplier: "supplier", purchaseUnit: "purchase_unit", category: "category" }[input.field];
      statements.push({ sql: `UPDATE materials SET ${column}=? WHERE id=? AND organization_id=?`, params: [input.value, input.id, organizationId] });
      break;
    }
    case "create-product":
      statements.push({ sql: "INSERT INTO products (id, organization_id, name, lot_units, sale_price_minor, sales_variable_minor, labor_lot_minor, production_hours_milli, batches_per_month_milli) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [entityId, organizationId, input.name, input.lotUnits, input.salePriceMinor, input.salesVariableMinor, input.laborLotMinor, input.productionHoursMilli, input.batchesPerMonthMilli ?? null] });
      if (input.cloneProductId) {
        for (const component of state.components.filter((item) => item.productId === input.cloneProductId)) statements.push({ sql: "INSERT INTO product_materials (product_id, material_id, quantity_milli) VALUES (?, ?, ?)", params: [entityId, component.materialId, component.quantityMilli] });
      }
      next.products.find((item) => item.id === "new")!.id = entityId;
      for (const component of next.components) if (component.productId === "new") component.productId = entityId;
      break;
    case "update-product":
      statements.push({ sql: "UPDATE products SET name=?, lot_units=?, sale_price_minor=?, sales_variable_minor=?, labor_lot_minor=?, production_hours_milli=?, batches_per_month_milli=?, version=version+1 WHERE id=? AND organization_id=?", params: [input.name, input.lotUnits, input.salePriceMinor, input.salesVariableMinor, input.laborLotMinor, input.productionHoursMilli, next.products.find((item) => item.id === input.id)!.batchesPerMonthMilli ?? null, input.id, organizationId] });
      break;
    case "delete-product":
      statements.push({ sql: "UPDATE products SET archived_at=CURRENT_TIMESTAMP, version=version+1 WHERE id=? AND organization_id=? AND archived_at IS NULL", params: [input.id, organizationId] });
      for (const expense of state.expenses) {
        if (expense.allocationBasis !== "manual") continue;
        const updated = next.expenses.find((item) => item.id === expense.id);
        if (updated && JSON.stringify(updated.allocationShares ?? {}) !== JSON.stringify(expense.allocationShares ?? {})) {
          statements.push({ sql: "UPDATE shared_expenses SET allocation_shares_json=? WHERE id=? AND organization_id=?", params: [JSON.stringify(updated.allocationShares ?? {}), expense.id, organizationId] });
        }
      }
      break;
    case "set-component":
      if (input.quantityMilli === 0) statements.push({ sql: "DELETE FROM product_materials WHERE product_id=? AND material_id=? AND product_id IN (SELECT id FROM products WHERE organization_id=?)", params: [input.productId, input.materialId, organizationId] });
      else statements.push({ sql: "INSERT INTO product_materials (product_id, material_id, quantity_milli) VALUES (?, ?, ?) ON CONFLICT (product_id, material_id) DO UPDATE SET quantity_milli=excluded.quantity_milli", params: [input.productId, input.materialId, input.quantityMilli] });
      break;
    case "set-components":
      for (const item of input.items) {
        if (item.quantityMilli === 0) statements.push({ sql: "DELETE FROM product_materials WHERE product_id=? AND material_id=? AND product_id IN (SELECT id FROM products WHERE organization_id=?)", params: [input.productId, item.materialId, organizationId] });
        else statements.push({ sql: "INSERT INTO product_materials (product_id, material_id, quantity_milli) VALUES (?, ?, ?) ON CONFLICT (product_id, material_id) DO UPDATE SET quantity_milli=excluded.quantity_milli", params: [input.productId, item.materialId, item.quantityMilli] });
      }
      break;
    case "create-expense":
      statements.push(
        { sql: "INSERT INTO shared_expenses (id, organization_id, name, period, amount_minor, allocation_basis, allocation_mode, allocation_shares_json, category, currency, native_amount_milli, fx_rate_ppm, fx_as_of, fx_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [entityId, organizationId, input.name, input.period, next.expenses.find((item) => item.id === "new")!.amountMinor, input.allocationBasis === "manual" ? "units" : input.allocationBasis, input.allocationBasis === "manual" ? "manual" : "automatic", JSON.stringify(input.allocationBasis === "manual" ? input.shares : {}), input.category ?? "Gastos generales", ...fxFields(input.currency, toNativeMilli(input.amount))] },
        { sql: "INSERT INTO shared_expense_versions (id, organization_id, expense_id, version, amount_minor, source, actor_id, currency, native_amount_milli, fx_rate_ppm, fx_as_of, fx_source) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), organizationId, entityId, next.expenses.find((item) => item.id === "new")!.amountMinor, input.source, actorId, ...fxFields(input.currency, toNativeMilli(input.amount))] },
      );
      next.expenses.find((item) => item.id === "new")!.id = entityId;
      break;
    case "update-expense-meta": {
      const column = { name: "name", category: "category", allocationBasis: "allocation_basis", period: "period" }[input.field];
      statements.push({ sql: `UPDATE shared_expenses SET ${column}=? WHERE id=? AND organization_id=?`, params: [input.value, input.id, organizationId] });
      break;
    }
    case "create-category":
      statements.push({ sql: "INSERT INTO cost_categories (id, organization_id, name) VALUES (?, ?, ?)", params: [entityId, organizationId, input.name] });
      next.categories!.find((item) => item.id === "new")!.id = entityId;
      break;
    case "rename-category": {
      const previous = state.categories?.find((item) => item.id === input.id);
      if (!previous) throw new ApiError(404, "Categoría no encontrada");
      statements.push(
        { sql: "UPDATE cost_categories SET name=? WHERE id=? AND organization_id=?", params: [input.name, input.id, organizationId] },
        { sql: "UPDATE materials SET category=? WHERE organization_id=? AND archived_at IS NULL AND lower(category)=lower(?)", params: [input.name, organizationId, previous.name] },
        { sql: "UPDATE shared_expenses SET category=? WHERE organization_id=? AND lower(category)=lower(?)", params: [input.name, organizationId, previous.name] },
      );
      if (profile.confirmed || profile.draft) {
        const renamed = (data: ProductionProfile | null) => data ? { ...data, categories: data.categories.map((item) => item.name.toLocaleLowerCase() === previous.name.toLocaleLowerCase() ? { ...item, name: input.name } : item), inputs: data.inputs.map((item) => item.category.toLocaleLowerCase() === previous.name.toLocaleLowerCase() ? { ...item, category: input.name } : item), recurringCosts: data.recurringCosts.map((item) => item.category.toLocaleLowerCase() === previous.name.toLocaleLowerCase() ? { ...item, category: input.name } : item) } : null;
        const confirmed = renamed(profile.confirmed);
        const draft = renamed(profile.draft);
        statements.push(
          { sql: "INSERT INTO production_profile_commit_assertions (id, valid) VALUES (?, (SELECT CASE WHEN revision=? THEN 1 ELSE 0 END FROM production_profiles WHERE organization_id=?))", params: [crypto.randomUUID(), profile.revision, organizationId] },
          { sql: "UPDATE production_profiles SET confirmed_json=?, draft_json=?, revision=revision+1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE organization_id=?", params: [confirmed ? JSON.stringify(confirmed) : null, draft ? JSON.stringify(draft) : null, actorId, organizationId] },
        );
        if (confirmed) statements.push({ sql: "INSERT INTO production_profile_snapshots (id, organization_id, revision, profile_json, costs_json, fx_context_json, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), organizationId, profile.revision + 1, JSON.stringify(confirmed), JSON.stringify(calculateProductionCosts(confirmed, state.organization.currency, state.fxQuotes)), JSON.stringify(state.fxQuotes ?? {}), actorId] });
      }
      break;
    }
    case "create-products":
      for (const [index, product] of input.products.entries()) {
        const productId = productEntityIds[index];
        statements.push({ sql: "INSERT INTO products (id, organization_id, name, lot_units, sale_price_minor, sales_variable_minor, labor_lot_minor, production_hours_milli, batches_per_month_milli) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [productId, organizationId, product.name, product.lotUnits, product.salePriceMinor, product.salesVariableMinor, product.laborLotMinor, product.productionHoursMilli, product.batchesPerMonthMilli ?? null] });
        if (product.cloneProductId) {
          for (const component of next.components.filter((item) => item.productId === product.cloneProductId)) statements.push({ sql: "INSERT INTO product_materials (product_id, material_id, quantity_milli) VALUES (?, ?, ?)", params: [productId, component.materialId, component.quantityMilli] });
        }
      }
      break;
    case "update-expense-allocation":
      statements.push({ sql: "UPDATE shared_expenses SET allocation_basis=?, allocation_mode=?, allocation_shares_json=? WHERE id=? AND organization_id=?", params: [input.basis === "manual" ? "units" : input.basis, input.basis === "manual" ? "manual" : "automatic", JSON.stringify(input.basis === "manual" ? input.shares : {}), input.id, organizationId] });
      break;
    case "record-decision":
      statements.push({ sql: "INSERT INTO decisions (id, organization_id, product_id, kind, note, actor_id) VALUES (?, ?, ?, ?, ?, ?)", params: [entityId, organizationId, input.productId, input.kind, input.note, actorId] });
      break;
  }
  statements.push({ sql: "UPDATE organizations SET revision=revision+1 WHERE id=?", params: [organizationId] });
  statements.push({ sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), organizationId, actorId, input.action, entityId, JSON.stringify(options.source ? { ...input, source: options.source } : input)] });

  // Snapshots are saved with the same transaction as the input change.
  for (const cost of calculateCosts(next)) {
    const snapshotContext = {
      product: next.products.find((item) => item.id === cost.productId),
      components: next.components.filter((item) => item.productId === cost.productId),
      materials: next.materials.filter((item) => next.components.some((component) => component.productId === cost.productId && component.materialId === item.id)),
      expenses: next.expenses.filter((item) => item.period === next.activePeriod),
      allocationPeers: next.products.map((item) => ({ id: item.id, lotUnits: item.lotUnits, productionHoursMilli: item.productionHoursMilli, batchesPerMonthMilli: item.batchesPerMonthMilli ?? null })),
      activePeriod: next.activePeriod,
      baseCurrency: next.organization.currency,
      fxQuotes: Object.fromEntries([...usedCurrencies].filter((code) => code !== next.organization.currency).map((code) => [code, next.fxQuotes?.[code]])),
      organizationRevision: next.revision,
      productionProfileRevision: profile.confirmedRevision,
    };
    const productId = cost.productId === "new" ? entityId : cost.productId.startsWith("new:") ? productEntityIds[Number(cost.productId.slice(4))] ?? entityId : cost.productId;
    statements.push({ sql: "INSERT INTO cost_snapshots (id, organization_id, product_id, change_set_id, total_lot_minor, unit_minor, margin_percent, lines_json, warnings_json, context_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), organizationId, productId, changeSetId, cost.totalLotMinor, cost.unitMinor, cost.estimatedMarginPercent === null ? null : String(cost.estimatedMarginPercent), JSON.stringify(cost.lines), JSON.stringify(cost.warnings), JSON.stringify(snapshotContext)] });
  }
  const result = { revision: next.revision, entityId, ...(input.action === "create-products" ? { entityIds: productEntityIds } : {}), before, after: calculateCosts(next) };
  if (options.assistantProposalId) {
    statements.push(
      { sql: "UPDATE assistant_proposals SET status='approved', decision_by=?, decision_note=NULL, decided_at=CURRENT_TIMESTAMP, result_json=?, payload_json=?, base_organization_revision=? WHERE id=? AND organization_id=? AND kind='cost-mutation' AND status='pending'", params: [actorId, JSON.stringify(result), JSON.stringify(input), input.expectedRevision, options.assistantProposalId, organizationId] },
      { sql: "INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json) VALUES (?, ?, ?, ?, 'approved', ?)", params: [crypto.randomUUID(), organizationId, options.assistantProposalId, actorId, JSON.stringify({ changeSetId, entityId, baseRevision: input.expectedRevision, revision: next.revision })] },
      { sql: "DELETE FROM assistant_proposal_assertions WHERE id=?", params: [proposalAssertionId] },
    );
  }
  if (statements.length > 100) throw new ApiError(400, "Demasiados cambios en una confirmación");
  await dbBatch(statements);
  return result;
}
