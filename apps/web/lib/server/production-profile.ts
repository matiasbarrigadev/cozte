import "server-only";
import type { UIMessage } from "ai";
import { calculateProductionCosts, changesEvaluatedProductCosts, emptyProductionProfile, evaluableProfileProducts, productionProfileReviewReason, productionProfileSchema, profileGaps, validateProfileReferences, type ProductionProfile } from "@/lib/production-profile";
import { ApiError, type Principal } from "./auth";
import { dbBatch, dbQuery } from "./db";
import { loadState } from "./state";
import { profileCatalogSuggestions } from "@/lib/profile-catalog-suggestions";
import { compactCozteConversation, COZTE_MAX_HISTORY_MESSAGES } from "@/lib/cozte-conversation-memory";

type ProfileRow = { confirmed_json: string | null; draft_json: string | null; revision: number };
type ConversationRow = { messages_json: string };
type SnapshotRevisionRow = { revision: number };

export async function loadProductionProfile(principal: Principal) {
  const statePromise = loadState(principal);
  const [state, rows, snapshots] = await Promise.all([
    statePromise,
    dbQuery<ProfileRow>("SELECT confirmed_json, draft_json, revision FROM production_profiles WHERE organization_id=?", [principal.organizationId]),
    dbQuery<SnapshotRevisionRow>("SELECT revision FROM production_profile_snapshots WHERE organization_id=? ORDER BY revision DESC LIMIT 1", [principal.organizationId]),
  ]);
  const row = rows[0];
  const confirmed = row?.confirmed_json ? productionProfileSchema.parse(JSON.parse(row.confirmed_json)) : null;
  const draft = row?.draft_json ? productionProfileSchema.parse(JSON.parse(row.draft_json)) : null;
  const working = draft ?? confirmed ?? emptyProductionProfile;
  return { confirmed, draft, revision: row?.revision ?? 0, organizationRevision: state.revision, currency: state.organization.currency, confirmedRevision: snapshots[0]?.revision ?? null, gaps: profileGaps(working), costs: calculateProductionCosts(working, state.organization.currency, state.fxQuotes), evaluableProducts: evaluableProfileProducts(working, state.organization.currency, state.fxQuotes), catalog: profileCatalogSuggestions(confirmed, state), fxQuotes: state.fxQuotes };
}

export async function saveProductionProfileDraft(principal: Principal, profile: ProductionProfile, expectedProfileRevision: number, expectedOrganizationRevision: number) {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para actualizar el mapa de producción");
  const payload = JSON.stringify(productionProfileSchema.parse(profile));
  const assertionId = crypto.randomUUID();
  const insertedProfileId = crypto.randomUUID();
  const results = await dbBatch([
    { sql: "INSERT OR IGNORE INTO production_profiles (organization_id) VALUES (?)", params: [principal.organizationId] },
    { sql: "INSERT INTO assistant_proposal_assertions (id, valid) VALUES (?, (SELECT CASE WHEN (SELECT revision FROM organizations WHERE id=?)=? AND COALESCE((SELECT revision FROM production_profiles WHERE organization_id=?),0)=? THEN 1 ELSE 0 END))", params: [assertionId, principal.organizationId, expectedOrganizationRevision, principal.organizationId, expectedProfileRevision] },
    { sql: "INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json) SELECT lower(hex(randomblob(16))), organization_id, id, ?, 'superseded', ? FROM assistant_proposals WHERE organization_id=? AND kind='production-profile' AND status='pending'", params: [principal.userId, JSON.stringify({ reason: "El mapa sigue en armado; no requiere aprobación todavía." }), principal.organizationId] },
    { sql: "UPDATE assistant_proposals SET status='superseded', decision_by=?, decision_note=?, decided_at=CURRENT_TIMESTAMP WHERE organization_id=? AND kind='production-profile' AND status='pending'", params: [principal.userId, "Actualizada como borrador de trabajo", principal.organizationId] },
    { sql: "UPDATE production_profiles SET draft_json=?, revision=revision+1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND revision=? RETURNING revision", params: [payload, principal.userId, principal.organizationId, expectedProfileRevision] },
    { sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, 'save-production-profile-draft', ?, ?)", params: [insertedProfileId, principal.organizationId, principal.userId, principal.organizationId, JSON.stringify({ source: "cozte", expectedProfileRevision, reason: "building" })] },
    { sql: "DELETE FROM assistant_proposal_assertions WHERE id=?", params: [assertionId] },
  ]);
  if (!results[4]?.length) throw new ApiError(409, "El mapa cambió mientras Cozte lo actualizaba. Vuelve a consultarlo antes de guardar.");
  return loadProductionProfile(principal);
}

export async function saveProductionProfileDirectly(principal: Principal, profile: ProductionProfile, expectedProfileRevision: number, expectedOrganizationRevision: number) {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para actualizar el mapa de producción");
  const state = await loadState(principal);
  const current = await loadProductionProfile(principal);
  if (current.revision !== expectedProfileRevision || state.revision !== expectedOrganizationRevision) throw new ApiError(409, "El mapa o la base cambió; actualiza antes de guardar las clasificaciones");
  const payload = JSON.stringify(productionProfileSchema.parse(profile));
  if (productionProfileReviewReason(current.draft ?? current.confirmed, profile)) throw new ApiError(400, "Quitar productos, insumos o gastos del mapa requiere confirmación humana");
  const costs = calculateProductionCosts(profile, state.organization.currency, state.fxQuotes);
  const categoryStatements = [
    { sql: "INSERT OR IGNORE INTO cost_categories (id, organization_id, name) SELECT lower(hex(randomblob(16))), ?, json_extract(value, '$.name') FROM json_each(?)", params: [principal.organizationId, JSON.stringify(profile.categories)] },
    { sql: "UPDATE materials SET category=(SELECT json_extract(value, '$.category') FROM json_each(?) WHERE lower(json_extract(value, '$.name'))=lower(materials.name) LIMIT 1) WHERE organization_id=? AND archived_at IS NULL AND EXISTS (SELECT 1 FROM json_each(?) WHERE lower(json_extract(value, '$.name'))=lower(materials.name))", params: [JSON.stringify(profile.inputs), principal.organizationId, JSON.stringify(profile.inputs)] },
    { sql: "UPDATE shared_expenses SET category=(SELECT json_extract(value, '$.category') FROM json_each(?) WHERE lower(json_extract(value, '$.name'))=lower(shared_expenses.name) LIMIT 1) WHERE organization_id=? AND EXISTS (SELECT 1 FROM json_each(?) WHERE lower(json_extract(value, '$.name'))=lower(shared_expenses.name))", params: [JSON.stringify(profile.recurringCosts), principal.organizationId, JSON.stringify(profile.recurringCosts)] },
  ];
  const assertionId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const results = await dbBatch([
    { sql: "INSERT OR IGNORE INTO production_profiles (organization_id) VALUES (?)", params: [principal.organizationId] },
    { sql: "INSERT INTO assistant_proposal_assertions (id, valid) VALUES (?, (SELECT CASE WHEN (SELECT revision FROM organizations WHERE id=?)=? AND COALESCE((SELECT revision FROM production_profiles WHERE organization_id=?),0)=? THEN 1 ELSE 0 END))", params: [assertionId, principal.organizationId, expectedOrganizationRevision, principal.organizationId, expectedProfileRevision] },
    { sql: "INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json) SELECT lower(hex(randomblob(16))), organization_id, id, ?, 'superseded', ? FROM assistant_proposals WHERE organization_id=? AND kind='production-profile' AND status='pending'", params: [principal.userId, JSON.stringify({ reason: "Actualización de categorías o evidencia sin impacto en costos evaluados." }), principal.organizationId] },
    { sql: "UPDATE assistant_proposals SET status='superseded', decision_by=?, decision_note=?, decided_at=CURRENT_TIMESTAMP WHERE organization_id=? AND kind='production-profile' AND status='pending'", params: [principal.userId, "Actualizada sin cambiar costos evaluados", principal.organizationId] },
    { sql: "UPDATE production_profiles SET confirmed_json=?, draft_json=NULL, revision=revision+1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND revision=? RETURNING revision", params: [payload, principal.userId, principal.organizationId, expectedProfileRevision] },
    { sql: "INSERT INTO production_profile_snapshots (id, organization_id, revision, profile_json, costs_json, fx_context_json, actor_id) SELECT ?, organization_id, revision, confirmed_json, ?, ?, ? FROM production_profiles WHERE organization_id=? AND revision=? AND confirmed_json IS NOT NULL", params: [snapshotId, JSON.stringify(costs), JSON.stringify(state.fxQuotes ?? {}), principal.userId, principal.organizationId, expectedProfileRevision + 1] },
    ...categoryStatements,
    { sql: "UPDATE organizations SET revision=revision+1 WHERE id=?", params: [principal.organizationId] },
    { sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, 'update-production-profile', ?, ?)", params: [crypto.randomUUID(), principal.organizationId, principal.userId, principal.organizationId, JSON.stringify({ source: "cozte", reason: changesEvaluatedProductCosts(current.confirmed, profile, state.organization.currency, state.fxQuotes) ? "cost-update" : "map-update", revision: expectedProfileRevision + 1 })] },
    { sql: "DELETE FROM assistant_proposal_assertions WHERE id=?", params: [assertionId] },
  ]);
  if (!results[4]?.length) throw new ApiError(409, "El mapa cambió mientras se actualizaban las clasificaciones");
  return loadProductionProfile(principal);
}

export async function confirmProductionProfile(principal: Principal, expectedRevision: number, proposalId: string) {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para confirmar cambios");
  const current = await loadProductionProfile(principal);
  if (!current.draft || current.revision !== expectedRevision) throw new ApiError(409, "La propuesta ya no está pendiente o cambió. Actualiza la conversación.");
  const errors = validateProfileReferences(current.draft);
  if (errors.length) throw new ApiError(400, errors[0]);
  const categoryStatements = [
    { sql: "INSERT OR IGNORE INTO cost_categories (id, organization_id, name) SELECT lower(hex(randomblob(16))), ?, json_extract(value, '$.name') FROM json_each(?)", params: [principal.organizationId, JSON.stringify(current.draft.categories)] },
    { sql: "UPDATE materials SET category=(SELECT json_extract(value, '$.category') FROM json_each(?) WHERE lower(json_extract(value, '$.name'))=lower(materials.name) LIMIT 1) WHERE organization_id=? AND archived_at IS NULL AND EXISTS (SELECT 1 FROM json_each(?) WHERE lower(json_extract(value, '$.name'))=lower(materials.name))", params: [JSON.stringify(current.draft.inputs), principal.organizationId, JSON.stringify(current.draft.inputs)] },
    { sql: "UPDATE shared_expenses SET category=(SELECT json_extract(value, '$.category') FROM json_each(?) WHERE lower(json_extract(value, '$.name'))=lower(shared_expenses.name) LIMIT 1) WHERE organization_id=? AND EXISTS (SELECT 1 FROM json_each(?) WHERE lower(json_extract(value, '$.name'))=lower(shared_expenses.name))", params: [JSON.stringify(current.draft.recurringCosts), principal.organizationId, JSON.stringify(current.draft.recurringCosts)] },
  ];
  const proposalAssertionId = crypto.randomUUID();
  const profileAssertionId = crypto.randomUUID();
  const results = await dbBatch<ProfileRow>([
    { sql: "INSERT INTO assistant_proposal_assertions (id, valid) VALUES (?, (SELECT CASE WHEN status='pending' AND kind='production-profile' AND organization_id=? AND applied_profile_revision=? THEN 1 ELSE 0 END FROM assistant_proposals WHERE id=?))", params: [proposalAssertionId, principal.organizationId, expectedRevision, proposalId] },
    { sql: "INSERT INTO production_profile_commit_assertions (id, valid) VALUES (?, (SELECT CASE WHEN revision=? AND draft_json IS NOT NULL AND EXISTS (SELECT 1 FROM organizations WHERE id=? AND revision=?) AND EXISTS (SELECT 1 FROM assistant_proposals WHERE id=? AND organization_id=? AND kind='production-profile' AND status='pending' AND applied_profile_revision=? AND payload_json=production_profiles.draft_json) THEN 1 ELSE 0 END FROM production_profiles WHERE organization_id=?))", params: [profileAssertionId, expectedRevision, principal.organizationId, current.organizationRevision, proposalId, principal.organizationId, expectedRevision, principal.organizationId] },
    { sql: "UPDATE production_profiles SET confirmed_json=draft_json, draft_json=NULL, revision=revision+1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND revision=? AND draft_json IS NOT NULL AND EXISTS (SELECT 1 FROM assistant_proposals WHERE id=? AND organization_id=? AND status='pending' AND applied_profile_revision=? AND payload_json=production_profiles.draft_json) RETURNING confirmed_json, draft_json, revision", params: [principal.userId, principal.organizationId, expectedRevision, proposalId, principal.organizationId, expectedRevision] },
    { sql: "INSERT INTO production_profile_snapshots (id, organization_id, revision, profile_json, costs_json, fx_context_json, actor_id) SELECT ?, organization_id, revision, confirmed_json, ?, ?, ? FROM production_profiles WHERE organization_id=? AND revision=? AND confirmed_json IS NOT NULL", params: [crypto.randomUUID(), JSON.stringify(current.costs), JSON.stringify(current.fxQuotes ?? {}), principal.userId, principal.organizationId, expectedRevision + 1] },
    { sql: "UPDATE assistant_proposals SET status='approved', decision_by=?, decision_note=NULL, decided_at=CURRENT_TIMESTAMP, result_json=? WHERE id=? AND organization_id=? AND kind='production-profile' AND status='pending' AND applied_profile_revision=?", params: [principal.userId, JSON.stringify({ confirmedProfileRevision: expectedRevision + 1, snapshotSaved: true }), proposalId, principal.organizationId, expectedRevision] },
    { sql: "INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json) VALUES (?, ?, ?, ?, 'approved', ?)", params: [crypto.randomUUID(), principal.organizationId, proposalId, principal.userId, JSON.stringify({ confirmedProfileRevision: expectedRevision + 1, snapshotSaved: true })] },
    ...categoryStatements,
    { sql: "UPDATE organizations SET revision=revision+1 WHERE id=?", params: [principal.organizationId] },
    { sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), principal.organizationId, principal.userId, "confirm-production-profile", principal.organizationId, JSON.stringify({ revision: expectedRevision + 1 })] },
    { sql: "DELETE FROM assistant_proposal_assertions WHERE id=?", params: [proposalAssertionId] },
    { sql: "DELETE FROM production_profile_commit_assertions WHERE id=?", params: [profileAssertionId] },
  ]);
  if (!results[2]?.length) throw new ApiError(409, "La propuesta cambió. Vuelve a revisarla antes de confirmar");
  return loadProductionProfile(principal);
}

export async function loadConversation(principal: Principal): Promise<UIMessage[]> {
  const rows = await dbQuery<ConversationRow>("SELECT messages_json FROM assistant_conversations WHERE organization_id=? AND user_id=?", [principal.organizationId, principal.userId]);
  if (!rows[0]) return [];
  const data: unknown = JSON.parse(rows[0].messages_json);
  if (!Array.isArray(data)) return [];
  return data.filter((item): item is UIMessage => !!item && typeof item === "object" && typeof item.id === "string" && (item.role === "user" || item.role === "assistant") && Array.isArray(item.parts)).slice(-COZTE_MAX_HISTORY_MESSAGES);
}

export async function saveConversation(principal: Principal, messages: UIMessage[]): Promise<void> {
  const reduced = compactCozteConversation(messages);
  await dbBatch([{ sql: "INSERT INTO assistant_conversations (organization_id, user_id, messages_json) VALUES (?, ?, ?) ON CONFLICT (organization_id, user_id) DO UPDATE SET messages_json=excluded.messages_json, updated_at=CURRENT_TIMESTAMP", params: [principal.organizationId, principal.userId, JSON.stringify(reduced)] }]);
}
