import { z } from "zod";
import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { dbBatch, dbQuery } from "@/lib/server/db";
import { loadState } from "@/lib/server/state";
import { supportedCurrencies } from "@/lib/currency";

export const runtime = "nodejs";

const draftSchema = z.object({
  materials: z.record(z.string().min(1).max(120), z.number().min(0).max(1_000_000_000)),
  expenses: z.record(z.string().min(1).max(120), z.number().min(0).max(1_000_000_000)),
  materialCurrencies: z.record(z.string().min(1).max(120), z.enum(supportedCurrencies)).default({}),
  expenseCurrencies: z.record(z.string().min(1).max(120), z.enum(supportedCurrencies)).default({}),
  source: z.string().max(200),
  effectiveDate: z.iso.date(),
});

type DraftRow = { payload_json: string; updated_at: string };

export async function GET() {
  try {
    const principal = await requirePrincipal();
    await loadState(principal);
    const rows = await dbQuery<DraftRow>(
      "SELECT payload_json, updated_at FROM cost_edit_drafts WHERE organization_id=? AND user_id=?",
      [principal.organizationId, principal.userId],
    );
    return Response.json(rows[0] ? { draft: draftSchema.parse(JSON.parse(rows[0].payload_json)), updatedAt: rows[0].updated_at } : { draft: null });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function PUT(request: Request) {
  try {
    const principal = await requirePrincipal(true);
    const draft = draftSchema.parse(await request.json());
    if (Object.keys(draft.materials).length > 100 || Object.keys(draft.expenses).length > 100) {
      return Response.json({ error: "Demasiadas filas en borrador" }, { status: 400 });
    }
    const state = await loadState(principal);
    const materialIds = new Set(state.materials.map((item) => item.id));
    const expenseIds = new Set(state.expenses.filter((item) => item.period === state.activePeriod).map((item) => item.id));
    if (Object.keys(draft.materials).some((id) => !materialIds.has(id)) || Object.keys(draft.expenses).some((id) => !expenseIds.has(id)) || Object.keys(draft.materialCurrencies).some((id) => !materialIds.has(id)) || Object.keys(draft.expenseCurrencies).some((id) => !expenseIds.has(id))) {
      return Response.json({ error: "El borrador contiene filas que ya no existen" }, { status: 400 });
    }
    await dbBatch([{
      sql: "INSERT INTO cost_edit_drafts (organization_id, user_id, payload_json) VALUES (?, ?, ?) ON CONFLICT (organization_id, user_id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=CURRENT_TIMESTAMP",
      params: [principal.organizationId, principal.userId, JSON.stringify(draft)],
    }]);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Revisa el borrador" }, { status: 400 });
    return apiFailure(error);
  }
}
