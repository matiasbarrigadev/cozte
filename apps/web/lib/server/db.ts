import "server-only";
import { createHmac } from "node:crypto";
import { ApiError } from "./auth";
import { assertSqlBindings } from "@/lib/sql-bindings";

export type SqlValue = string | number | null;
export type SqlStatement = { sql: string; params?: SqlValue[] };

function configuration() {
  const url = process.env.DATA_BRIDGE_URL;
  const secret = process.env.DATA_BRIDGE_SECRET;
  if (!url || !secret || secret.length < 32) {
    throw new Error("D1 bridge is not configured");
  }
  return { url: new URL("/internal/d1", url), secret };
}

export async function dbBatch<T extends Record<string, unknown> = Record<string, unknown>>(
  statements: SqlStatement[],
): Promise<T[][]> {
  if (statements.length < 1 || statements.length > 100) throw new Error("Invalid D1 batch size");
  assertSqlBindings(statements);
  const { url, secret } = configuration();
  const body = JSON.stringify({ statements });
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret).update(`${timestamp}\n${body}`).digest("hex");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cozte-time": timestamp,
      "x-cozte-signature": signature,
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 409) throw new ApiError(409, "Los datos cambiaron. Actualiza la página antes de continuar");
  if (!response.ok) {
    let requestId = "";
    let cause = "";
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "requestId" in body && typeof body.requestId === "string") requestId = body.requestId;
      if (body && typeof body === "object" && "cause" in body && typeof body.cause === "string") cause = body.cause;
    } catch { /* Keep the HTTP status when the bridge returns a non-JSON error. */ }
    throw new Error(`D1 bridge failed (${response.status})${requestId ? ` [${requestId}]` : ""}${cause ? `: ${cause}` : ""}`);
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("results" in data) || !Array.isArray(data.results)) {
    throw new Error("Invalid D1 bridge response");
  }
  return data.results as T[][];
}

export async function dbQuery<T extends Record<string, unknown>>(
  sql: string,
  params: SqlValue[] = [],
): Promise<T[]> {
  const [rows] = await dbBatch<T>([{ sql, params }]);
  return rows;
}
