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

class TransientBridgeError extends Error {}

async function postBatch(statements: SqlStatement[]): Promise<Response> {
  const { url, secret } = configuration();
  const body = JSON.stringify({ statements });
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret).update(`${timestamp}\n${body}`).digest("hex");
  try {
    return await fetch(url, {
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
  } catch (error) {
    throw new TransientBridgeError(`D1 bridge unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Runs statements as one D1 transaction. `retrySafe` batches (reads, or idempotent upserts) are retried once
 * when the network drops or the bridge fails before reaching D1; other writes are never replayed blindly.
 */
export async function dbBatch<T extends Record<string, unknown> = Record<string, unknown>>(
  statements: SqlStatement[],
  options: { retrySafe?: boolean } = {},
): Promise<T[][]> {
  if (statements.length < 1 || statements.length > 100) throw new Error("Invalid D1 batch size");
  assertSqlBindings(statements);
  const retrySafe = options.retrySafe ?? statements.every(({ sql }) => /^\s*SELECT\b/i.test(sql));
  for (let attempt = 0; ; attempt++) {
    try {
      return await runBatch<T>(statements);
    } catch (error) {
      if (!(error instanceof TransientBridgeError) || !retrySafe || attempt >= 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

async function runBatch<T extends Record<string, unknown>>(statements: SqlStatement[]): Promise<T[][]> {
  const response = await postBatch(statements);
  if (response.status === 409) throw new ApiError(409, "Los datos cambiaron. Actualiza la página antes de continuar");
  if (!response.ok) {
    let requestId = "";
    let cause = "";
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "requestId" in body && typeof body.requestId === "string") requestId = body.requestId;
      if (body && typeof body === "object" && "cause" in body && typeof body.cause === "string") cause = body.cause;
    } catch { /* Keep the HTTP status when the bridge returns a non-JSON error. */ }
    const message = `D1 bridge failed (${response.status})${requestId ? ` [${requestId}]` : ""}${cause ? `: ${cause}` : ""}`;
    // No request id means the failure happened in front of the bridge handler (proxy or network); only retry-safe batches replay it.
    throw requestId || response.status < 500 ? new Error(message) : new TransientBridgeError(message);
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

