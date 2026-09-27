import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadSuppliers } from "@/lib/server/suppliers";

export const runtime = "nodejs";

/** Every supplier with what it sells, its prices and stats, the one most spent with first. */
export async function GET() {
  try {
    const principal = await requirePrincipal();
    return Response.json(await loadSuppliers(principal), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
