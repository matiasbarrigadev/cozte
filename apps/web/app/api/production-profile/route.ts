import { z } from "zod";
import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadProductionProfile } from "@/lib/server/production-profile";
import { decideAssistantProposal } from "@/lib/server/assistant-proposals";

export const runtime = "nodejs";

export async function GET() {
  try { return Response.json(await loadProductionProfile(await requirePrincipal()), { headers: { "cache-control": "no-store" } }); }
  catch (error) { return apiFailure(error); }
}

export async function PUT(request: Request) {
  try {
    const principal = await requirePrincipal(true);
    const { proposalId } = z.object({ proposalId: z.uuid() }).parse(await request.json());
    return Response.json(await decideAssistantProposal(principal, proposalId, { decision: "approve" }));
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Solicitud inválida" }, { status: 400 });
    return apiFailure(error);
  }
}
