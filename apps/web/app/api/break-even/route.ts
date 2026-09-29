import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadBreakEven } from "@/lib/server/break-even";

export const runtime = "nodejs";

/** The break-even of a normal month: fixed costs, each product's sheet, the sales mix and how many of each to sell. */
export async function GET() {
  try {
    const principal = await requirePrincipal();
    return Response.json(await loadBreakEven(principal), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
