import { z } from "zod";
import { deckOperationSchema } from "@/lib/deck-schemas";
import { requirePrincipal } from "@/lib/server/auth";
import { archivePresentation, getPresentation, setPresentationSharing, undoPresentation, updatePresentation } from "@/lib/server/presentations";
import { presentationFailure } from "../failure";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const principal = await requirePrincipal();
    return Response.json(await getPresentation(principal, (await params).id), { headers: { "cache-control": "no-store" } });
  } catch (error) { return presentationFailure(error); }
}

const patchSchema = z.object({ operations: z.array(deckOperationSchema).min(1).max(30) });

/** Edits from the editor: the same operations Cozte uses, applied against the latest version. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const principal = await requirePrincipal(true);
    const { operations } = patchSchema.parse(await request.json());
    return Response.json(await updatePresentation(principal, (await params).id, operations));
  } catch (error) { return presentationFailure(error); }
}

const actionSchema = z.object({ action: z.enum(["share", "unshare", "undo"]) });

export async function POST(request: Request, { params }: Context) {
  try {
    const principal = await requirePrincipal(true);
    const { action } = actionSchema.parse(await request.json());
    const id = (await params).id;
    if (action === "undo") return Response.json(await undoPresentation(principal, id));
    return Response.json({ presentation: await setPresentationSharing(principal, id, action === "share"), done: [] });
  } catch (error) { return presentationFailure(error); }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const principal = await requirePrincipal(true);
    await archivePresentation(principal, (await params).id);
    return Response.json({ ok: true });
  } catch (error) { return presentationFailure(error); }
}
