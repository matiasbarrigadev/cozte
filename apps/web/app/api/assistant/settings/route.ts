import { z } from "zod";
import { apiFailure, forbidAdminView, requirePrincipal } from "@/lib/server/auth";
import { archiveConversation, loadCozteSettings, saveBoard, saveExplanationLevel } from "@/lib/server/cozte-settings";
import { MAX_BOARD_WIDGETS, parseBoard } from "@/lib/cozte-widgets";

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
  // Widgets are normalized by parseBoard: unknown kinds, months or figures are dropped, never stored.
  board: z.array(z.record(z.string(), z.unknown())).max(MAX_BOARD_WIDGETS).optional(),
});

export async function PUT(request: Request) {
  try {
    const principal = await requirePrincipal();
    forbidAdminView(principal);
    const input = updateSchema.parse(await request.json());
    if (input.level) await saveExplanationLevel(principal, input.level);
    if (input.board) await saveBoard(principal, parseBoard(input.board));
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
    forbidAdminView(principal);
    return Response.json(await archiveConversation(principal));
  } catch (error) { return apiFailure(error); }
}
