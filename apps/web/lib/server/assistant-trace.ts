import "server-only";
import type { Principal } from "./auth";
import { dbBatch, dbQuery, type SqlValue } from "./db";

const MAX_EVENT_BYTES = 30_000;

export type AssistantDataSource = {
  id: string;
  runId: string;
  messageId: string;
  kind: "image" | "spreadsheet" | "file";
  label: string;
  mediaType: string | null;
  createdAt: string;
};

export function auditJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const json = JSON.stringify(value, (key, item: unknown) => {
    if (/secret|password|authorization|api.?key|cookie|signature|^(?:token|accessToken|refreshToken|idToken|bearerToken)$/i.test(key)) return "[redacted]";
    if (typeof item === "string" && item.startsWith("data:")) return `[attachment:${item.length} chars]`;
    if (item instanceof Error) return { name: item.name, message: item.message };
    if (item && typeof item === "object") {
      if (seen.has(item)) return "[circular]";
      seen.add(item);
    }
    return item;
  }) ?? "null";
  return json.length <= MAX_EVENT_BYTES ? json : JSON.stringify({ truncated: true, bytes: json.length, preview: json.slice(0, MAX_EVENT_BYTES - 100) });
}

export function errorDetails(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 2000) : String(error).slice(0, 2000);
}

export async function startAssistantRun(principal: Principal, runId: string, messageId: string, settings: unknown, incoming: unknown): Promise<void> {
  await dbBatch([
    { sql: "INSERT INTO assistant_runs (id, organization_id, user_id, message_id, model_id, settings_json, status) VALUES (?, ?, ?, ?, ?, ?, 'running')", params: [runId, principal.organizationId, principal.userId, messageId, "minimax/minimax-m3", auditJson(settings)] },
    { sql: "INSERT INTO assistant_run_events (id, run_id, kind, payload_json) VALUES (?, ?, 'user_message', ?)", params: [crypto.randomUUID(), runId, auditJson(incoming)] },
  ]);
}

export async function addAssistantEvent(runId: string, kind: string, payload: unknown): Promise<void> {
  await dbBatch([{ sql: "INSERT INTO assistant_run_events (id, run_id, kind, payload_json) VALUES (?, ?, ?, ?)", params: [crypto.randomUUID(), runId, kind, auditJson(payload)] }]);
}

export async function finishAssistantRun(runId: string, status: "completed" | "failed" | "aborted", error?: unknown): Promise<void> {
  await dbBatch([{ sql: "UPDATE assistant_runs SET status=?, error_text=?, finished_at=CURRENT_TIMESTAMP WHERE id=? AND status='running'", params: [status, error === undefined ? null : errorDetails(error), runId] }]);
}

export async function listAssistantRuns(principal: Principal) {
  return dbQuery<{ id: string; message_id: string; model_id: string; status: string; started_at: string; finished_at: string | null; error_text: string | null }>(
    "SELECT id, message_id, model_id, CASE WHEN status='running' AND started_at < datetime('now','-90 seconds') THEN 'interrupted' ELSE status END AS status, started_at, finished_at, error_text FROM assistant_runs WHERE organization_id=? AND user_id=? ORDER BY started_at DESC LIMIT 30",
    [principal.organizationId, principal.userId],
  );
}

export async function getAssistantRun(principal: Principal, runId: string) {
  const runs = await dbQuery<{ id: string; message_id: string; model_id: string; settings_json: string; status: string; started_at: string; finished_at: string | null; error_text: string | null }>(
    "SELECT id, message_id, model_id, settings_json, CASE WHEN status='running' AND started_at < datetime('now','-90 seconds') THEN 'interrupted' ELSE status END AS status, started_at, finished_at, error_text FROM assistant_runs WHERE id=? AND organization_id=? AND user_id=?",
    [runId, principal.organizationId, principal.userId],
  );
  if (!runs[0]) return null;
  const events = await dbQuery<{ id: string; kind: string; payload_json: string; created_at: string }>("SELECT id, kind, payload_json, created_at FROM assistant_run_events WHERE run_id=? ORDER BY created_at, id LIMIT 100", [runId]);
  return { ...runs[0], settings: JSON.parse(runs[0].settings_json), settings_json: undefined, events: events.map((event) => ({ id: event.id, kind: event.kind, payload: JSON.parse(event.payload_json), created_at: event.created_at })) };
}

export async function listAssistantDataSources(principal: Principal, runIds?: string[]): Promise<AssistantDataSource[]> {
  if (runIds && !runIds.length) return [];
  const params: SqlValue[] = [principal.organizationId, principal.userId];
  const filter = runIds ? ` AND id IN (${runIds.map(() => "?").join(",")})` : "";
  if (runIds) params.push(...runIds);
  const limit = runIds ? "" : " LIMIT 50";
  const runs = await dbQuery<{ id: string; message_id: string; started_at: string }>(
    `SELECT id, message_id, started_at FROM assistant_runs WHERE organization_id=? AND user_id=?${filter} ORDER BY started_at DESC${limit}`,
    params,
  );
  if (!runs.length) return [];
  const runById = new Map(runs.map((run) => [run.id, run]));
  const events = await dbQuery<{ run_id: string; payload_json: string }>(
    `SELECT run_id, payload_json FROM assistant_run_events WHERE kind='user_message' AND run_id IN (${runs.map(() => "?").join(",")}) ORDER BY created_at, id`,
    runs.map((run) => run.id),
  );
  const sources: AssistantDataSource[] = [];
  for (const event of events) {
    const run = runById.get(event.run_id);
    if (!run) continue;
    let incoming: unknown;
    try { incoming = JSON.parse(event.payload_json) as unknown; } catch { continue; }
    if (!incoming || typeof incoming !== "object") continue;
    const parts = (incoming as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    const addSource = (kind: AssistantDataSource["kind"], label: string, mediaType: string | null, index: number) => {
      const safeLabel = label.trim().slice(0, 160);
      if (!safeLabel) return;
      sources.push({ id: `${run.id}:${index}`, runId: run.id, messageId: run.message_id, kind, label: safeLabel, mediaType, createdAt: run.started_at });
    };
    for (const [index, part] of parts.entries()) {
      if (!part || typeof part !== "object") continue;
      const item = part as { type?: unknown; filename?: unknown; mediaType?: unknown; text?: unknown };
      if (item.type === "file" && typeof item.filename === "string") {
        const mediaType = typeof item.mediaType === "string" ? item.mediaType.slice(0, 120) : null;
        const kind = mediaType?.startsWith("image/") ? "image" : /\.xlsx$/i.test(item.filename) ? "spreadsheet" : "file";
        addSource(kind, item.filename, mediaType, index);
      }
      if (item.type === "text" && typeof item.text === "string") {
        const match = item.text.match(/Planilla adjunta:\s*(.+?)\. Extracto de la primera hoja\s*\(/s);
        if (match?.[1]) addSource("spreadsheet", match[1], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", index);
      }
    }
  }
  return sources;
}

export async function getAssistantRunMessageIds(principal: Principal, runIds: string[]): Promise<Map<string, string>> {
  if (!runIds.length) return new Map();
  const runs = await dbQuery<{ id: string; message_id: string }>(
    `SELECT id, message_id FROM assistant_runs WHERE organization_id=? AND user_id=? AND id IN (${runIds.map(() => "?").join(",")})`,
    [principal.organizationId, principal.userId, ...runIds],
  );
  return new Map(runs.map((run) => [run.id, run.message_id]));
}
