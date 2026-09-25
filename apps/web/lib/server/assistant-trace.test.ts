import { describe, expect, it, vi } from "vitest";

const { dbQueryMock, dbBatchMock } = vi.hoisted(() => ({ dbQueryMock: vi.fn(), dbBatchMock: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ dbBatch: dbBatchMock, dbQuery: dbQueryMock }));
import { addAssistantToolEvent, addAssistantWorkflowEvent, auditJson, errorDetails, getAssistantToolExecution, getAssistantRun, isAssistantWorkflowLinked, linkAssistantWorkflowRun, listAssistantDataSources, listAssistantRuns, listAssistantToolExecutions } from "./assistant-trace";
import type { Principal } from "./auth";

describe("trazas de Cozte", () => {
  it("oculta secretos y adjuntos sin perder la métrica de tokens", () => {
    const value = JSON.parse(auditJson({ apiKey: "clave", authorization: "Bearer clave", usage: { inputTokens: 25, outputTokens: 12 }, file: { url: "data:image/png;base64,AAAA" } }));
    expect(value.apiKey).toBe("[redacted]");
    expect(value.authorization).toBe("[redacted]");
    expect(value.usage).toEqual({ inputTokens: 25, outputTokens: 12 });
    expect(value.file.url).toMatch(/^\[attachment:/);
  });

  it("limita eventos grandes y conserva una marca explícita", () => {
    const value = JSON.parse(auditJson({ text: "a".repeat(40_000) }));
    expect(value.truncated).toBe(true);
    expect(value.bytes).toBeGreaterThan(30_000);
  });

  it("conserva el identificador de herramienta al acotar un evento grande", () => {
    const value = JSON.parse(auditJson({ toolCallId: "call-123", toolName: "proposeCostAction", input: "a".repeat(40_000) }));
    expect(value.truncated).toBe(true);
    expect(value.toolCallId).toBe("call-123");
    expect(value.toolName).toBe("proposeCostAction");
  });

  it("normaliza los errores sin persistir un stack", () => {
    expect(errorDetails(new Error("falló"))).toBe("Error: falló");
  });

  it("hace idempotentes las trazas de herramientas ante reintentos del workflow", async () => {
    await addAssistantToolEvent("run-1", "call-1", "tool_started", { toolCallId: "call-1", toolName: "inspectCostBase", input: {} });
    await addAssistantToolEvent("run-1", "call-1", "tool_started", { toolCallId: "call-1", toolName: "inspectCostBase", input: {} });
    const firstEvent = dbBatchMock.mock.calls.at(-2)?.[0][0];
    const secondEvent = dbBatchMock.mock.calls.at(-1)?.[0][0];
    expect(firstEvent.params?.[0]).toBe(secondEvent.params?.[0]);
    expect(firstEvent.sql).toContain("ON CONFLICT(id) DO UPDATE");
  });

  it("exige y verifica que el workflow esté vinculado antes de permitir ejecutar herramientas", async () => {
    const principal = { organizationId: "org-1", userId: "user-1" } as Principal;
    dbBatchMock.mockResolvedValueOnce([[{ id: "run-1" }]]);
    await linkAssistantWorkflowRun(principal, "run-1", "workflow-1");
    dbQueryMock.mockResolvedValueOnce([{ id: "run-1" }]);

    const linked = await isAssistantWorkflowLinked(principal, "run-1", "workflow-1");

    expect(linked).toBe(true);
    expect(dbBatchMock.mock.calls.at(-1)?.[0][0].sql).toContain("RETURNING id");
    expect(dbQueryMock.mock.calls.at(-1)?.[1]).toEqual(["run-1", "workflow-1", "org-1", "user-1"]);
  });

  it("asocia los eventos internos del workflow con su conversación", async () => {
    dbQueryMock.mockResolvedValueOnce([{ id: "run-1" }]);
    await addAssistantWorkflowEvent("workflow-1", "tool_input_repaired", { toolName: "proposeCostAction" });

    expect(dbQueryMock.mock.calls.at(-1)?.[1]).toEqual(["workflow-1"]);
    expect(dbBatchMock.mock.calls.at(-1)?.[0][0].params?.[1]).toBe("run-1");
    expect(dbBatchMock.mock.calls.at(-1)?.[0][0].params?.[2]).toBe("tool_input_repaired");
  });

  it("no marca como interrumpidos los workflows durables que llevan más de 90 segundos", async () => {
    const principal = { organizationId: "org-1", userId: "user-1" } as Principal;
    dbQueryMock.mockResolvedValueOnce([]);
    await listAssistantRuns(principal);
    expect(dbQueryMock.mock.calls.at(-1)?.[0]).toContain("workflow_run_id IS NULL");

    dbQueryMock.mockResolvedValueOnce([]);
    await getAssistantRun(principal, "run-1");
    expect(dbQueryMock.mock.calls.at(-1)?.[0]).toContain("workflow_run_id IS NULL");
  });

  it("reconstruye el estado histórico de cada herramienta desde los eventos", async () => {
    dbQueryMock.mockResolvedValueOnce([
      { run_id: "run-1", message_id: "message-1", tool_call_id: "call-1", tool_name: "inspectCostBase", status: "completed" },
      { run_id: "run-1", message_id: "message-1", tool_call_id: "call-2", tool_name: "proposeCostAction", status: "failed" },
    ]);
    const principal = { organizationId: "org-1", userId: "user-1" } as Principal;

    const executions = await listAssistantToolExecutions(principal, ["message-1"]);

    expect(executions).toEqual([
      { messageId: "message-1", runId: "run-1", toolCallId: "call-1", toolName: "inspectCostBase", status: "completed" },
      { messageId: "message-1", runId: "run-1", toolCallId: "call-2", toolName: "proposeCostAction", status: "failed" },
    ]);
    expect(dbQueryMock.mock.calls.at(-1)?.[1]).toEqual(["org-1", "user-1", "message-1"]);
  });

  it("carga los detalles de una ejecución después de comprobar organización y usuario", async () => {
    dbQueryMock.mockResolvedValueOnce([{ id: "run-1" }]);
    dbQueryMock.mockResolvedValueOnce([
      { kind: "tool_started", payload_json: JSON.stringify({ toolCallId: "call-1", input: { label: "Alquiler" } }), created_at: "2026-09-23 12:00:00" },
      { kind: "tool_finished", payload_json: JSON.stringify({ toolCallId: "call-1", durationMs: 125, output: { applied: true } }), created_at: "2026-09-23 12:00:01" },
    ]);
    const principal = { organizationId: "org-1", userId: "user-1" } as Principal;

    const details = await getAssistantToolExecution(principal, "run-1", "call-1");

    expect(details).toEqual({ input: { label: "Alquiler" }, output: { applied: true }, durationMs: 125, startedAt: "2026-09-23 12:00:00", finishedAt: "2026-09-23 12:00:01" });
    expect(dbQueryMock.mock.calls.at(-2)?.[1]).toEqual(["run-1", "org-1", "user-1"]);
  });

  it("expone metadatos de imágenes, PDF y Excel sin duplicar ni devolver el contenido auditado", async () => {
    dbQueryMock.mockResolvedValueOnce([{ id: "run-1", message_id: "message-1", started_at: "2026-09-22 10:00:00" }]);
    dbQueryMock.mockResolvedValueOnce([{ run_id: "run-1", payload_json: JSON.stringify({ parts: [
      { type: "file", filename: "factura.jpg", mediaType: "image/jpeg", bytesApprox: 4096 },
      { type: "file", filename: "report.pdf", mediaType: "application/pdf", bytesApprox: 8192 },
      { type: "file", filename: "costos.septiembre.xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytesApprox: 2048 },
      { type: "text", text: "Planilla adjunta: costos.septiembre.xlsx. Extracto de la primera hoja (2 de 2 filas): datos privados" },
    ] }) }]);
    const principal = { organizationId: "org-1", userId: "user-1" } as Principal;

    const sources = await listAssistantDataSources(principal);

    expect(sources.map(({ kind, label, messageId }) => ({ kind, label, messageId }))).toEqual([
      { kind: "image", label: "factura.jpg", messageId: "message-1" },
      { kind: "pdf", label: "report.pdf", messageId: "message-1" },
      { kind: "spreadsheet", label: "costos.septiembre.xlsx", messageId: "message-1" },
    ]);
    expect(JSON.stringify(sources)).not.toContain("datos privados");
    expect(JSON.stringify(sources)).not.toContain("bytesApprox");
  });
});

describe("turnos trabados", () => {
  const principal: Principal = { userId: "user-1", organizationId: "org-1", role: "owner" };

  it("marca como fallido un turno sin actividad y deja de retomarlo", async () => {
    const { getActiveAssistantWorkflow } = await import("./assistant-trace");
    dbQueryMock.mockReset().mockResolvedValueOnce([{ id: "run-1", workflow_run_id: "wrun-1", message_id: "m-1", stalled: 1 }]);
    dbBatchMock.mockReset().mockResolvedValueOnce([[{ id: "run-1" }]]);
    await expect(getActiveAssistantWorkflow(principal)).resolves.toBeNull();
    expect(dbBatchMock.mock.calls[0][0][0]).toMatchObject({ params: ["failed", "stalled: sin actividad del workflow", "run-1"] });
  });

  it("retoma un turno que sigue trabajando", async () => {
    const { getActiveAssistantWorkflow } = await import("./assistant-trace");
    dbQueryMock.mockReset().mockResolvedValueOnce([{ id: "run-2", workflow_run_id: "wrun-2", message_id: "m-2", stalled: 0 }]);
    dbBatchMock.mockReset();
    await expect(getActiveAssistantWorkflow(principal)).resolves.toEqual({ workflowRunId: "wrun-2", messageId: "m-2" });
    expect(dbBatchMock).not.toHaveBeenCalled();
  });

  it("informa si el cierre llegó tarde a un turno ya cerrado", async () => {
    const { finishAssistantRun } = await import("./assistant-trace");
    dbBatchMock.mockReset().mockResolvedValueOnce([[]]);
    await expect(finishAssistantRun("run-3", "completed")).resolves.toBe(false);
    dbBatchMock.mockResolvedValueOnce([[{ id: "run-4" }]]);
    await expect(finishAssistantRun("run-4", "completed")).resolves.toBe(true);
  });
});
