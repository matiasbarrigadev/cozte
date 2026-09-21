import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadDashboard } from "@/lib/server/state";

export const runtime = "nodejs";

export async function GET() {
  try {
    const principal = await requirePrincipal();
    return Response.json(await loadDashboard(principal), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error);
  }
}
