import { createHash, timingSafeEqual } from "node:crypto";
import { calculateCosts } from "@/lib/domain";
import { dbBatch, dbQuery, type SqlStatement } from "@/lib/server/db";
import { officialFxTable } from "@/lib/server/fx";
import { loadStateForOrganization } from "@/lib/server/state";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const publication = await officialFxTable();
    const organizations = await dbQuery<{ id: string }>(`SELECT id FROM organizations o WHERE EXISTS (
      SELECT 1 FROM material_prices p JOIN materials m ON m.id=p.material_id WHERE m.organization_id=o.id AND p.version=m.version AND p.currency IS NOT NULL AND p.currency<>o.currency
    ) OR EXISTS (SELECT 1 FROM shared_expenses e WHERE e.organization_id=o.id AND e.currency IS NOT NULL AND e.currency<>o.currency) LIMIT 100`);
    let snapshotted = 0;
    for (const organization of organizations) {
      const state = await loadStateForOrganization(organization.id);
      if (!state.products.length) continue;
      const foreignCodes = [...new Set([...state.materials, ...state.expenses].map((item) => item.currency).filter((code) => code && code !== state.organization.currency))].sort();
      if (!foreignCodes.length || foreignCodes.some((code) => !state.fxQuotes?.[code!])) continue;
      const signature = foreignCodes.map((code) => `${code}:${state.fxQuotes?.[code!]?.ratePpm}`).join("|");
      const fingerprint = createHash("sha256").update(`${state.organization.currency}|${signature}`).digest("hex");
      const existing = await dbQuery<{ fingerprint: string }>("SELECT fingerprint FROM fx_revaluation_runs WHERE organization_id=? ORDER BY created_at DESC LIMIT 1", [organization.id]);
      if (existing[0]?.fingerprint === fingerprint) continue;
      const statements: SqlStatement[] = [{ sql: "INSERT INTO fx_revaluation_runs (organization_id, fingerprint, source, as_of) VALUES (?, ?, ?, ?)", params: [organization.id, fingerprint, publication.source, publication.asOf] }];
      for (const cost of calculateCosts(state)) {
        const context = { product: state.products.find((item) => item.id === cost.productId), materials: state.materials.filter((item) => state.components.some((component) => component.productId === cost.productId && component.materialId === item.id)), expenses: state.expenses.filter((item) => item.period === state.activePeriod), activePeriod: state.activePeriod, baseCurrency: state.organization.currency, fxQuotes: Object.fromEntries(foreignCodes.map((code) => [code, state.fxQuotes?.[code!]])), cause: "exchange-rate-update" };
        statements.push({ sql: "INSERT INTO cost_snapshots (id, organization_id, product_id, change_set_id, total_lot_minor, unit_minor, margin_percent, lines_json, warnings_json, context_json) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), organization.id, cost.productId, cost.totalLotMinor, cost.unitMinor, cost.estimatedMarginPercent, JSON.stringify(cost.lines), JSON.stringify(cost.warnings), JSON.stringify(context)] });
      }
      try { await dbBatch(statements); snapshotted += state.products.length; }
      catch (error) { console.error("FX snapshot failed", organization.id, error); }
    }
    return Response.json({ ok: true, source: publication.source, asOf: publication.asOf, organizations: organizations.length, snapshots: snapshotted });
  } catch (error) {
    console.error("FX cron failed", error);
    return Response.json({ error: "No se pudieron actualizar las cotizaciones" }, { status: 503 });
  }
}
