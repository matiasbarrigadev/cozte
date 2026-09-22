import "server-only";
import { z } from "zod";
import { calculateCosts, type DomainState } from "@/lib/domain";
import { ApiError, type Principal } from "./auth";
import { dbBatch, type SqlStatement } from "./db";
import { loadState } from "./state";

const name = z.string().trim().min(2).max(120);
const money = z.number().int().min(0).max(1_000_000_000_000);
const positive = z.number().int().min(1).max(1_000_000_000);
const id = z.string().min(1).max(120);
const category = z.string().trim().min(2).max(40);
const common = z.object({
  expectedRevision: z.number().int().min(0),
  idempotencyKey: z.uuid(),
});

export const mutationSchema = z.discriminatedUnion("action", [
  common.extend({
    action: z.literal("bulk-prices"),
    materials: z.array(z.object({ id, priceMinor: money })).max(100),
    expenses: z.array(z.object({ id, amountMinor: money })).max(100),
    source: z.string().trim().min(2).max(200),
    effectiveDate: z.iso.date(),
  }),
  common.extend({
    action: z.literal("create-material"),
    name, supplier: z.string().trim().max(120), purchaseUnit: name,
    category: category.optional(),
    priceMinor: money.optional(), source: z.string().trim().max(200).optional(),
  }),
  common.extend({
    action: z.literal("update-material-meta"), id,
    field: z.enum(["name", "supplier", "purchaseUnit", "category"]),
    value: z.string().trim().max(120),
    acknowledgeImpact: z.boolean().optional(),
  }),
  common.extend({
    action: z.literal("create-product"),
    name, lotUnits: positive, salePriceMinor: money,
    salesVariableMinor: money, laborLotMinor: money,
    productionHoursMilli: z.number().int().min(0).max(1_000_000_000),
    cloneProductId: id.optional(),
  }),
  common.extend({
    action: z.literal("update-product"), id, name,
    lotUnits: positive, salePriceMinor: money, salesVariableMinor: money,
    laborLotMinor: money, productionHoursMilli: z.number().int().min(0).max(1_000_000_000),
  }),
  common.extend({
    action: z.literal("set-component"), productId: id, materialId: id,
    quantityMilli: z.number().int().min(0).max(1_000_000_000),
  }),
  common.extend({
    action: z.literal("create-expense"), name, period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    amountMinor: money, allocationBasis: z.enum(["hours", "units"]), category: category.optional(), source: name,
  }),
  common.extend({
    action: z.literal("update-expense-meta"), id,
    field: z.enum(["name", "category", "allocationBasis"]),
    value: z.string().trim().max(120),
    acknowledgeImpact: z.boolean().optional(),
  }),
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
        material.priceMinor = item.priceMinor;
        material.version++;
        material.source = input.source;
        material.effectiveDate = input.effectiveDate;
      }
      for (const item of input.expenses) {
        const expense = next.expenses.find((row) => row.id === item.id);
        if (!expense) throw new ApiError(404, "Gasto no encontrado");
        if (expense.period !== next.activePeriod) throw new ApiError(400, "Solo puedes editar los gastos del período activo");
        expense.amountMinor = item.amountMinor;
        expense.version++;
      }
      break;
    case "create-material":
      next.materials.push({ id: "new", name: input.name, supplier: input.supplier,
        purchaseUnit: input.purchaseUnit, category: input.category ?? "Materia prima", priceMinor: input.priceMinor ?? null,
        source: input.source ?? null, effectiveDate: input.priceMinor == null ? null : new Date().toISOString().slice(0, 10), version: 1 });
      break;
    case "update-material-meta": {
      const material = next.materials.find((item) => item.id === input.id);
      if (!material) throw new ApiError(404, "Insumo no encontrado");
      if (input.field !== "supplier" && input.value.length < 2) throw new ApiError(400, "Escribe al menos dos caracteres");
      if (input.field === "category" && input.value.length > 40) throw new ApiError(400, "La categoría es demasiado larga");
      if (input.field === "purchaseUnit" && input.value !== material.purchaseUnit && next.components.some((item) => item.materialId === input.id) && !input.acknowledgeImpact) throw new ApiError(400, "Confirma el cambio de unidad para los productos afectados");
      material[input.field] = input.value;
      break;
    }
    case "create-product": {
      if (input.cloneProductId && !next.products.some((item) => item.id === input.cloneProductId)) throw new ApiError(404, "Producto base no encontrado");
      next.products.push({ id: "new", name: input.name, lotUnits: input.lotUnits,
        salePriceMinor: input.salePriceMinor, salesVariableMinor: input.salesVariableMinor,
        laborLotMinor: input.laborLotMinor, productionHoursMilli: input.productionHoursMilli, version: 1 });
      if (input.cloneProductId) {
        next.components.push(...next.components.filter((item) => item.productId === input.cloneProductId).map((item) => ({ ...item, productId: "new" })));
      }
      break;
    }
    case "update-product": {
      const product = next.products.find((item) => item.id === input.id);
      if (!product) throw new ApiError(404, "Producto no encontrado");
      Object.assign(product, { name: input.name, lotUnits: input.lotUnits,
        salePriceMinor: input.salePriceMinor, salesVariableMinor: input.salesVariableMinor,
        laborLotMinor: input.laborLotMinor, productionHoursMilli: input.productionHoursMilli,
        version: product.version + 1 });
      break;
    }
    case "set-component":
      if (!next.products.some((item) => item.id === input.productId) || !next.materials.some((item) => item.id === input.materialId)) throw new ApiError(404, "Producto o insumo no encontrado");
      next.components = next.components.filter((item) => item.productId !== input.productId || item.materialId !== input.materialId);
      if (input.quantityMilli > 0) next.components.push({ productId: input.productId, materialId: input.materialId, quantityMilli: input.quantityMilli });
      break;
    case "create-expense":
      if (input.period < next.activePeriod) throw new ApiError(400, "El período es anterior al costeo activo");
      next.activePeriod = input.period;
      next.expenses.push({ id: "new", name: input.name, period: input.period,
        amountMinor: input.amountMinor, allocationBasis: input.allocationBasis, category: input.category ?? "Gastos generales", version: 1 });
      break;
    case "update-expense-meta": {
      const expense = next.expenses.find((item) => item.id === input.id);
      if (!expense) throw new ApiError(404, "Gasto no encontrado");
      if (expense.period !== next.activePeriod) throw new ApiError(400, "Solo puedes editar los gastos del período activo");
      if (input.field !== "allocationBasis" && (input.value.length < 2 || (input.field === "category" && input.value.length > 40))) throw new ApiError(400, "Revisa el nombre o categoría");
      if (input.field === "allocationBasis") {
        if (input.value !== "hours" && input.value !== "units") throw new ApiError(400, "Base de reparto inválida");
        if (input.value !== expense.allocationBasis && expense.amountMinor > 0 && next.products.length > 0 && !input.acknowledgeImpact) throw new ApiError(400, "Confirma el nuevo reparto antes de aplicar");
        expense.allocationBasis = input.value;
      } else expense[input.field] = input.value;
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

export async function commitMutation(principal: Principal, input: Mutation) {
  const state = await loadState(principal);
  const { next, before } = previewMutation(state, input);
  const organizationId = principal.organizationId;
  const actorId = principal.userId;
  const changeSetId = crypto.randomUUID();
  const entityId = crypto.randomUUID();
  const statements: SqlStatement[] = [
    { sql: "INSERT INTO change_sets (id, organization_id, idempotency_key, actor_id, expected_revision, payload_json) VALUES (?, ?, ?, ?, ?, ?)", params: [changeSetId, organizationId, input.idempotencyKey, actorId, input.expectedRevision, JSON.stringify(input)] },
    { sql: "INSERT INTO commit_assertions (change_set_id, valid) VALUES (?, (SELECT CASE WHEN revision=? THEN 1 ELSE 0 END FROM organizations WHERE id=?))", params: [changeSetId, input.expectedRevision, organizationId] },
  ];
  switch (input.action) {
    case "bulk-prices":
      for (const item of input.materials) {
        const current = state.materials.find((row) => row.id === item.id)!;
        statements.push(
          { sql: "UPDATE materials SET version=version+1 WHERE id=? AND organization_id=?", params: [item.id, organizationId] },
          { sql: "INSERT INTO material_prices (id, organization_id, material_id, version, amount_minor, source, effective_date, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), organizationId, item.id, current.version + 1, item.priceMinor, input.source, input.effectiveDate, actorId] },
          { sql: "UPDATE cost_alerts SET status='resolved', resolved_at=CURRENT_TIMESTAMP, last_checked_at=CURRENT_TIMESTAMP WHERE organization_id=? AND material_id=? AND kind='stale_price' AND status='open'", params: [organizationId, item.id] },
        );
      }
      for (const item of input.expenses) {
        const current = state.expenses.find((row) => row.id === item.id)!;
        statements.push(
          { sql: "UPDATE shared_expenses SET amount_minor=?, version=version+1 WHERE id=? AND organization_id=?", params: [item.amountMinor, item.id, organizationId] },
          { sql: "INSERT INTO shared_expense_versions (id, organization_id, expense_id, version, amount_minor, source, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), organizationId, item.id, current.version + 1, item.amountMinor, input.source, actorId] },
        );
      }
      break;
    case "create-material":
      statements.push({ sql: "INSERT INTO materials (id, organization_id, name, supplier, purchase_unit, category) VALUES (?, ?, ?, ?, ?, ?)", params: [entityId, organizationId, input.name, input.supplier, input.purchaseUnit, input.category ?? "Materia prima"] });
      if (input.priceMinor != null) statements.push({ sql: "INSERT INTO material_prices (id, organization_id, material_id, version, amount_minor, source, effective_date, actor_id) VALUES (?, ?, ?, 1, ?, ?, ?, ?)", params: [crypto.randomUUID(), organizationId, entityId, input.priceMinor, input.source || "Carga manual", new Date().toISOString().slice(0, 10), actorId] });
      next.materials.find((item) => item.id === "new")!.id = entityId;
      break;
    case "update-material-meta": {
      const column = { name: "name", supplier: "supplier", purchaseUnit: "purchase_unit", category: "category" }[input.field];
      statements.push({ sql: `UPDATE materials SET ${column}=? WHERE id=? AND organization_id=?`, params: [input.value, input.id, organizationId] });
      break;
    }
    case "create-product":
      statements.push({ sql: "INSERT INTO products (id, organization_id, name, lot_units, sale_price_minor, sales_variable_minor, labor_lot_minor, production_hours_milli) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", params: [entityId, organizationId, input.name, input.lotUnits, input.salePriceMinor, input.salesVariableMinor, input.laborLotMinor, input.productionHoursMilli] });
      if (input.cloneProductId) {
        for (const component of state.components.filter((item) => item.productId === input.cloneProductId)) statements.push({ sql: "INSERT INTO product_materials (product_id, material_id, quantity_milli) VALUES (?, ?, ?)", params: [entityId, component.materialId, component.quantityMilli] });
      }
      next.products.find((item) => item.id === "new")!.id = entityId;
      for (const component of next.components) if (component.productId === "new") component.productId = entityId;
      break;
    case "update-product":
      statements.push({ sql: "UPDATE products SET name=?, lot_units=?, sale_price_minor=?, sales_variable_minor=?, labor_lot_minor=?, production_hours_milli=?, version=version+1 WHERE id=? AND organization_id=?", params: [input.name, input.lotUnits, input.salePriceMinor, input.salesVariableMinor, input.laborLotMinor, input.productionHoursMilli, input.id, organizationId] });
      break;
    case "set-component":
      if (input.quantityMilli === 0) statements.push({ sql: "DELETE FROM product_materials WHERE product_id=? AND material_id=? AND product_id IN (SELECT id FROM products WHERE organization_id=?)", params: [input.productId, input.materialId, organizationId] });
      else statements.push({ sql: "INSERT INTO product_materials (product_id, material_id, quantity_milli) VALUES (?, ?, ?) ON CONFLICT (product_id, material_id) DO UPDATE SET quantity_milli=excluded.quantity_milli", params: [input.productId, input.materialId, input.quantityMilli] });
      break;
    case "create-expense":
      statements.push(
        { sql: "INSERT INTO shared_expenses (id, organization_id, name, period, amount_minor, allocation_basis, category) VALUES (?, ?, ?, ?, ?, ?, ?)", params: [entityId, organizationId, input.name, input.period, input.amountMinor, input.allocationBasis, input.category ?? "Gastos generales"] },
        { sql: "INSERT INTO shared_expense_versions (id, organization_id, expense_id, version, amount_minor, source, actor_id) VALUES (?, ?, ?, 1, ?, ?, ?)", params: [crypto.randomUUID(), organizationId, entityId, input.amountMinor, input.source, actorId] },
      );
      next.expenses.find((item) => item.id === "new")!.id = entityId;
      break;
    case "update-expense-meta": {
      const column = { name: "name", category: "category", allocationBasis: "allocation_basis" }[input.field];
      statements.push({ sql: `UPDATE shared_expenses SET ${column}=? WHERE id=? AND organization_id=?`, params: [input.value, input.id, organizationId] });
      break;
    }
    case "record-decision":
      statements.push({ sql: "INSERT INTO decisions (id, organization_id, product_id, kind, note, actor_id) VALUES (?, ?, ?, ?, ?, ?)", params: [entityId, organizationId, input.productId, input.kind, input.note, actorId] });
      break;
  }
  statements.push({ sql: "UPDATE organizations SET revision=revision+1 WHERE id=?", params: [organizationId] });
  statements.push({ sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), organizationId, actorId, input.action, entityId, JSON.stringify(input)] });

  // Snapshots are saved with the same transaction as the input change.
  for (const cost of calculateCosts(next)) {
    statements.push({ sql: "INSERT INTO cost_snapshots (id, organization_id, product_id, change_set_id, total_lot_minor, unit_minor, margin_percent, lines_json, warnings_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), organizationId, cost.productId === "new" ? entityId : cost.productId, changeSetId, cost.totalLotMinor, cost.unitMinor, cost.estimatedMarginPercent, JSON.stringify(cost.lines), JSON.stringify(cost.warnings)] });
  }
  if (statements.length > 100) throw new ApiError(400, "Demasiados cambios en una confirmación");
  await dbBatch(statements);
  return { revision: next.revision, entityId, before, after: calculateCosts(next) };
}
