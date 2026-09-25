import { z } from "zod";
import { ApiError, apiFailure, requirePrincipal } from "@/lib/server/auth";
import { reserveAssistantRequest } from "@/lib/server/assistant-limits";
import { generateCostInsights, listCostInsights, loadCostAnalysis, saveCostInsight } from "@/lib/server/cost-insights";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Conclusions generated before, newest first. */
export async function GET() {
  try {
    const principal = await requirePrincipal();
    return Response.json({ insights: await listCostInsights(principal) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: Request) {
  try {
    const principal = await requirePrincipal(true);
    if (!process.env.AI_GATEWAY_API_KEY) throw new ApiError(503, "Cozte AI aún no tiene configurada su clave de AI Gateway");
    const { granularity } = z.object({ granularity: z.enum(["week", "month"]).default("month") }).parse(await request.json().catch(() => ({})));
    const analysis = await loadCostAnalysis(principal, granularity);
    if (analysis.snapshotCount === 0) throw new ApiError(400, "Todavía no hay historial de costos para analizar.");
    await reserveAssistantRequest(principal);
    const insight = await saveCostInsight(principal, analysis, await generateCostInsights(analysis));
    return Response.json({ insight }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Solicitud inválida" }, { status: 400 });
    return apiFailure(error);
  }
}
