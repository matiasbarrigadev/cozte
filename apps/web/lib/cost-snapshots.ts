import { calculateCosts, type DomainState } from "./domain";
import type { SnapshotRow } from "./cost-analysis";

/** Snapshot rows for every product, in the same shape a confirmed change stores (used by the demo and tests). */
export function snapshotRowsFor(state: DomainState, at: string): SnapshotRow[] {
  return calculateCosts(state).map((cost) => ({
    product_id: cost.productId, total_lot_minor: cost.totalLotMinor, unit_minor: cost.unitMinor, created_at: at,
    lines_json: JSON.stringify(cost.lines), warnings_json: JSON.stringify(cost.warnings),
    context_json: JSON.stringify({
      product: state.products.find((item) => item.id === cost.productId),
      materials: state.materials.filter((item) => state.components.some((component) => component.productId === cost.productId && component.materialId === item.id)),
      expenses: state.expenses.filter((item) => item.period === state.activePeriod),
      allocationPeers: state.products.map((item) => ({ id: item.id, lotUnits: item.lotUnits, productionHoursMilli: item.productionHoursMilli, batchesPerMonthMilli: item.batchesPerMonthMilli ?? null })),
      activePeriod: state.activePeriod,
    }),
  }));
}
