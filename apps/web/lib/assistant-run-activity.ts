export type AssistantTraceEvent = { id: string; kind: string; payload: unknown; created_at: string };

export type AssistantToolExecution = {
  toolCallId: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  repairReason?: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function assistantToolExecutions(events: AssistantTraceEvent[]): AssistantToolExecution[] {
  const executions = new Map<string, AssistantToolExecution>();
  for (const event of events) {
    const payload = record(event.payload);
    if (!payload) continue;
    const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : null;
    if (!toolCallId) continue;
    const current = executions.get(toolCallId) ?? {
      toolCallId,
      toolName: typeof payload.toolName === "string" ? payload.toolName : "unknown",
    };
    if (typeof payload.toolName === "string") current.toolName = payload.toolName;
    if (event.kind === "tool_started") {
      current.input = payload.input;
      current.startedAt = event.created_at;
    } else if (event.kind === "tool_finished") {
      current.output = payload.output;
      current.finishedAt = event.created_at;
      if (typeof payload.durationMs === "number") current.durationMs = payload.durationMs;
    } else if (event.kind === "tool_input_repaired" && typeof payload.reason === "string") {
      current.repairReason = payload.reason;
    } else {
      continue;
    }
    executions.set(toolCallId, current);
  }
  return [...executions.values()];
}

export function assistantToolOutcome(output: unknown): string {
  if (output === undefined) return "Sin resultado registrado";
  const result = record(output);
  if (!result) return "Completada";
  if (typeof result.error === "string") return `Error: ${result.error}`;
  if (result.kind === "profile-draft") {
    return Array.isArray(result.evaluableProducts) && result.evaluableProducts.length
      ? "Producto listo para evaluación; requiere revisión"
      : "Avance guardado como borrador";
  }
  if (result.applied === true) return "Aplicado y auditado";
  if (record(result.proposal)?.proposalId || typeof result.proposalId === "string") return "Propuesta creada para revisión";
  if (result.material || result.organization) return "Datos consultados";
  return "Completada";
}
