import "server-only";
import type { UIMessage } from "ai";
import { calculateProductionCosts, emptyProductionProfile, productionProfileSchema, profileGaps, validateProfileReferences, type ProductionProfile } from "@/lib/production-profile";
import { ApiError, type Principal } from "./auth";
import { dbBatch, dbQuery } from "./db";
import { ensureOrganization, loadState } from "./state";

type ProfileRow = { confirmed_json: string | null; draft_json: string | null; revision: number };
type ConversationRow = { messages_json: string };
type SnapshotRevisionRow = { revision: number };

export async function loadProductionProfile(principal: Principal) {
  const state = await loadState(principal);
  const rows = await dbQuery<ProfileRow>("SELECT confirmed_json, draft_json, revision FROM production_profiles WHERE organization_id=?", [principal.organizationId]);
  const snapshots = await dbQuery<SnapshotRevisionRow>("SELECT revision FROM production_profile_snapshots WHERE organization_id=? ORDER BY revision DESC LIMIT 1", [principal.organizationId]);
  const row = rows[0];
  const confirmed = row?.confirmed_json ? productionProfileSchema.parse(JSON.parse(row.confirmed_json)) : null;
  const draft = row?.draft_json ? productionProfileSchema.parse(JSON.parse(row.draft_json)) : null;
  return { confirmed, draft, revision: row?.revision ?? 0, confirmedRevision: snapshots[0]?.revision ?? null, gaps: profileGaps(draft ?? confirmed ?? emptyProductionProfile), costs: calculateProductionCosts(draft ?? confirmed ?? emptyProductionProfile, state.organization.currency, state.fxQuotes), fxQuotes: state.fxQuotes };
}

export async function proposeProductionProfile(principal: Principal, profile: ProductionProfile) {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para proponer cambios");
  const parsed = productionProfileSchema.parse(profile);
  await ensureOrganization(principal);
  await dbBatch([
    { sql: "INSERT OR IGNORE INTO production_profiles (organization_id) VALUES (?)", params: [principal.organizationId] },
    { sql: "UPDATE production_profiles SET draft_json=?, revision=revision+1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE organization_id=?", params: [JSON.stringify(parsed), principal.userId, principal.organizationId] },
  ]);
  return { gaps: profileGaps(parsed), referenceErrors: validateProfileReferences(parsed) };
}

export async function confirmProductionProfile(principal: Principal, expectedRevision: number) {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para confirmar cambios");
  const current = await loadProductionProfile(principal);
  if (!current.draft) throw new ApiError(400, "No hay propuesta para confirmar");
  const errors = validateProfileReferences(current.draft);
  if (errors.length) throw new ApiError(400, errors[0]);
  const [updated] = await dbBatch<ProfileRow>([
    { sql: "INSERT INTO production_profile_commit_assertions (id, valid) VALUES (?, (SELECT CASE WHEN revision=? AND draft_json IS NOT NULL THEN 1 ELSE 0 END FROM production_profiles WHERE organization_id=?))", params: [crypto.randomUUID(), expectedRevision, principal.organizationId] },
    { sql: "UPDATE production_profiles SET confirmed_json=draft_json, draft_json=NULL, revision=revision+1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND revision=? AND draft_json IS NOT NULL RETURNING confirmed_json, draft_json, revision", params: [principal.userId, principal.organizationId, expectedRevision] },
    { sql: "INSERT INTO production_profile_snapshots (id, organization_id, revision, profile_json, costs_json, fx_context_json, actor_id) SELECT ?, organization_id, revision, confirmed_json, ?, ?, ? FROM production_profiles WHERE organization_id=? AND revision=? AND confirmed_json IS NOT NULL", params: [crypto.randomUUID(), JSON.stringify(current.costs), JSON.stringify(current.fxQuotes ?? {}), principal.userId, principal.organizationId, expectedRevision + 1] },
  ]);
  if (!updated.length) throw new ApiError(409, "La propuesta cambió. Vuelve a revisarla antes de confirmar");
  await dbBatch([{ sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), principal.organizationId, principal.userId, "confirm-production-profile", principal.organizationId, JSON.stringify({ revision: updated[0].revision })] }]);
  return loadProductionProfile(principal);
}

export async function loadConversation(principal: Principal): Promise<UIMessage[]> {
  const rows = await dbQuery<ConversationRow>("SELECT messages_json FROM assistant_conversations WHERE organization_id=? AND user_id=?", [principal.organizationId, principal.userId]);
  if (!rows[0]) return [];
  const data: unknown = JSON.parse(rows[0].messages_json);
  if (!Array.isArray(data)) return [];
  return data.filter((item): item is UIMessage => !!item && typeof item === "object" && typeof item.id === "string" && (item.role === "user" || item.role === "assistant") && Array.isArray(item.parts)).slice(-24);
}

export async function saveConversation(principal: Principal, messages: UIMessage[]): Promise<void> {
  const reduced = messages.slice(-20).map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text").map((part) => ({ type: "text" as const, text: part.text.slice(0, 2000) })),
  })).filter((message) => message.parts.length);
  await dbBatch([{ sql: "INSERT INTO assistant_conversations (organization_id, user_id, messages_json) VALUES (?, ?, ?) ON CONFLICT (organization_id, user_id) DO UPDATE SET messages_json=excluded.messages_json, updated_at=CURRENT_TIMESTAMP", params: [principal.organizationId, principal.userId, JSON.stringify(reduced)] }]);
}
