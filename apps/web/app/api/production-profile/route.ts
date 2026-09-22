import { z } from "zod";
import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { confirmProductionProfile, loadProductionProfile } from "@/lib/server/production-profile";

export const runtime = "nodejs";

export async function GET() {
  try { return Response.json(await loadProductionProfile(await requirePrincipal()), { headers: { "cache-control": "no-store" } }); }
  catch (error) { return apiFailure(error); }
}

export async function PUT(request: Request) {
  try {
    const principal = await requirePrincipal(true);
    const { expectedRevision } = z.object({ expectedRevision: z.number().int().nonnegative() }).parse(await request.json());
    return Response.json(await confirmProductionProfile(principal, expectedRevision));
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Solicitud inválida" }, { status: 400 });
    return apiFailure(error);
  }
}
