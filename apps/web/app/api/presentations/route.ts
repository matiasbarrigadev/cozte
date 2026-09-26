import { createDeckSchema } from "@/lib/deck-schemas";
import { requirePrincipal } from "@/lib/server/auth";
import { createPresentation, listPresentations } from "@/lib/server/presentations";
import { presentationFailure } from "./failure";

export const runtime = "nodejs";

/** The organization's presentations, newest first, with their cover for the thumbnail. */
export async function GET() {
  try {
    const principal = await requirePrincipal();
    return Response.json({ presentations: await listPresentations(principal) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return presentationFailure(error); }
}

/** Creates a deck from a template (instant, no AI) or from explicit slides. */
export async function POST(request: Request) {
  try {
    const principal = await requirePrincipal(true);
    const input = createDeckSchema.parse(await request.json());
    return Response.json(await createPresentation(principal, input), { status: 201 });
  } catch (error) { return presentationFailure(error); }
}
