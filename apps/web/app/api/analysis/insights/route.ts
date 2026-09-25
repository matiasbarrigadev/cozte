import { z } from "zod";
import { ApiError, apiFailure, requirePrincipal } from "@/lib/server/auth";
import { reserveAssistantRequest } from "@/lib/server/assistant-limits";
import { generateCostInsights, loadCostAnalysis } from "@/lib/server/cost-insights";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const principal = await requirePrincipal();
    if (!process.env.AI_GATEWAY_API_KEY) throw new ApiError(503, "Cozte AI aún no tiene configurada su clave de AI Gateway");
    const { granularity } = z.object({ granularity: z.enum(["week", "month"]).default("month") }).parse(await request.json().catch(() => ({})));
    await reserveAssistantRequest(principal);
    const analysis = await loadCostAnalysis(principal, granularity);
    if (analysis.snapshotCount === 0) return Response.json({ text: "Todavía no hay historial de costos para analizar. Cada cambio confirmado guarda una foto; con algunas semanas de registros aparecerán tendencias y recomendaciones.", verified: true });
    return Response.json(await generateCostInsights(analysis), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Solicitud inválida" }, { status: 400 });
    return apiFailure(error);
  }
}
