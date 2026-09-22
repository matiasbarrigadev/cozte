import { requirePrincipal, apiFailure } from "@/lib/server/auth";
import { getAssistantRun, listAssistantRuns } from "@/lib/server/assistant-trace";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ runs: await listAssistantRuns(principal) }, { headers: { "cache-control": "no-store" } });
    if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const run = await getAssistantRun(principal, id);
    return run ? Response.json(run, { headers: { "cache-control": "no-store" } }) : Response.json({ error: "No encontrada" }, { status: 404 });
  } catch (error) { return apiFailure(error); }
}
