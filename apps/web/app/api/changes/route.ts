import { ZodError } from "zod";
import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { commitMutation, mutationSchema, previewMutation } from "@/lib/server/mutations";
import { loadState } from "@/lib/server/state";

export const runtime = "nodejs";

async function handle(request: Request, save: boolean): Promise<Response> {
  try {
    const principal = await requirePrincipal(save);
    const input = mutationSchema.parse(await request.json());
    if (save) return Response.json(await commitMutation(principal, input));
    const state = await loadState(principal);
    return Response.json(previewMutation(state, input));
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Revisa los datos ingresados", issues: error.issues }, { status: 400 });
    return apiFailure(error);
  }
}

export async function POST(request: Request) { return handle(request, true); }
export async function PUT(request: Request) { return handle(request, false); }
