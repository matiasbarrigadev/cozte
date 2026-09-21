type Statement = {
  sql: string;
  params?: (string | number | null)[];
};

type BridgeEnv = Env & { DATA_BRIDGE_SECRET: string };

const encoder = new TextEncoder();
const MAX_BODY_BYTES = 1024 * 1024;

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function signature(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(input)));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

async function readBody(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

function validStatements(input: unknown): input is { statements: Statement[] } {
  if (!input || typeof input !== "object" || !("statements" in input)) return false;
  const statements = (input as { statements: unknown }).statements;
  if (!Array.isArray(statements) || statements.length < 1 || statements.length > 100) return false;
  return statements.every((statement) => {
    if (!statement || typeof statement !== "object") return false;
    const { sql, params } = statement as Statement;
    if (typeof sql !== "string" || sql.length > 8000 || !/^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql) || sql.includes(";")) return false;
    if (params === undefined) return true;
    return Array.isArray(params) && params.length <= 100 && params.every((param) =>
      param === null ||
      (typeof param === "string" && param.length <= 10000) ||
      (typeof param === "number" && Number.isSafeInteger(param)),
    );
  });
}

export default {
  async fetch(request: Request, env: BridgeEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
    if (request.method !== "POST" || url.pathname !== "/internal/d1") return json({ error: "Not found" }, 404);

    const timestamp = request.headers.get("x-cozte-time") ?? "";
    const supplied = request.headers.get("x-cozte-signature") ?? "";
    const issuedAt = Number(timestamp);
    if (!env.DATA_BRIDGE_SECRET || env.DATA_BRIDGE_SECRET.length < 32 ||
        !Number.isSafeInteger(issuedAt) || Math.abs(Date.now() - issuedAt) > 120_000 ||
        !/^[0-9a-f]{64}$/.test(supplied)) return json({ error: "Unauthorized" }, 401);

    const raw = await readBody(request);
    if (raw === null) return json({ error: "Body too large or empty" }, 413);
    const expected = await signature(env.DATA_BRIDGE_SECRET, `${timestamp}\n${raw}`);
    if (!equalConstantTime(supplied, expected)) return json({ error: "Unauthorized" }, 401);

    let input: unknown;
    try { input = JSON.parse(raw); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!validStatements(input)) return json({ error: "Invalid statements" }, 400);

    try {
      const prepared = input.statements.map(({ sql, params = [] }) => env.DB.prepare(sql).bind(...params));
      const results = await env.DB.batch(prepared);
      return json({ results: results.map((result) => result.results) });
    } catch (error) {
      console.error("D1 bridge query failed", error);
      const conflict = error instanceof Error && /constraint|unique/i.test(error.message);
      return json({ error: conflict ? "Conflict" : "Database operation failed" }, conflict ? 409 : 500);
    }
  },
} satisfies ExportedHandler<BridgeEnv>;
