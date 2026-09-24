import "server-only";
import type { Principal } from "./auth";
import { ApiError } from "./auth";
import { dbBatch, dbQuery } from "./db";

export type CozteNote = { id: string; text: string; createdAt: string };

const MAX_ACTIVE_NOTES = 40;

/** Facts and decisions the business confirmed, kept across conversations (oldest first). */
export async function loadCozteNotes(principal: Principal): Promise<CozteNote[]> {
  const rows = await dbQuery<{ id: string; text: string; created_at: string }>(
    "SELECT id, text, created_at FROM cozte_notes WHERE organization_id=? AND archived_at IS NULL ORDER BY created_at, id LIMIT ?",
    [principal.organizationId, MAX_ACTIVE_NOTES],
  );
  return rows.map((row) => ({ id: row.id, text: row.text, createdAt: row.created_at }));
}

export async function saveCozteNote(principal: Principal, text: string, replacesId?: string): Promise<{ id: string; replaced: boolean }> {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para guardar notas");
  const id = crypto.randomUUID();
  const results = await dbBatch([
    ...(replacesId ? [{ sql: "UPDATE cozte_notes SET archived_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND archived_at IS NULL RETURNING id", params: [replacesId, principal.organizationId] }] : []),
    { sql: "INSERT INTO cozte_notes (id, organization_id, text, created_by) VALUES (?, ?, ?, ?)", params: [id, principal.organizationId, text, principal.userId] },
    { sql: "UPDATE cozte_notes SET archived_at=CURRENT_TIMESTAMP WHERE organization_id=? AND archived_at IS NULL AND id NOT IN (SELECT id FROM cozte_notes WHERE organization_id=? AND archived_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?)", params: [principal.organizationId, principal.organizationId, MAX_ACTIVE_NOTES] },
  ]);
  return { id, replaced: Boolean(replacesId && results[0]?.length) };
}

export async function archiveCozteNote(principal: Principal, id: string): Promise<boolean> {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para borrar notas");
  const [rows] = await dbBatch([{ sql: "UPDATE cozte_notes SET archived_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND archived_at IS NULL RETURNING id", params: [id, principal.organizationId] }]);
  return rows.length > 0;
}
