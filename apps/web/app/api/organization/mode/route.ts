import { z } from "zod";
import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { saveBusinessMode } from "@/lib/server/journey";

export const runtime = "nodejs";

/** Whether the company already sells: a project being planned or a business in operation. */
export async function PUT(request: Request) {
  try {
    const principal = await requirePrincipal(true);
    const { mode } = z.object({ mode: z.enum(["project", "operating"]) }).parse(await request.json());
    return Response.json(await saveBusinessMode(principal, mode, "user"));
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Modo inválido" }, { status: 400 });
    return apiFailure(error);
  }
}
