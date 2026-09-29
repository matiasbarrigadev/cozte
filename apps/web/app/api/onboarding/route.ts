import { z } from "zod";
import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { completeOnboarding } from "@/lib/server/onboarding";

export const runtime = "nodejs";

/** The first-time answers of a new company: the person's name, the company's name and its country. */
export async function POST(request: Request) {
  try {
    const principal = await requirePrincipal(true);
    return Response.json(await completeOnboarding(principal, await request.json()));
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
    return apiFailure(error);
  }
}
