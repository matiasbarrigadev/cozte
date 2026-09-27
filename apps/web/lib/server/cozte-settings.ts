import "server-only";
import { archiveMessages } from "./cozte-messages";
import { isExplanationLevel, type ExplanationLevel } from "@/lib/cozte-levels";
import { parseBoard, pinWidget, type BoardWidget, type WidgetSpec } from "@/lib/cozte-widgets";
import type { Principal } from "./auth";
import { ApiError } from "./auth";
import { dbBatch, dbQuery } from "./db";
import { getActiveAssistantWorkflow } from "./assistant-trace";

export type CozteSettings = { level: ExplanationLevel | null; board: BoardWidget[] };

/** The person's level (null while not chosen) and the widgets pinned to their board. */
export async function loadCozteSettings(principal: Principal): Promise<CozteSettings> {
  const rows = await dbQuery<{ explanation_level: string | null; board_json: string }>("SELECT explanation_level, board_json FROM cozte_user_settings WHERE organization_id=? AND user_id=?", [principal.organizationId, principal.userId]);
  const row = rows[0];
  return { level: isExplanationLevel(row?.explanation_level) ? row.explanation_level : null, board: parseBoard(row?.board_json ?? "[]") };
}

export async function saveExplanationLevel(principal: Principal, level: ExplanationLevel): Promise<void> {
  await dbBatch([{ sql: "INSERT INTO cozte_user_settings (organization_id, user_id, explanation_level) VALUES (?, ?, ?) ON CONFLICT (organization_id, user_id) DO UPDATE SET explanation_level=excluded.explanation_level, updated_at=CURRENT_TIMESTAMP", params: [principal.organizationId, principal.userId, level] }], { retrySafe: true });
}

export async function saveBoard(principal: Principal, board: BoardWidget[]): Promise<BoardWidget[]> {
  const clean = parseBoard(board);
  await dbBatch([{ sql: "INSERT INTO cozte_user_settings (organization_id, user_id, board_json) VALUES (?, ?, ?) ON CONFLICT (organization_id, user_id) DO UPDATE SET board_json=excluded.board_json, updated_at=CURRENT_TIMESTAMP", params: [principal.organizationId, principal.userId, JSON.stringify(clean)] }], { retrySafe: true });
  return clean;
}

export async function addToBoard(principal: Principal, widget: WidgetSpec): Promise<BoardWidget[]> {
  const { board } = await loadCozteSettings(principal);
  return saveBoard(principal, pinWidget(board, widget));
}

/**
 * Starts a clean conversation: the current one is archived, not deleted. Saved costs, records and Cozte's notes
 * stay; only the chat history starts over, so old styles and mistakes stop weighing on new answers.
 */
export async function archiveConversation(principal: Principal): Promise<{ archived: boolean }> {
  if (await getActiveAssistantWorkflow(principal)) throw new ApiError(409, "Cozte está respondiendo; espera a que termine para empezar una conversación nueva");
  return { archived: await archiveMessages(principal) };
}
