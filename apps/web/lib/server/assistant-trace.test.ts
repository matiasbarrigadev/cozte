import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { auditJson, errorDetails } from "./assistant-trace";

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
});
