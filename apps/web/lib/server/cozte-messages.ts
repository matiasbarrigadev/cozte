import "server-only";
import type { UIMessage } from "ai";
import { COZTE_ASSISTANT_ID_PREFIX, COZTE_FALLBACK_ID_PREFIX, messageCreatedAt, messageSearchText, normalizeSearch, storableMessage, withCreatedAt } from "@/lib/cozte-conversation-memory";
import type { Principal } from "./auth";
import { dbBatch, dbQuery } from "./db";

/**
 * The chat, one row per message with the time it was written. The person's page of the chat, Cozte's recent window
 * and the search of past conversations all read from here; nothing is dropped when a conversation grows.
 */

type MessageRow = { seq: number; message_id: string; role: string; parts_json: string; created_at: string | null; archived_at: string | null };

const COLUMNS = "seq, message_id, role, parts_json, created_at, archived_at";

/** D1 writes CURRENT_TIMESTAMP as "AAAA-MM-DD HH:MM:SS" in UTC; the app uses ISO 8601. */
const toIso = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
};

function fromRow(row: MessageRow): UIMessage | null {
  try {
    const parts: unknown = JSON.parse(row.parts_json);
    if (!Array.isArray(parts) || (row.role !== "user" && row.role !== "assistant")) return null;
    const message: UIMessage = { id: row.message_id, role: row.role, parts: parts as UIMessage["parts"] };
    const createdAt = toIso(row.created_at);
    return createdAt ? withCreatedAt(message, createdAt) : message;
  } catch { return null; }
}

const rowsToMessages = (rows: MessageRow[]) => rows.map(fromRow).filter((message): message is UIMessage => message !== null);

/** Saves messages, or updates them if they were already stored; the time a message was first written never changes. */
export async function saveMessages(principal: Principal, messages: UIMessage[]): Promise<void> {
  const now = new Date().toISOString();
  const statements = messages.flatMap((message) => {
    const stored = storableMessage(message);
    if (!stored || (stored.role !== "user" && stored.role !== "assistant")) return [];
    return [{
      sql: "INSERT INTO assistant_messages (organization_id, user_id, message_id, role, parts_json, search_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (organization_id, user_id, message_id) DO UPDATE SET parts_json=excluded.parts_json, search_text=excluded.search_text, created_at=COALESCE(assistant_messages.created_at, excluded.created_at)",
      params: [principal.organizationId, principal.userId, stored.id, stored.role, JSON.stringify(stored.parts), messageSearchText(stored), messageCreatedAt(message) ?? now],
    }];
  });
  for (let index = 0; index < statements.length; index += 50) await dbBatch(statements.slice(index, index + 50));
}

/**
 * Moves a person's conversation from the single JSON value it used to live in (and its archives) into messages,
 * once. Times come from the assistant's run log: when the person's message arrived and when the answer finished.
 */
async function importLegacyConversation(principal: Principal): Promise<void> {
  const owner = [principal.organizationId, principal.userId];
  const [existing, current, archives, runs] = await dbBatch<Record<string, unknown>>([
    { sql: "SELECT 1 AS found FROM assistant_messages WHERE organization_id=? AND user_id=? LIMIT 1", params: owner },
    { sql: "SELECT messages_json FROM assistant_conversations WHERE organization_id=? AND user_id=?", params: owner },
    { sql: "SELECT messages_json, created_at FROM assistant_conversation_archives WHERE organization_id=? AND user_id=? ORDER BY created_at", params: owner },
    { sql: "SELECT id, message_id, started_at, finished_at FROM assistant_runs WHERE organization_id=? AND user_id=?", params: owner },
  ]);
  if (existing.length) return;
  const parse = (json: unknown): UIMessage[] => {
    try {
      const data: unknown = JSON.parse(String(json ?? "[]"));
      return Array.isArray(data) ? data.filter((item): item is UIMessage => Boolean(item) && typeof item === "object" && typeof item.id === "string" && (item.role === "user" || item.role === "assistant") && Array.isArray(item.parts)) : [];
    } catch { return []; }
  };
  const byUserMessage = new Map(runs.map((run) => [String(run.message_id), toIso(run.started_at as string)]));
  const byRun = new Map(runs.map((run) => [String(run.id), toIso((run.finished_at ?? run.started_at) as string)]));
  const timeOf = (message: UIMessage): string | null => message.role === "user"
    ? byUserMessage.get(message.id) ?? null
    : byRun.get(message.id.replace(COZTE_FALLBACK_ID_PREFIX, "").replace(COZTE_ASSISTANT_ID_PREFIX, "")) ?? null;
  const groups = [...archives.map((archive) => ({ messages: parse(archive.messages_json), archivedAt: toIso(archive.created_at as string) })), { messages: parse(current[0]?.messages_json), archivedAt: null }];
  const statements = groups.flatMap((group) => group.messages.flatMap((message) => {
    const stored = storableMessage(message);
    if (!stored) return [];
    return [{
      sql: "INSERT OR IGNORE INTO assistant_messages (organization_id, user_id, message_id, role, parts_json, search_text, created_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      params: [principal.organizationId, principal.userId, stored.id, stored.role, JSON.stringify(stored.parts), messageSearchText(stored), timeOf(message), group.archivedAt],
    }];
  }));
  for (let index = 0; index < statements.length; index += 50) await dbBatch(statements.slice(index, index + 50));
}

/** The latest messages of the current conversation, oldest first. */
export async function loadRecentMessages(principal: Principal, limit: number): Promise<UIMessage[]> {
  const page = await loadMessagePage(principal, { limit });
  return page.messages;
}

/** A page of the current conversation, oldest first: the latest one, or the one before a given message. */
export async function loadMessagePage(principal: Principal, options: { before?: string; limit: number }): Promise<{ messages: UIMessage[]; hasMore: boolean }> {
  const query = () => dbQuery<MessageRow>(
    `SELECT ${COLUMNS} FROM assistant_messages WHERE organization_id=? AND user_id=? AND archived_at IS NULL${options.before ? " AND seq < (SELECT seq FROM assistant_messages WHERE organization_id=? AND user_id=? AND message_id=?)" : ""} ORDER BY seq DESC LIMIT ?`,
    [principal.organizationId, principal.userId, ...(options.before ? [principal.organizationId, principal.userId, options.before] : []), options.limit + 1],
  );
  let rows = await query();
  if (!rows.length && !options.before) {
    await importLegacyConversation(principal);
    rows = await query();
  }
  return { messages: rowsToMessages(rows.slice(0, options.limit).reverse()), hasMore: rows.length > options.limit };
}

/** Starts a clean conversation: the current messages are archived, not deleted. */
export async function archiveMessages(principal: Principal): Promise<boolean> {
  await importLegacyConversation(principal);
  const current = await dbQuery<{ total: number }>("SELECT COUNT(*) AS total FROM assistant_messages WHERE organization_id=? AND user_id=? AND archived_at IS NULL", [principal.organizationId, principal.userId]);
  if (!current[0]?.total) return false;
  await dbBatch([
    { sql: "UPDATE assistant_messages SET archived_at=? WHERE organization_id=? AND user_id=? AND archived_at IS NULL", params: [new Date().toISOString(), principal.organizationId, principal.userId] },
    { sql: "UPDATE assistant_conversations SET messages_json='[]', updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND user_id=?", params: [principal.organizationId, principal.userId] },
  ]);
  return true;
}

export type ConversationMatch = { messageId: string; role: "user" | "assistant"; createdAt: string | null; archived: boolean; text: string };

/** The plain text of a stored message: what the person wrote, or Cozte's answer. */
function plainText(message: UIMessage): string {
  const texts = message.parts.flatMap((part) => part.type === "text" ? [part.text] : []);
  return (message.role === "assistant" ? texts.at(-1) ?? "" : texts.join(" ")).replace(/\s+/g, " ").trim();
}

/** A window of the text around the first word searched for. */
function snippet(text: string, terms: string[], size = 320): string {
  const normalized = normalizeSearch(text);
  const at = Math.max(0, ...terms.map((term) => normalized.indexOf(term)).filter((index) => index >= 0).slice(0, 1));
  const start = Math.max(0, at - Math.floor(size / 3));
  return `${start > 0 ? "…" : ""}${text.slice(start, start + size).trim()}${start + size < text.length ? "…" : ""}`;
}

/** Searches all of a person's conversations, archived ones included: every word must appear. Most recent first. */
export async function searchMessages(principal: Principal, options: { query: string; from?: string; to?: string; limit?: number }): Promise<ConversationMatch[]> {
  await importLegacyConversation(principal);
  const terms = normalizeSearch(options.query).split(" ").filter((term) => term.length >= 2).slice(0, 6);
  if (!terms.length) return [];
  const like = (term: string) => `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
  const conditions = terms.map(() => "search_text LIKE ? ESCAPE '\\'");
  const params: (string | number)[] = [principal.organizationId, principal.userId, ...terms.map(like)];
  if (options.from) { conditions.push("created_at >= ?"); params.push(`${options.from}T00:00:00.000Z`); }
  if (options.to) { conditions.push("created_at < ?"); params.push(new Date(Date.parse(`${options.to}T00:00:00.000Z`) + 86_400_000).toISOString()); }
  const rows = await dbQuery<MessageRow>(`SELECT ${COLUMNS} FROM assistant_messages WHERE organization_id=? AND user_id=? AND ${conditions.join(" AND ")} ORDER BY seq DESC LIMIT ?`, [...params, Math.min(options.limit ?? 8, 20)]);
  return rows.flatMap((row) => {
    const message = fromRow(row);
    if (!message) return [];
    const text = plainText(message);
    return text ? [{ messageId: row.message_id, role: message.role as "user" | "assistant", createdAt: toIso(row.created_at), archived: row.archived_at !== null, text: snippet(text, terms) }] : [];
  });
}
