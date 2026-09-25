import { z } from "zod";
import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { archiveConversation, loadCozteSettings, saveBoard, saveExplanationLevel } from "@/lib/server/cozte-settings";
import { WIDGET_KINDS } from "@/lib/cozte-widgets";

export const runtime = "nodejs";

/** The person's explanation level and board. */
export async function GET() {
  try {
    const principal = await requirePrincipal();
    return Response.json(await loadCozteSettings(principal), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}

const updateSchema = z.object({
  level: z.enum(["simple", "medium", "advanced"]).optional(),
  board: z.array(z.object({ id: z.string().min(1).max(60), kind: z.enum(WIDGET_KINDS as [string, ...string[]]), productId: z.string().max(120).nullable().optional(), addedBy: z.enum(["user", "cozte"]) })).max(8).optional(),
});

export async function PUT(request: Request) {
  try {
    const principal = await requirePrincipal();
    const input = updateSchema.parse(await request.json());
    if (input.level) await saveExplanationLevel(principal, input.level);
    if (input.board) await saveBoard(principal, input.board as Parameters<typeof saveBoard>[1]);
    return Response.json(await loadCozteSettings(principal));
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Datos inválidos" }, { status: 400 });
    return apiFailure(error);
  }
}

/** Starts a new conversation; the previous one is archived. */
export async function POST() {
  try {
    const principal = await requirePrincipal();
    return Response.json(await archiveConversation(principal));
  } catch (error) { return apiFailure(error); }
}
