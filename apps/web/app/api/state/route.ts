import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadWorkspace } from "@/lib/server/workspace";

export const runtime = "nodejs";

export async function GET() {
  try {
    const principal = await requirePrincipal();
    return Response.json(await loadWorkspace(principal), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error);
  }
}
