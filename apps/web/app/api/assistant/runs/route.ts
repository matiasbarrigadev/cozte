import { requirePrincipal, apiFailure } from "@/lib/server/auth";
import { getAssistantRun, getAssistantToolExecution, listAssistantRuns } from "@/lib/server/assistant-trace";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal();
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (!id) return Response.json({ runs: await listAssistantRuns(principal) }, { headers: { "cache-control": "no-store" } });
    if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const toolCallId = params.get("toolCallId");
    if (toolCallId !== null) {
      if (!toolCallId || toolCallId.length > 200) return Response.json({ error: "Identificador de herramienta inválido" }, { status: 400 });
      const details = await getAssistantToolExecution(principal, id, toolCallId);
      return details ? Response.json(details, { headers: { "cache-control": "no-store" } }) : Response.json({ error: "Ejecución no encontrada" }, { status: 404 });
    }
    const run = await getAssistantRun(principal, id);
    return run ? Response.json(run, { headers: { "cache-control": "no-store" } }) : Response.json({ error: "No encontrada" }, { status: 404 });
  } catch (error) { return apiFailure(error); }
}
