import "server-only";
import { createHash } from "node:crypto";
import type { Principal } from "./auth";
import { dbBatch, dbQuery, type SqlValue } from "./db";

const MAX_EVENT_BYTES = 30_000;

export type AssistantDataSource = {
  id: string;
  runId: string;
  messageId: string;
  kind: "image" | "pdf" | "spreadsheet" | "file";
  label: string;
  mediaType: string | null;
  createdAt: string;
};

export type AssistantToolExecution = {
  messageId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  status: "running" | "completed" | "failed";
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
  if (json.length <= MAX_EVENT_BYTES) return json;
  const metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      for (const key of ["toolCallId", "toolName", "durationMs", "failed"]) {
        if (Object.hasOwn(record, key)) metadata[key] = record[key];
      }
    }
  } catch { /* Keep only the bounded preview when the payload is not an object. */ }
  return JSON.stringify({ ...metadata, truncated: true, bytes: json.length, preview: json.slice(0, MAX_EVENT_BYTES - 400) });
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

export async function addAssistantWorkflowEvent(workflowRunId: string, kind: string, payload: unknown): Promise<void> {
  const rows = await dbQuery<{ id: string }>("SELECT id FROM assistant_runs WHERE workflow_run_id=? LIMIT 1", [workflowRunId]);
  if (!rows[0]) throw new Error("No se encontró la conversación de esta ejecución de Cozte");
  await addAssistantEvent(rows[0].id, kind, payload);
}

function stableToolEventId(runId: string, toolCallId: string, kind: string): string {
  const bytes = createHash("sha256").update(`${runId}:${toolCallId}:${kind}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function addAssistantToolEvent(runId: string, toolCallId: string, kind: "tool_started" | "tool_finished", payload: unknown): Promise<void> {
  await dbBatch([{
    sql: "INSERT INTO assistant_run_events (id, run_id, kind, payload_json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json",
    params: [stableToolEventId(runId, toolCallId, kind), runId, kind, auditJson(payload)],
  }]);
}

export async function linkAssistantWorkflowRun(principal: Principal, runId: string, workflowRunId: string): Promise<void> {
  const rows = await dbBatch<{ id: string }>([{
    sql: "UPDATE assistant_runs SET workflow_run_id=? WHERE id=? AND organization_id=? AND user_id=? AND (workflow_run_id IS NULL OR workflow_run_id=?) RETURNING id",
    params: [workflowRunId, runId, principal.organizationId, principal.userId, workflowRunId],
  }]);
  if (!rows[0]?.length) throw new Error("No se pudo vincular la ejecución durable de Cozte");
}

export async function isAssistantWorkflowLinked(principal: Principal, runId: string, workflowRunId: string): Promise<boolean> {
  const rows = await dbQuery<{ id: string }>(
    "SELECT id FROM assistant_runs WHERE id=? AND workflow_run_id=? AND organization_id=? AND user_id=? AND status='running' LIMIT 1",
    [runId, workflowRunId, principal.organizationId, principal.userId],
  );
  return rows.length > 0;
}

export async function getActiveAssistantWorkflow(principal: Principal): Promise<{ workflowRunId: string; messageId: string } | null> {
  const rows = await dbQuery<{ workflow_run_id: string; message_id: string }>(
    "SELECT workflow_run_id, message_id FROM assistant_runs WHERE organization_id=? AND user_id=? AND status='running' AND workflow_run_id IS NOT NULL ORDER BY started_at DESC LIMIT 1",
    [principal.organizationId, principal.userId],
  );
  return rows[0] ? { workflowRunId: rows[0].workflow_run_id, messageId: rows[0].message_id } : null;
}

export async function getAssistantWorkflowRun(principal: Principal, workflowRunId: string): Promise<{ id: string } | null> {
  const rows = await dbQuery<{ id: string }>(
    "SELECT id FROM assistant_runs WHERE workflow_run_id=? AND organization_id=? AND user_id=?",
    [workflowRunId, principal.organizationId, principal.userId],
  );
  return rows[0] ?? null;
}

export async function listAssistantToolExecutions(principal: Principal, messageIds: string[]): Promise<AssistantToolExecution[]> {
  const ids = [...new Set(messageIds)].filter((id) => id.length > 0 && id.length <= 100).slice(-30);
  if (!ids.length) return [];
  const rows = await dbQuery<{ run_id: string; message_id: string; tool_call_id: string; tool_name: string; status: AssistantToolExecution["status"] }>(
    `SELECT r.id AS run_id, r.message_id, json_extract(e.payload_json, '$.toolCallId') AS tool_call_id, json_extract(e.payload_json, '$.toolName') AS tool_name, CASE WHEN f.id IS NULL THEN 'running' WHEN json_extract(f.payload_json, '$.failed')=1 OR json_type(f.payload_json, '$.output.error')='text' THEN 'failed' ELSE 'completed' END AS status FROM assistant_runs r JOIN assistant_run_events e ON e.run_id=r.id AND e.kind='tool_started' LEFT JOIN assistant_run_events f ON f.id=(SELECT f2.id FROM assistant_run_events f2 WHERE f2.run_id=e.run_id AND f2.kind='tool_finished' AND json_extract(f2.payload_json, '$.toolCallId')=json_extract(e.payload_json, '$.toolCallId') ORDER BY f2.created_at DESC, f2.id DESC LIMIT 1) WHERE r.organization_id=? AND r.user_id=? AND r.message_id IN (${ids.map(() => "?").join(",")}) AND json_extract(e.payload_json, '$.toolCallId') IS NOT NULL AND json_extract(e.payload_json, '$.toolName') IS NOT NULL ORDER BY e.created_at, e.id LIMIT 2000`,
    [principal.organizationId, principal.userId, ...ids],
  );
  return rows.map((row) => ({ messageId: row.message_id, runId: row.run_id, toolCallId: row.tool_call_id, toolName: row.tool_name, status: row.status }));
}

export async function getAssistantToolExecution(principal: Principal, runId: string, toolCallId: string) {
  const owned = await dbQuery<{ id: string }>(
    "SELECT id FROM assistant_runs WHERE id=? AND organization_id=? AND user_id=?",
    [runId, principal.organizationId, principal.userId],
  );
  if (!owned.length) return null;
  const events = await dbQuery<{ kind: string; payload_json: string; created_at: string }>(
    "SELECT kind, payload_json, created_at FROM assistant_run_events WHERE run_id=? AND kind IN ('tool_started','tool_finished') AND json_extract(payload_json, '$.toolCallId')=? ORDER BY created_at, id LIMIT 2",
    [runId, toolCallId],
  );
  if (!events.length) return null;
  const details: { input?: unknown; output?: unknown; durationMs?: number; error?: string; startedAt?: string; finishedAt?: string } = {};
  for (const event of events) {
    let payload: unknown;
    try { payload = JSON.parse(event.payload_json) as unknown; } catch { continue; }
    if (!payload || typeof payload !== "object") continue;
    const record = payload as Record<string, unknown>;
    if (event.kind === "tool_started") {
      details.input = record.input;
      details.startedAt = event.created_at;
    } else {
      details.output = record.output;
      if (typeof record.durationMs === "number") details.durationMs = record.durationMs;
      if (typeof record.error === "string") details.error = record.error;
      details.finishedAt = event.created_at;
    }
  }
  return details;
}

export async function finishAssistantRun(runId: string, status: "completed" | "failed" | "aborted", error?: unknown): Promise<void> {
  await dbBatch([{ sql: "UPDATE assistant_runs SET status=?, error_text=?, finished_at=CURRENT_TIMESTAMP WHERE id=? AND status='running'", params: [status, error === undefined ? null : errorDetails(error), runId] }]);
}

export async function listAssistantRuns(principal: Principal) {
  return dbQuery<{ id: string; message_id: string; model_id: string; status: string; started_at: string; finished_at: string | null; error_text: string | null }>(
    "SELECT id, message_id, model_id, CASE WHEN status='running' AND workflow_run_id IS NULL AND started_at < datetime('now','-90 seconds') THEN 'interrupted' ELSE status END AS status, started_at, finished_at, error_text FROM assistant_runs WHERE organization_id=? AND user_id=? ORDER BY started_at DESC LIMIT 30",
    [principal.organizationId, principal.userId],
  );
}

export async function getAssistantRun(principal: Principal, runId: string) {
  const runs = await dbQuery<{ id: string; message_id: string; model_id: string; settings_json: string; status: string; started_at: string; finished_at: string | null; error_text: string | null }>(
    "SELECT id, message_id, model_id, settings_json, CASE WHEN status='running' AND workflow_run_id IS NULL AND started_at < datetime('now','-90 seconds') THEN 'interrupted' ELSE status END AS status, started_at, finished_at, error_text FROM assistant_runs WHERE id=? AND organization_id=? AND user_id=?",
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
  const sourceKeys = new Set<string>();
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
      const key = `${run.id}:${kind}:${safeLabel.toLocaleLowerCase()}`;
      if (sourceKeys.has(key)) return;
      sourceKeys.add(key);
      sources.push({ id: `${run.id}:${index}`, runId: run.id, messageId: run.message_id, kind, label: safeLabel, mediaType, createdAt: run.started_at });
    };
    for (const [index, part] of parts.entries()) {
      if (!part || typeof part !== "object") continue;
      const item = part as { type?: unknown; filename?: unknown; mediaType?: unknown; text?: unknown };
      if (item.type === "file" && typeof item.filename === "string") {
        const mediaType = typeof item.mediaType === "string" ? item.mediaType.slice(0, 120) : null;
        const kind = mediaType?.startsWith("image/") ? "image" : mediaType === "application/pdf" ? "pdf" : /\.xlsx$/i.test(item.filename) ? "spreadsheet" : "file";
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
