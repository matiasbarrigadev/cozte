import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadBusinessAnalysis } from "@/lib/server/business-analysis";

export const runtime = "nodejs";

/** The business month by month (3, 6 or 12 months ending this month), summarized by the engine. */
export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal();
    const requested = Number(new URL(request.url).searchParams.get("months"));
    const months = [3, 6, 12].includes(requested) ? requested : 6;
    return Response.json(await loadBusinessAnalysis(principal, months), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
