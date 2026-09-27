import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadCustomer } from "@/lib/server/customers";

export const runtime = "nodejs";

/** One customer: data, addresses, stats, purchases month by month and latest sales. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requirePrincipal();
    const { id } = await context.params;
    return Response.json(await loadCustomer(principal, decodeURIComponent(id).slice(0, 120)), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
