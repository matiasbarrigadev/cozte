import { describe, expect, it } from "vitest";
import { assistantToolExecutions, assistantToolOutcome, type AssistantTraceEvent } from "./assistant-run-activity";

describe("assistant run tool activity", () => {
  it("combines start, repair, and result events into one execution", () => {
    const events: AssistantTraceEvent[] = [
      { id: "1", kind: "tool_started", created_at: "2026-09-22 12:00:00", payload: { toolCallId: "call-1", toolName: "proposeCostAction", input: { change: { action: "create-material" } } } },
      { id: "2", kind: "tool_input_repaired", created_at: "2026-09-22 12:00:00", payload: { toolCallId: "call-1", toolName: "proposeCostAction", reason: "Expected object" } },
      { id: "3", kind: "tool_finished", created_at: "2026-09-22 12:00:01", payload: { toolCallId: "call-1", toolName: "proposeCostAction", durationMs: 540, output: { applied: true } } },
    ];
    expect(assistantToolExecutions(events)).toEqual([{
      toolCallId: "call-1", toolName: "proposeCostAction", input: { change: { action: "create-material" } },
      repairReason: "Expected object", output: { applied: true }, startedAt: "2026-09-22 12:00:00", finishedAt: "2026-09-22 12:00:01", durationMs: 540,
    }]);
    expect(assistantToolOutcome({ applied: true })).toBe("Aplicado y auditado");
  });

  it("describes pending proposals, drafts, and failed tool results", () => {
    expect(assistantToolOutcome({ proposal: { proposalId: "proposal-1" } })).toBe("Propuesta creada para revisión");
    expect(assistantToolOutcome({ kind: "profile-draft", evaluableProducts: [] })).toBe("Avance guardado como borrador");
    expect(assistantToolOutcome({ error: "No se pudo guardar" })).toBe("Error: No se pudo guardar");
    expect(assistantToolExecutions([{ id: "1", kind: "tool_started", created_at: "now", payload: { toolName: "inspectCostBase", input: {} } }])).toEqual([]);
  });
});
