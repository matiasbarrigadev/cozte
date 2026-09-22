import { z, ZodError } from "zod";
import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { createMutationProposal, decideAssistantProposal, listAssistantProposals } from "@/lib/server/assistant-proposals";
import { mutationSchema } from "@/lib/server/mutations";

export const runtime = "nodejs";

const decisionSchema = z.object({
  proposalId: z.uuid(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

const createSchema = z.object({ mutation: mutationSchema });

export async function GET() {
  try {
    const principal = await requirePrincipal();
    return Response.json({ proposals: await listAssistantProposals(principal) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: Request) {
  try {
    const principal = await requirePrincipal(true);
    const body: unknown = await request.json();
    const decision = decisionSchema.safeParse(body);
    if (decision.success) {
      return Response.json(await decideAssistantProposal(principal, decision.data.proposalId, decision.data));
    }
    const create = createSchema.safeParse(body);
    if (create.success) {
      return Response.json({ proposal: await createMutationProposal(principal, create.data.mutation) }, { status: 201, headers: { "cache-control": "no-store" } });
    }
    return Response.json({ error: "Solicitud de propuesta inválida" }, { status: 400 });
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Solicitud inválida" }, { status: 400 });
    return apiFailure(error);
  }
}
