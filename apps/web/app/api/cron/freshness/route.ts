import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { dbBatch } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    await dbBatch([
      {
        sql: `INSERT INTO cost_alerts (id, organization_id, material_id, kind, status, message)
          SELECT lower(hex(randomblob(16))), m.organization_id, m.id, 'stale_price', 'open',
                 'Verificar precio de ' || m.name
          FROM materials m
          LEFT JOIN material_prices p ON p.material_id=m.id AND p.version=m.version
          WHERE p.id IS NULL OR p.effective_date < date('now', '-30 days')
          ON CONFLICT (organization_id, material_id, kind) DO UPDATE SET
            status='open', message=excluded.message, last_checked_at=CURRENT_TIMESTAMP, resolved_at=NULL`,
      },
      {
        sql: `UPDATE cost_alerts SET status='resolved', resolved_at=CURRENT_TIMESTAMP,
                 last_checked_at=CURRENT_TIMESTAMP
          WHERE kind='stale_price' AND status='open' AND material_id IN (
            SELECT m.id FROM materials m
            JOIN material_prices p ON p.material_id=m.id AND p.version=m.version
            WHERE p.effective_date >= date('now', '-30 days')
          )`,
      },
    ]);
    return NextResponse.json({ ok: true, checkedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Cost freshness job failed", error);
    return NextResponse.json({ error: "No se pudo revisar la vigencia" }, { status: 500 });
  }
}
