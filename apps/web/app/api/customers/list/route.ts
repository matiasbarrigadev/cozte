import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadCustomers } from "@/lib/server/customers";

export const runtime = "nodejs";

/** Every customer with their addresses and stats, the most recent buyer first. */
export async function GET() {
  try {
    const principal = await requirePrincipal();
    return Response.json(await loadCustomers(principal), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
