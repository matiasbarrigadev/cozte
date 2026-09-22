import { describe, expect, it, vi } from "vitest";

const { dbQueryMock } = vi.hoisted(() => ({ dbQueryMock: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ dbBatch: vi.fn(), dbQuery: dbQueryMock }));
import { auditJson, errorDetails, listAssistantDataSources } from "./assistant-trace";
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

  it("normaliza los errores sin persistir un stack", () => {
    expect(errorDetails(new Error("falló"))).toBe("Error: falló");
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
