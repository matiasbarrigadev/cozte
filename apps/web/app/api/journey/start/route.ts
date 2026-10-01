import { z } from "zod";
import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { markStageStarted } from "@/lib/server/journey";

export const runtime = "nodejs";

/** The person started a stage of the path with Cozte. */
export async function POST(request: Request) {
  try {
    const principal = await requirePrincipal();
    const { stageId } = z.object({ stageId: z.string().max(40) }).parse(await request.json());
    await markStageStarted(principal, stageId);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Etapa inválida" }, { status: 400 });
    return apiFailure(error);
  }
}
