import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadCostAnalysis } from "@/lib/server/cost-insights";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal();
    const granularity = new URL(request.url).searchParams.get("granularity") === "week" ? "week" : "month";
    return Response.json(await loadCostAnalysis(principal, granularity), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
