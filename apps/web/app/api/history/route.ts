import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { dbBatch } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const principal = await requirePrincipal();
    const org = principal.organizationId;
    const [events, snapshots, decisions] = await dbBatch([
      { sql: "SELECT id, action, entity_id, actor_id, created_at FROM audit_events WHERE organization_id=? ORDER BY created_at DESC LIMIT 50", params: [org] },
      { sql: "SELECT id, product_id, total_lot_minor, unit_minor, margin_percent, created_at FROM cost_snapshots WHERE organization_id=? ORDER BY created_at DESC LIMIT 100", params: [org] },
      { sql: "SELECT id, product_id, kind, note, actor_id, created_at FROM decisions WHERE organization_id=? ORDER BY created_at DESC LIMIT 50", params: [org] },
    ]);
    return Response.json({ events, snapshots, decisions }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
