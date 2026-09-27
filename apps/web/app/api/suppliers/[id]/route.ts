import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadSupplier } from "@/lib/server/suppliers";

export const runtime = "nodejs";

/** One supplier: data, what it sells with its prices, purchases month by month and the latest ones. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requirePrincipal();
    const { id } = await context.params;
    return Response.json(await loadSupplier(principal, decodeURIComponent(id).slice(0, 120)), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
