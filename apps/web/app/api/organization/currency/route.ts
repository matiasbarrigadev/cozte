import { z } from "zod";
import { supportedCurrencies } from "@/lib/currency";
import { apiFailure, requirePrincipal, ApiError } from "@/lib/server/auth";
import { dbBatch } from "@/lib/server/db";
import { loadState } from "@/lib/server/state";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    const principal = await requirePrincipal(true);
    if (principal.role !== "owner") throw new ApiError(403, "Solo el propietario puede elegir la moneda de la empresa");
    const input = z.object({ currency: z.enum(supportedCurrencies), expectedRevision: z.number().int().nonnegative() }).parse(await request.json());
    const state = await loadState(principal);
    if (state.revision !== input.expectedRevision) throw new ApiError(409, "La empresa cambió. Actualiza la página");
    if (state.products.length || state.materials.length || state.expenses.length) throw new ApiError(409, "La moneda base solo puede cambiarse antes de cargar costos o productos");
    await dbBatch([
      { sql: "INSERT INTO production_profile_commit_assertions (id, valid) VALUES (?, (SELECT CASE WHEN revision=? AND NOT EXISTS(SELECT 1 FROM products WHERE organization_id=?) AND NOT EXISTS(SELECT 1 FROM materials WHERE organization_id=?) AND NOT EXISTS(SELECT 1 FROM shared_expenses WHERE organization_id=?) THEN 1 ELSE 0 END FROM organizations WHERE id=?))", params: [crypto.randomUUID(), input.expectedRevision, principal.organizationId, principal.organizationId, principal.organizationId, principal.organizationId] },
      { sql: "UPDATE organizations SET currency=?, revision=revision+1 WHERE id=?", params: [input.currency, principal.organizationId] },
      { sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, 'set-base-currency', ?, ?)", params: [crypto.randomUUID(), principal.organizationId, principal.userId, principal.organizationId, JSON.stringify({ currency: input.currency })] },
    ]);
    return Response.json({ currency: input.currency });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Moneda inválida" }, { status: 400 });
    return apiFailure(error);
  }
}
