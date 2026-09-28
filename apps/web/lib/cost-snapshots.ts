import { calculateCosts, productionCostSources, type CostLine, type DomainState, type ProductCost } from "./domain";
import type { SnapshotRow } from "./cost-analysis";
import { roundMoney } from "./money";

const parse = <T,>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };

/**
 * Each product's cost as it stood at the end of a day: its latest complete snapshot on or before it. A product with no
 * complete cost by then keeps today's (the best estimate there is). This is the cost a sale of that day carries.
 */
export function costsAsOf(today: ProductCost[], rows: SnapshotRow[], date: string, currency: string): ProductCost[] {
  const limit = `${date} 23:59:59`;
  const latest = new Map<string, SnapshotRow>();
  for (const row of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (row.unit_minor === null || parse<string[]>(row.warnings_json, ["?"]).length) continue;
    if (row.created_at.replace("T", " ").slice(0, 19) <= limit) latest.set(row.product_id, row);
  }
  return today.map((cost) => {
    const row = latest.get(cost.productId);
    if (!row) return cost;
    const lines = parse<CostLine[]>(row.lines_json, []);
    const lotUnits = Math.max(parse<{ product?: { lotUnits?: number } }>(row.context_json, {}).product?.lotUnits ?? 1, 1);
    const perUnit = (kind: CostLine["kind"]) => roundMoney(lines.filter((line) => line.kind === kind).reduce((sum, line) => sum + line.amountMinor, 0) / lotUnits, currency);
    return { ...cost, unitMinor: row.unit_minor, totalLotMinor: row.total_lot_minor, perUnit: { materialMinor: perUnit("material"), laborMinor: perUnit("labor"), sharedMinor: perUnit("shared_expense") } };
  });
}

/**
 * What a cost snapshot keeps besides its lines: the product, its recipe and prices, every source spread into unit
 * costs (workshop expenses and included investments) and the peers of the allocation, so the analysis can split the
 * shared line per expense exactly as it was. Every snapshot (a confirmed change, an exchange-rate update, the demo)
 * stores this same shape.
 */
export function snapshotContext(state: DomainState, productId: string) {
  return {
    product: state.products.find((item) => item.id === productId),
    components: state.components.filter((item) => item.productId === productId),
    materials: state.materials.filter((item) => state.components.some((component) => component.productId === productId && component.materialId === item.id)),
    expenses: productionCostSources(state),
    allocationPeers: state.products.map((item) => ({ id: item.id, lotUnits: item.lotUnits, productionHoursMilli: item.productionHoursMilli, batchesPerMonthMilli: item.batchesPerMonthMilli ?? null })),
    activePeriod: state.activePeriod,
  };
}

/** Snapshot rows for every product, in the same shape a confirmed change stores (used by the demo and tests). */
export function snapshotRowsFor(state: DomainState, at: string): SnapshotRow[] {
  return calculateCosts(state).map((cost) => ({
    product_id: cost.productId, total_lot_minor: cost.totalLotMinor, unit_minor: cost.unitMinor, created_at: at,
    lines_json: JSON.stringify(cost.lines), warnings_json: JSON.stringify(cost.warnings),
    context_json: JSON.stringify(snapshotContext(state, cost.productId)),
  }));
}
