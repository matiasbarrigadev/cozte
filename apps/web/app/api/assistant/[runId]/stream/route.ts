import { createUIMessageStreamResponse } from "ai";
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { getRun } from "workflow/api";
import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { getAssistantWorkflowRun } from "@/lib/server/assistant-trace";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const principal = await requirePrincipal();
    const { runId } = await params;
    if (!runId || runId.length > 200) return Response.json({ error: "Ejecución no encontrada" }, { status: 404 });
    const ownedRun = await getAssistantWorkflowRun(principal, runId);
    if (!ownedRun) return Response.json({ error: "Ejecución no encontrada" }, { status: 404 });
    const startIndexRaw = new URL(request.url).searchParams.get("startIndex") ?? "0";
    if (!/^\d+$/.test(startIndexRaw)) return Response.json({ error: "Posición de reanudación inválida" }, { status: 400 });
    const startIndex = Number(startIndexRaw);
    if (!Number.isSafeInteger(startIndex)) return Response.json({ error: "Posición de reanudación inválida" }, { status: 400 });
    const run = await getRun(runId);
    const readable = run.getReadable({ startIndex: 0 }).pipeThrough(createModelCallToUIChunkTransform({ uiStartIndex: startIndex }));
    return createUIMessageStreamResponse({ stream: readable, headers: { "x-workflow-run-id": runId } });
  } catch (error) { return apiFailure(error); }
}
