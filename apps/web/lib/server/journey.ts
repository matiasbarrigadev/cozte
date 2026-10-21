import "server-only";
import { productionExpenses, type DomainState } from "@/lib/domain";
import type { ExplanationLevel } from "@/lib/cozte-levels";
import {
  BUSINESS_MODES, DEFAULT_JOURNEYS, journeyDefinitionSchema, moduleAccess, parseJourneyDefinition, stageViews,
  type BusinessMode, type JourneyDefinition, type JourneyFacts, type JourneyView, type ModuleKey,
} from "@/lib/journey";
import { ApiError, type Principal } from "./auth";
import { dbBatch, dbQuery } from "./db";
import { loadCozteSettings } from "./cozte-settings";
import { loadBreakEven } from "./break-even";

/** Each company's discovery path: its definition, its progress and which sections it has opened. */

type OrganizationRow = { business_mode: BusinessMode | null; journey_key: string | null; unlock_all: number };

/** A path by key: the stored one when it is valid, else the one built into Cozte. */
export async function loadJourneyDefinition(key: string): Promise<{ key: string; definition: JourneyDefinition; stored: boolean; error: string | null }> {
  const fallback = DEFAULT_JOURNEYS[key as BusinessMode] ?? DEFAULT_JOURNEYS.operating;
  const [row] = await dbQuery<{ definition_json: string }>("SELECT definition_json FROM journey_definitions WHERE key=?", [key]);
  const { definition, error } = parseJourneyDefinition(row?.definition_json, fallback);
  if (error) console.error(`Journey definition ${key} is invalid; using the built-in one`, error);
  return { key, definition, stored: Boolean(row) && !error, error };
}

/** What the company has, counted, for the completion rules. */
export async function loadJourneyFacts(principal: Principal, state: DomainState): Promise<JourneyFacts> {
  const org = principal.organizationId;
  const [row] = await dbQuery<{ suppliers: number; purchases: number; channels: number; channels_with_delivery: number; zones: number; sales: number; deliveries: number; customers: number; recipes_confirmed: number }>(
    `SELECT
      (SELECT COUNT(*) FROM products p WHERE p.organization_id=? AND p.archived_at IS NULL AND p.recipe_confirmed_at IS NOT NULL AND EXISTS (SELECT 1 FROM product_materials m WHERE m.product_id=p.id)) AS recipes_confirmed,
      (SELECT COUNT(*) FROM suppliers WHERE organization_id=? AND archived_at IS NULL) AS suppliers,
      (SELECT COUNT(*) FROM purchases WHERE organization_id=? AND archived_at IS NULL) AS purchases,
      (SELECT COUNT(*) FROM sales_channels WHERE organization_id=? AND archived_at IS NULL) AS channels,
      (SELECT COUNT(*) FROM sales_channels WHERE organization_id=? AND archived_at IS NULL AND (delivery_method<>'' OR delivery_cost_per_order_minor>0)) AS channels_with_delivery,
      (SELECT COUNT(*) FROM delivery_zones WHERE organization_id=?) AS zones,
      (SELECT COUNT(*) FROM sales WHERE organization_id=? AND archived_at IS NULL) AS sales,
      (SELECT COUNT(*) FROM deliveries WHERE organization_id=? AND archived_at IS NULL) AS deliveries,
      (SELECT COUNT(*) FROM customers WHERE organization_id=? AND archived_at IS NULL) AS customers`,
    [org, org, org, org, org, org, org, org, org]);
  const used = new Set(state.components.map((item) => item.materialId));
  const usedMaterials = state.materials.filter((item) => used.has(item.id));
  return {
    products: state.products.length,
    productsWithRecipe: state.products.filter((product) => state.components.some((item) => item.productId === product.id)).length,
    productsWithPrice: state.products.filter((product) => product.salePriceMinor > 0).length,
    materialsUsed: usedMaterials.length,
    materialsUsedPriced: usedMaterials.filter((item) => item.priceMinor !== null).length,
    recipesConfirmed: row?.recipes_confirmed ?? 0,
    suppliers: row?.suppliers ?? 0, purchases: row?.purchases ?? 0,
    productionExpenses: productionExpenses(state).length,
    channels: row?.channels ?? 0, channelsWithDelivery: row?.channels_with_delivery ?? 0, deliveryZones: row?.zones ?? 0,
    sales: row?.sales ?? 0, deliveries: row?.deliveries ?? 0, customers: row?.customers ?? 0,
  };
}

/** Sections that already hold data of their own never close. */
function modulesWithData(state: DomainState, facts: JourneyFacts): Set<ModuleKey> {
  const modules = new Set<ModuleKey>();
  if (state.products.length || state.materials.length) { modules.add("planilla"); modules.add("historial"); }
  if (state.expenses.length) modules.add("gastos");
  if (facts.suppliers) modules.add("proveedores");
  if (facts.channels) modules.add("canales");
  if (facts.purchases) modules.add("compras");
  if (facts.sales) modules.add("ventas");
  if (facts.deliveries || facts.deliveryZones) modules.add("entregas");
  if (facts.customers) modules.add("clientes");
  return modules;
}

/**
 * The company's path as this person sees it. With `persist`, stages its data completed and sections they opened are
 * recorded (a section opened once stays open), and the sections opened by this load come back to be celebrated.
 */
export async function loadJourney(principal: Principal, state: DomainState, options: { persist: boolean; level?: ExplanationLevel | null } = { persist: false }): Promise<JourneyView> {
  const org = principal.organizationId;
  const [[organization], level] = await Promise.all([
    dbQuery<OrganizationRow>("SELECT business_mode, journey_key, unlock_all FROM organizations WHERE id=?", [org]),
    options.level !== undefined ? Promise.resolve(options.level) : loadCozteSettings(principal).then((settings) => settings.level).catch(() => null),
  ]);
  const { key, definition } = await loadJourneyDefinition(organization?.journey_key ?? organization?.business_mode ?? "operating");
  const mode: BusinessMode = organization?.business_mode ?? definition.mode;
  const [facts, progress, unlocks] = await Promise.all([
    loadJourneyFacts(principal, state),
    dbQuery<{ stage_id: string; completed_at: string | null }>("SELECT stage_id, completed_at FROM journey_progress WHERE organization_id=? AND journey_key=?", [org, key]),
    dbQuery<{ module: string }>("SELECT module FROM module_unlocks WHERE organization_id=?", [org]),
  ]);
  const stages = stageViews(definition, facts);
  const completed = new Set([...progress.filter((row) => row.completed_at).map((row) => row.stage_id), ...stages.filter((stage) => stage.status === "done").map((stage) => stage.id)]);
  const unlocked = new Set(unlocks.map((row) => row.module));
  const unlockAll = organization?.unlock_all === 1;
  const effectiveLevel: ExplanationLevel = level ?? "simple";
  const modules = moduleAccess(definition, { mode, level: effectiveLevel, unlockAll, completed, unlocked, withData: modulesWithData(state, facts), firstSale: facts.sales > 0 });
  // Truly open (not only shown to an advanced reader) and new: opened by this load.
  const opened = (Object.keys(modules) as ModuleKey[]).filter((module) => modules[module].state === "open" && !modules[module].badge && !definition.alwaysOpen.includes(module) && !unlocked.has(module));
  const newlyCompleted = stages.filter((stage) => stage.status === "done" && !progress.some((row) => row.stage_id === stage.id && row.completed_at));
  if (options.persist && !principal.adminView && (opened.length || newlyCompleted.length)) {
    await dbBatch([
      ...newlyCompleted.map((stage) => ({ sql: "INSERT INTO journey_progress (organization_id, journey_key, stage_id, completed_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT (organization_id, journey_key, stage_id) DO UPDATE SET completed_at=COALESCE(completed_at, CURRENT_TIMESTAMP)", params: [org, key, stage.id] })),
      ...opened.map((module) => ({ sql: "INSERT OR IGNORE INTO module_unlocks (organization_id, module) VALUES (?, ?)", params: [org, module] })),
    ], { retrySafe: true });
  }
  const done = stages.filter((stage) => stage.status === "done").length;
  return {
    key, name: definition.name, mode, level: effectiveLevel, stages, completed: done, total: stages.length,
    current: stages.find((stage) => stage.status === "current") ?? null,
    finale: { ...definition.finale, ready: done === stages.length },
    modules,
    newlyUnlocked: options.persist && !unlockAll ? opened : [],
  };
}

/** When the person starts a stage with Cozte: the start of the time it takes, for the path's metrics. */
export async function markStageStarted(principal: Principal, stageId: string): Promise<void> {
  if (principal.adminView || !/^[a-z0-9-]{2,40}$/.test(stageId)) return;
  const [organization] = await dbQuery<OrganizationRow>("SELECT business_mode, journey_key, unlock_all FROM organizations WHERE id=?", [principal.organizationId]);
  const key = organization?.journey_key ?? organization?.business_mode ?? "operating";
  await dbBatch([{ sql: "INSERT INTO journey_progress (organization_id, journey_key, stage_id, started_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT (organization_id, journey_key, stage_id) DO UPDATE SET started_at=COALESCE(started_at, CURRENT_TIMESTAMP)", params: [principal.organizationId, key, stageId] }], { retrySafe: true });
}

/** The person says a product's recipe is complete, or that it still misses something: what closes the supplies stage. */
export async function confirmRecipe(principal: Principal, productId: string, complete: boolean, reason: string): Promise<void> {
  if (principal.adminView || principal.role === "viewer") throw new ApiError(403, "No tienes permiso para cambiar esto");
  const org = principal.organizationId;
  await dbBatch([
    { sql: "UPDATE products SET recipe_confirmed_at=CASE WHEN ?=1 THEN COALESCE(recipe_confirmed_at, CURRENT_TIMESTAMP) ELSE NULL END WHERE id=? AND organization_id=?", params: [complete ? 1 : 0, productId, org] },
    { sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, 'confirm-recipe', ?, ?)", params: [crypto.randomUUID(), org, principal.userId, productId, JSON.stringify({ complete, reason })] },
  ]);
}

/**
 * What Cozte suggested adding to a recipe before confirming it, by turn. Over a suggestion, a recipe is confirmed only
 * on a later turn: the person has to have read it and answered.
 */
export async function recipeSuggestion(principal: Principal, productId: string, runId: string, items: string[]): Promise<"answered" | "asked-now"> {
  const rows = await dbQuery<{ details_json: string }>("SELECT details_json FROM audit_events WHERE organization_id=? AND entity_id=? AND action='suggest-recipe-items' ORDER BY created_at DESC LIMIT 10", [principal.organizationId, productId]);
  const earlier = rows.some((row) => { try { return (JSON.parse(row.details_json) as { runId?: string }).runId !== runId; } catch { return false; } });
  if (earlier) return "answered";
  if (!rows.length) await dbBatch([{ sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, 'suggest-recipe-items', ?, ?)", params: [crypto.randomUUID(), principal.organizationId, principal.userId, productId, JSON.stringify({ runId, items })] }]);
  return "asked-now";
}

/**
 * Whether the company already sells. Moving from a project to a business in operation keeps the project's plan
 * (costs, prices and break-even at that moment) to compare it later with what really happens. Stages started on the
 * path it leaves and never finished are dropped: they are not part of its progress.
 */
export async function saveBusinessMode(principal: Principal, mode: BusinessMode, source: "user" | "cozte"): Promise<{ mode: BusinessMode; planSaved: boolean }> {
  if (principal.adminView || principal.role === "viewer") throw new ApiError(403, "No tienes permiso para cambiar esto");
  if (!BUSINESS_MODES.includes(mode)) throw new ApiError(400, "Modo inválido");
  const org = principal.organizationId;
  const [current] = await dbQuery<OrganizationRow>("SELECT business_mode, journey_key, unlock_all FROM organizations WHERE id=?", [org]);
  let plan: string | null = null;
  if (mode === "operating" && current?.business_mode === "project") {
    const { plan: breakEven } = await loadBreakEven(principal);
    plan = JSON.stringify({
      at: new Date().toISOString(), currency: breakEven.currency, fixedTotal: breakEven.fixed.total,
      breakEven: breakEven.breakEven, target: breakEven.target,
      products: breakEven.products.map((product) => ({ id: product.productId, name: product.name, price: product.price, variableCost: product.variable.total, leaves: product.contributionUnit, unitsToBreakEven: product.unitsNeeded })),
    });
  }
  await dbBatch([
    { sql: "UPDATE organizations SET business_mode=? WHERE id=?", params: [mode, org] },
    { sql: "DELETE FROM journey_progress WHERE organization_id=? AND completed_at IS NULL AND journey_key<>?", params: [org, current?.journey_key ?? mode] },
    ...(plan ? [{ sql: "INSERT INTO business_plans (organization_id, snapshot_json) VALUES (?, ?) ON CONFLICT (organization_id) DO UPDATE SET snapshot_json=excluded.snapshot_json, created_at=CURRENT_TIMESTAMP", params: [org, plan] }] : []),
    { sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, 'set-business-mode', ?, ?)", params: [crypto.randomUUID(), org, principal.userId, org, JSON.stringify({ mode, from: current?.business_mode ?? null, source })] },
  ]);
  return { mode, planSaved: Boolean(plan) };
}

/** The plan a project kept when it started selling, if any. */
export async function loadBusinessPlan(principal: Principal): Promise<Record<string, unknown> | null> {
  const [row] = await dbQuery<{ snapshot_json: string }>("SELECT snapshot_json FROM business_plans WHERE organization_id=?", [principal.organizationId]);
  if (!row) return null;
  try { return JSON.parse(row.snapshot_json) as Record<string, unknown>; } catch { return null; }
}

/* ---- Superadmin: editing the paths and measuring them ---- */

export async function listJourneyDefinitions(): Promise<{ key: string; definition: JourneyDefinition; stored: boolean; error: string | null; json: string }[]> {
  const rows = await dbQuery<{ key: string }>("SELECT key FROM journey_definitions ORDER BY key");
  const keys = [...new Set([...Object.keys(DEFAULT_JOURNEYS), ...rows.map((row) => row.key)])];
  return Promise.all(keys.map(async (key) => {
    const loaded = await loadJourneyDefinition(key);
    return { ...loaded, json: JSON.stringify(loaded.definition, null, 2) };
  }));
}

export async function saveJourneyDefinition(adminUserId: string, key: string, json: string): Promise<JourneyDefinition> {
  if (!/^[a-z0-9-]{2,40}$/.test(key)) throw new ApiError(400, "La clave usa minúsculas, números y guiones");
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new ApiError(400, "No es un JSON válido"); }
  const result = journeyDefinitionSchema.safeParse(parsed);
  if (!result.success) throw new ApiError(400, `${result.error.issues[0]?.path.join(".") || "Definición"}: ${result.error.issues[0]?.message ?? "inválida"}`);
  await dbBatch([{ sql: "INSERT INTO journey_definitions (key, definition_json, version, updated_by) VALUES (?, ?, 1, ?) ON CONFLICT (key) DO UPDATE SET definition_json=excluded.definition_json, version=journey_definitions.version+1, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP", params: [key, JSON.stringify(result.data), adminUserId] }]);
  return result.data;
}

export async function resetJourneyDefinition(key: string): Promise<void> {
  await dbBatch([{ sql: "DELETE FROM journey_definitions WHERE key=?", params: [key] }]);
}

/** Per path and stage: how many companies started it, completed it, and the median days from sign-up to completion. */
export async function journeyMetrics(): Promise<{ key: string; stageId: string; started: number; completed: number; medianDays: number | null }[]> {
  const rows = await dbQuery<{ journey_key: string; stage_id: string; started_at: string | null; completed_at: string | null; created_at: string }>(
    "SELECT p.journey_key, p.stage_id, p.started_at, p.completed_at, o.created_at FROM journey_progress p JOIN organizations o ON o.id=p.organization_id");
  const groups = new Map<string, typeof rows>();
  for (const row of rows) groups.set(`${row.journey_key}|${row.stage_id}`, [...(groups.get(`${row.journey_key}|${row.stage_id}`) ?? []), row]);
  return [...groups.entries()].map(([group, items]) => {
    const [key, stageId] = group.split("|");
    const days = items.filter((item) => item.completed_at).map((item) => (Date.parse(`${item.completed_at!.replace(" ", "T")}Z`) - Date.parse(`${item.created_at.replace(" ", "T")}Z`)) / 864e5).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    const medianDays = days.length ? Math.round(days[Math.floor(days.length / 2)] * 10) / 10 : null;
    return { key, stageId, started: items.filter((item) => item.started_at).length, completed: items.filter((item) => item.completed_at).length, medianDays };
  });
}
