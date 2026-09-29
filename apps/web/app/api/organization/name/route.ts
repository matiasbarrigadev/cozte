import { z } from "zod";
import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { saveCompanyName } from "@/lib/server/onboarding";

export const runtime = "nodejs";

/** The company's name, in the account and in Cozte. */
export async function PUT(request: Request) {
  try {
    const principal = await requirePrincipal(true);
    const { name } = z.object({ name: z.string() }).parse(await request.json());
    return Response.json({ name: await saveCompanyName(principal, name) });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Nombre inválido" }, { status: 400 });
    return apiFailure(error);
  }
}
