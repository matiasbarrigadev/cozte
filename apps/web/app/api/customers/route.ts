import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadCustomerDirectory } from "@/lib/server/business";

export const runtime = "nodejs";

/** Customers, recipients, addresses and carriers already used, for the suggestions in forms and tables. */
export async function GET() {
  try {
    const principal = await requirePrincipal();
    return Response.json(await loadCustomerDirectory(principal), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
