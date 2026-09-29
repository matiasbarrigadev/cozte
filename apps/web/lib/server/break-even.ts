import "server-only";
import { z } from "zod";
import { DEFAULT_MIX_PLAN, MIX_SOURCES, buildBreakEvenPlan, type BreakEvenPlan, type MixSource, type ProductSales, type SalesMixPlan } from "@/lib/break-even";
import { calculateCosts } from "@/lib/domain";
import { ApiError, type Principal } from "./auth";
import { dbBatch, dbQuery } from "./db";
import { organizationToday } from "./business";
import { loadState } from "./state";

/** The planned sales mix of each business and the break-even of a normal month built on it. */

type MixRow = { basis: "units" | "revenue"; source: MixSource; shares_json: string; target_profit_minor: number; note: string };

export async function loadSalesMix(principal: Principal): Promise<SalesMixPlan> {
  const [row] = await dbQuery<MixRow>("SELECT basis, source, shares_json, target_profit_minor, note FROM sales_mix_plans WHERE organization_id=?", [principal.organizationId]);
  if (!row) return DEFAULT_MIX_PLAN;
  let shares: Record<string, number> = {};
  try { shares = JSON.parse(row.shares_json); } catch { shares = {}; }
  return { basis: row.basis, source: row.source, shares, targetProfitMinor: row.target_profit_minor, note: row.note };
}

export const salesMixInputSchema = z.object({
  basis: z.enum(["units", "revenue"]).optional(),
  source: z.enum(MIX_SOURCES as [MixSource, ...MixSource[]]).optional(),
  /** Product id → share in percent (manual source); normalized so they add up to 100 %. */
  shares: z.record(z.string().min(1).max(120), z.number().min(0).max(100)).optional(),
  targetProfit: z.number().min(0).max(1_000_000_000_000).optional(),
  note: z.string().trim().max(300).optional(),
});

/** Saves the mix (only what is given changes); manual shares are normalized to add up to 100 %. */
export async function saveSalesMix(principal: Principal, input: z.input<typeof salesMixInputSchema>, source: "user" | "cozte"): Promise<{ plan: SalesMixPlan; done: string[] }> {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para cambiar el plan");
  const value = salesMixInputSchema.parse(input);
  const current = await loadSalesMix(principal);
  let shares = current.shares;
  if (value.shares) {
    const state = await loadState(principal);
    const ids = new Set(state.products.map((product) => product.id));
    const entries = Object.entries(value.shares).filter(([id]) => ids.has(id));
    const total = entries.reduce((sum, [, share]) => sum + share, 0);
    if (!entries.length || total <= 0) throw new ApiError(400, "Indica qué parte de las ventas es cada producto");
    shares = Object.fromEntries(entries.map(([id, share]) => [id, Math.round(share / total * 10000)]));
  }
  const plan: SalesMixPlan = {
    basis: value.basis ?? current.basis,
    source: value.source ?? (value.shares ? "manual" : current.source),
    shares, targetProfitMinor: value.targetProfit !== undefined ? Math.round(value.targetProfit) : current.targetProfitMinor,
    note: value.note ?? current.note,
  };
  if (plan.source === "manual" && !Object.values(plan.shares).some((share) => share > 0)) throw new ApiError(400, "Para una mezcla elegida, indica qué parte es cada producto");
  const org = principal.organizationId;
  await dbBatch([
    { sql: "INSERT INTO sales_mix_plans (organization_id, basis, source, shares_json, target_profit_minor, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT (organization_id) DO UPDATE SET basis=excluded.basis, source=excluded.source, shares_json=excluded.shares_json, target_profit_minor=excluded.target_profit_minor, note=excluded.note, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP", params: [org, plan.basis, plan.source, JSON.stringify(plan.shares), plan.targetProfitMinor, plan.note, principal.userId] },
    { sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), org, principal.userId, "save-sales-mix", org, JSON.stringify({ ...plan, source }) ] },
  ]);
  return { plan, done: ["Mezcla de ventas guardada"] };
}

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const previousMonth = (month: string) => { const [year, number] = month.split("-").map(Number); return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, "0")}`; };
const nextMonth = (month: string) => { const [year, number] = month.split("-").map(Number); return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`; };

/** Units and revenue sold of each product in a month. */
async function salesByProduct(principal: Principal, month: string): Promise<ProductSales> {
  const rows = await dbQuery<{ product_id: string; units: number; revenue: number }>(
    "SELECT si.product_id, SUM(si.quantity_milli) / 1000.0 AS units, SUM(si.quantity_milli * si.unit_price_minor) / 1000.0 AS revenue FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.organization_id=? AND s.archived_at IS NULL AND s.sold_on >= ? AND s.sold_on < ? GROUP BY si.product_id",
    [principal.organizationId, `${month}-01`, `${nextMonth(month)}-01`]);
  return Object.fromEntries(rows.map((row) => [row.product_id, { units: row.units, revenue: row.revenue }]));
}

export async function loadBreakEven(principal: Principal): Promise<{ plan: BreakEvenPlan; mix: SalesMixPlan; month: string; lastMonth: string }> {
  const today = await organizationToday(principal);
  const month = today.slice(0, 7);
  const last = previousMonth(month);
  const [state, mix, lastMonth, thisMonth] = await Promise.all([loadState(principal), loadSalesMix(principal), salesByProduct(principal, last), salesByProduct(principal, month)]);
  const plan = buildBreakEvenPlan({ state, costs: calculateCosts(state), plan: mix, lastMonth, thisMonth, lastMonthLabel: MONTH_NAMES[Number(last.slice(5, 7)) - 1] });
  return { plan, mix, month, lastMonth: last };
}
