import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { DomainState } from "@/lib/domain";
import { changesEvaluatedProductCosts, evaluableProfileProducts, productionProfileReviewReason, profileGaps, productionProfileSchema, validateProfileReferences, type ProductionProfile } from "@/lib/production-profile";
import { mutationSchema, previewMutation, commitMutation, type Mutation } from "./mutations";
import { calculateProductionCosts } from "@/lib/production-profile";
import { ApiError, type Principal } from "./auth";
import { dbBatch, dbQuery } from "./db";
import { loadState } from "./state";
import { loadProductionProfile, confirmProductionProfile, saveProductionProfileDirectly, saveProductionProfileDraft } from "./production-profile";
import { mutationProposalPresentation, productionProfilePresentation, type ProposalDetails } from "@/lib/proposal-presentation";
import { getAssistantRunMessageIds, listAssistantDataSources, type AssistantDataSource } from "./assistant-trace";
import { mutationNeedsHumanReview } from "@/lib/cost-approval-policy";

const MAX_PROPOSAL_BYTES = 100_000;
const sourceSchema = z.object({ runId: z.string().min(1).max(100), toolCallId: z.string().min(1).max(200) }).optional();

type ProposalStatus = "pending" | "approved" | "rejected" | "superseded" | "stale";
type ProposalKind = "production-profile" | "cost-mutation";
type ProposalRow = {
  id: string; organization_id: string; created_by: string; source_run_id: string | null; source_tool_call_id: string | null; dedupe_key: string | null;
  kind: ProposalKind; title: string; summary: string; details_json: string; payload_json: string; status: ProposalStatus;
  base_organization_revision: number; base_profile_revision: number | null; applied_profile_revision: number | null;
  decision_by: string | null; decision_note: string | null; result_json: string | null; created_at: string; decided_at: string | null;
};
type ProposalEventRow = { id: string; event_type: string; actor_id: string; payload_json: string; created_at: string };

export type AssistantProposal = {
  id: string; kind: ProposalKind; status: ProposalStatus; title: string; summary: string; details: ProposalDetails;
  baseOrganizationRevision: number; baseProfileRevision: number | null; createdAt: string;
  decidedAt: string | null; decisionNote: string | null; changeRequest: string | null; result: unknown; sourceMessageId: string | null; sources: AssistantDataSource[];
  history: Array<{ id: string; type: string; actor: string; createdAt: string; details: unknown }>;
};

type ProposalSource = { runId: string; toolCallId: string } | undefined;

function assertSize(value: string) {
  if (new TextEncoder().encode(value).byteLength > MAX_PROPOSAL_BYTES) throw new ApiError(400, "La propuesta es demasiado extensa. Divídela en cambios más pequeños.");
}

function eventPayload(value: unknown): string {
  const encoded = JSON.stringify(value ?? {});
  assertSize(encoded);
  return encoded;
}

function baseRows() {
  return "id, organization_id, created_by, source_run_id, source_tool_call_id, dedupe_key, kind, title, summary, details_json, payload_json, status, base_organization_revision, base_profile_revision, applied_profile_revision, decision_by, decision_note, result_json, created_at, decided_at";
}

async function bySource(principal: Principal, source: ProposalSource): Promise<ProposalRow | null> {
  if (!source) return null;
  const rows = await dbQuery<ProposalRow>("SELECT * FROM assistant_proposals WHERE organization_id=? AND source_run_id=? AND source_tool_call_id=? LIMIT 1", [principal.organizationId, source.runId, source.toolCallId]);
  return rows[0] ?? null;
}

async function byPendingDedupeKey(principal: Principal, dedupeKey: string): Promise<ProposalRow | null> {
  const rows = await dbQuery<ProposalRow>(`SELECT ${baseRows()} FROM assistant_proposals WHERE organization_id=? AND kind='cost-mutation' AND status='pending' AND dedupe_key=? LIMIT 1`, [principal.organizationId, dedupeKey]);
  return rows[0] ?? null;
}

function toPublic(row: ProposalRow, details: ProposalDetails, history: ProposalEventRow[] = [], sourceMessageId: string | null = null, sources: AssistantDataSource[] = []): AssistantProposal {
  const changeRequestEvent = [...history].reverse().find((event) => {
    if (event.event_type !== "stale") return false;
    try { return (JSON.parse(event.payload_json) as { origin?: string }).origin === "user-requested-changes"; } catch { return false; }
  });
  let changeRequest: string | null = null;
  if (changeRequestEvent) {
    try {
      const payload = JSON.parse(changeRequestEvent.payload_json) as { note?: unknown };
      if (typeof payload.note === "string") changeRequest = payload.note;
    } catch { /* malformed legacy audit data is omitted */ }
  }
  return {
    id: row.id, kind: row.kind, status: row.status, title: row.title, summary: row.summary, details,
    baseOrganizationRevision: row.base_organization_revision, baseProfileRevision: row.base_profile_revision,
    createdAt: row.created_at, decidedAt: row.decided_at, decisionNote: row.decision_note, changeRequest, result: proposalResult(row), sourceMessageId, sources,
    history: history.map((event) => ({ id: event.id, type: event.event_type, actor: event.actor_id, createdAt: event.created_at, details: JSON.parse(event.payload_json) as unknown })),
  };
}

function proposalDetails(row: ProposalRow): ProposalDetails {
  try {
    const parsed = JSON.parse(row.details_json) as ProposalDetails;
    if (parsed && Array.isArray(parsed.sections)) return parsed;
  } catch { /* legacy draft: rebuild a safe readable brief below */ }
  if (row.kind === "production-profile") {
    try {
      const profile = productionProfileSchema.parse(JSON.parse(row.payload_json));
      return productionProfilePresentation(profile, profileGaps(profile), validateProfileReferences(profile)).details;
    }
    catch { return { sections: [{ title: "Detalles", lines: ["La propuesta antigua se conservó, pero no se puede interpretar. Vuelve a enviarla a Cozte para actualizarla."] }] }; }
  }
  return { sections: [{ title: "Detalles", lines: ["Revisa el cambio en la conversación donde se creó."] }] };
}

function proposalPayload(row: ProposalRow): unknown {
  try { return JSON.parse(row.payload_json) as unknown; } catch { return null; }
}

function proposalResult(row: ProposalRow): unknown {
  try { return row.result_json ? JSON.parse(row.result_json) as unknown : null; } catch { return null; }
}

async function getRow(principal: Principal, proposalId: string): Promise<ProposalRow | null> {
  const rows = await dbQuery<ProposalRow>(`SELECT ${baseRows()} FROM assistant_proposals WHERE organization_id=? AND id=? LIMIT 1`, [principal.organizationId, proposalId]);
  return rows[0] ?? null;
}

export async function getAssistantProposal(principal: Principal, proposalId: string): Promise<AssistantProposal | null> {
  const row = await getRow(principal, proposalId);
  if (!row) return null;
  const [history, messageIds, sources] = await Promise.all([
    dbQuery<ProposalEventRow>("SELECT id, event_type, actor_id, payload_json, created_at FROM assistant_proposal_events WHERE organization_id=? AND proposal_id=? ORDER BY created_at, id LIMIT 100", [principal.organizationId, proposalId]),
    row.source_run_id ? getAssistantRunMessageIds(principal, [row.source_run_id]) : Promise.resolve(new Map<string, string>()),
    row.source_run_id ? listAssistantDataSources(principal, [row.source_run_id]) : Promise.resolve([]),
  ]);
  return toPublic(row, proposalDetails(row), history, row.source_run_id ? messageIds.get(row.source_run_id) ?? null : null, sources);
}

export async function listAssistantProposals(principal: Principal): Promise<AssistantProposal[]> {
  const rows = await dbQuery<ProposalRow>(
    `SELECT ${baseRows()} FROM assistant_proposals WHERE organization_id=? ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'stale' THEN 1 ELSE 2 END, created_at DESC LIMIT 50`,
    [principal.organizationId],
  );
  if (!rows.length) return [];
  const events = await dbQuery<ProposalEventRow & { proposal_id: string }>(
    `SELECT id, proposal_id, event_type, actor_id, payload_json, created_at FROM assistant_proposal_events WHERE organization_id=? AND proposal_id IN (${rows.map(() => "?").join(",")}) ORDER BY created_at, id`,
    [principal.organizationId, ...rows.map((row) => row.id)],
  );
  const sourceRunIds = [...new Set(rows.flatMap((row) => row.source_run_id ? [row.source_run_id] : []))];
  const [messageIds, sources] = await Promise.all([getAssistantRunMessageIds(principal, sourceRunIds), listAssistantDataSources(principal, sourceRunIds)]);
  const byRun = new Map<string, AssistantDataSource[]>();
  for (const source of sources) byRun.set(source.runId, [...byRun.get(source.runId) ?? [], source]);
  const byProposal = new Map<string, ProposalEventRow[]>();
  for (const event of events) byProposal.set(event.proposal_id, [...byProposal.get(event.proposal_id) ?? [], event]);
  return rows.map((row) => toPublic(row, proposalDetails(row), byProposal.get(row.id) ?? [], row.source_run_id ? messageIds.get(row.source_run_id) ?? null : null, row.source_run_id ? byRun.get(row.source_run_id) ?? [] : []));
}

function toolResult(row: ProposalRow): Record<string, unknown> {
  const details = proposalDetails(row);
  return { proposalId: row.id, kind: row.kind, status: row.status, title: row.title, summary: row.summary, details, baseOrganizationRevision: row.base_organization_revision, baseProfileRevision: row.base_profile_revision, appliedProfileRevision: row.applied_profile_revision };
}

export async function createMutationProposal(
  principal: Principal,
  rawMutation: unknown,
  options: { source?: ProposalSource; stateSnapshot?: DomainState; label?: string; brief?: string } = {},
): Promise<Record<string, unknown>> {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para crear propuestas de costos");
  const parsedSource = sourceSchema.parse(options.source);
  const mutation = mutationSchema.parse(rawMutation);
  const dedupeKey = createHash("sha256").update(JSON.stringify({ ...mutation, idempotencyKey: undefined })).digest("hex");
  if (parsedSource) {
    const existing = await bySource(principal, parsedSource);
    if (existing) return toolResult(existing);
  }
  const duplicate = await byPendingDedupeKey(principal, dedupeKey);
  if (duplicate) return toolResult(duplicate);
  const state = options.stateSnapshot ?? await loadState(principal);
  if (state.organization.id !== principal.organizationId) throw new ApiError(403, "La empresa de la propuesta no coincide con tu sesión");
  const preview = previewMutation(state, mutation);
  const presentation = mutationProposalPresentation(state, mutation as Record<string, unknown>, preview.before, preview.after, options);
  const proposalId = crypto.randomUUID();
  const payload = JSON.stringify(mutation);
  const details = JSON.stringify(presentation.details);
  assertSize(payload); assertSize(details);
  const insertedAt = new Date().toISOString();
  const assertionId = crypto.randomUUID();
  const statements = [
    { sql: "INSERT INTO assistant_proposal_assertions (id, valid) VALUES (?, (SELECT CASE WHEN revision=? THEN 1 ELSE 0 END FROM organizations WHERE id=?))", params: [assertionId, mutation.expectedRevision, principal.organizationId] },
    { sql: "INSERT INTO assistant_proposals (id, organization_id, created_by, source_run_id, source_tool_call_id, dedupe_key, kind, title, summary, details_json, payload_json, status, base_organization_revision) VALUES (?, ?, ?, ?, ?, ?, 'cost-mutation', ?, ?, ?, ?, 'pending', ?)", params: [proposalId, principal.organizationId, principal.userId, parsedSource?.runId ?? null, parsedSource?.toolCallId ?? null, dedupeKey, presentation.title, presentation.summary, details, payload, mutation.expectedRevision] },
    { sql: "INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json) VALUES (?, ?, ?, ?, 'created', ?)", params: [crypto.randomUUID(), principal.organizationId, proposalId, principal.userId, eventPayload({ source: parsedSource ? "cozte" : "catalog", title: presentation.title, baseRevision: mutation.expectedRevision, at: insertedAt })] },
    { sql: "DELETE FROM assistant_proposal_assertions WHERE id=?", params: [assertionId] },
  ];
  try { await dbBatch(statements); }
  catch (error) {
    if (error instanceof ApiError && error.status === 409 && parsedSource) {
      const existing = await bySource(principal, parsedSource);
      if (existing) return toolResult(existing);
    }
    if (error instanceof ApiError && error.status === 409) {
      const existing = await byPendingDedupeKey(principal, dedupeKey);
      if (existing) return toolResult(existing);
    }
    throw error;
  }
  const row = await getRow(principal, proposalId);
  if (!row) throw new Error("La propuesta se guardó, pero no se pudo recuperar");
  return toolResult(row);
}

async function rebaseMutationProposal(principal: Principal, row: ProposalRow, mutation: Mutation, state: DomainState) {
  const rebased = mutationSchema.parse({ ...mutation, expectedRevision: state.revision }) as Mutation;
  const preview = previewMutation(state, rebased);
  const presentation = mutationProposalPresentation(state, rebased as Record<string, unknown>, preview.before, preview.after, { label: row.title, brief: row.summary });
  let oldDetails: unknown;
  try { oldDetails = JSON.parse(row.details_json) as unknown; } catch { oldDetails = null; }
  if (JSON.stringify(oldDetails) === JSON.stringify(presentation.details)) return { mutation: rebased, proposal: null as AssistantProposal | null };

  const encodedMutation = JSON.stringify(rebased);
  const encodedDetails = JSON.stringify(presentation.details);
  const dedupeKey = createHash("sha256").update(JSON.stringify({ ...rebased, idempotencyKey: undefined })).digest("hex");
  const assertionId = crypto.randomUUID();
  const refreshed = await dbBatch([
    { sql: "INSERT INTO assistant_proposal_assertions (id, valid) VALUES (?, (SELECT CASE WHEN status='pending' AND organization_id=? AND (SELECT revision FROM organizations WHERE id=?)=? THEN 1 ELSE 0 END FROM assistant_proposals WHERE id=?))", params: [assertionId, principal.organizationId, principal.organizationId, state.revision, row.id] },
    { sql: "UPDATE assistant_proposals SET title=?, summary=?, details_json=?, payload_json=?, dedupe_key=?, base_organization_revision=? WHERE id=? AND organization_id=? AND status='pending' RETURNING id", params: [presentation.title, presentation.summary, encodedDetails, encodedMutation, dedupeKey, state.revision, row.id, principal.organizationId] },
    { sql: "INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json) VALUES (?, ?, ?, ?, 'refreshed', ?)", params: [crypto.randomUUID(), principal.organizationId, row.id, principal.userId, eventPayload({ previousRevision: row.base_organization_revision, currentRevision: state.revision, reason: "Cambió el impacto calculado; hace falta revisar la propuesta actualizada." })] },
    { sql: "DELETE FROM assistant_proposal_assertions WHERE id=?", params: [assertionId] },
  ]);
  if (!refreshed[1]?.length) throw new ApiError(409, "La propuesta se decidió en otra sesión. Actualiza la actividad.");
  const updated = await getAssistantProposal(principal, row.id);
  if (!updated) throw new ApiError(404, "No encontramos la propuesta actualizada");
  return { mutation: rebased, proposal: updated };
}

async function refreshProfileProposal(principal: Principal, row: ProposalRow, state: DomainState) {
  const current = await loadProductionProfile(principal);
  if (!current.draft || current.revision !== row.applied_profile_revision || JSON.stringify(current.draft) !== JSON.stringify(productionProfileSchema.parse(JSON.parse(row.payload_json)))) {
    await markProposalStale(principal, row.id, "El mapa cambió desde que se preparó la revisión. Pídele a Cozte que actualice la propuesta.");
    const latest = await getAssistantProposal(principal, row.id);
    throw new ApiError(409, latest?.decisionNote ?? "El mapa cambió; actualiza la propuesta con Cozte.");
  }
  const profile = productionProfileSchema.parse(JSON.parse(row.payload_json));
  const presentation = profileOptions(profile, state).presentation;
  const assertionId = crypto.randomUUID();
  const statements = await dbBatch([
    { sql: "INSERT INTO assistant_proposal_assertions (id, valid) VALUES (?, (SELECT CASE WHEN status='pending' AND organization_id=? AND (SELECT revision FROM organizations WHERE id=?)=? AND (SELECT revision FROM production_profiles WHERE organization_id=?)=? THEN 1 ELSE 0 END FROM assistant_proposals WHERE id=?))", params: [assertionId, principal.organizationId, principal.organizationId, state.revision, principal.organizationId, current.revision, row.id] },
    { sql: "UPDATE assistant_proposals SET title=?, summary=?, details_json=?, base_organization_revision=? WHERE id=? AND organization_id=? AND status='pending' RETURNING id", params: [presentation.title, presentation.summary, JSON.stringify(presentation.details), state.revision, row.id, principal.organizationId] },
    { sql: "INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json) VALUES (?, ?, ?, ?, 'refreshed', ?)", params: [crypto.randomUUID(), principal.organizationId, row.id, principal.userId, eventPayload({ previousRevision: row.base_organization_revision, currentRevision: state.revision, reason: "La base cambió; revisa otra vez antes de confirmar." })] },
    { sql: "DELETE FROM assistant_proposal_assertions WHERE id=?", params: [assertionId] },
  ]);
  if (!statements[1]?.length) throw new ApiError(409, "La propuesta se actualizó en otra sesión. Vuelve a cargarla.");
  const updated = await getAssistantProposal(principal, row.id);
  if (!updated) throw new ApiError(404, "No encontramos la propuesta actualizada");
  return { proposal: updated };
}

async function refreshPendingProposalBases(principal: Principal, appliedProposalId: string) {
  const state = await loadState(principal);
  const [rows, profileState] = await Promise.all([
    dbQuery<ProposalRow>(`SELECT ${baseRows()} FROM assistant_proposals WHERE organization_id=? AND status='pending' AND id<>? ORDER BY created_at, id LIMIT 50`, [principal.organizationId, appliedProposalId]),
    loadProductionProfile(principal),
  ]);
  for (const row of rows) {
    if (row.base_organization_revision >= state.revision) continue;
    try {
      let patch: { title: string; summary: string; details: string; payload?: string; dedupeKey?: string } | null = null;
      let impactChanged = false;
      if (row.kind === "cost-mutation") {
        const previous = mutationSchema.parse(proposalPayload(row)) as Mutation;
        const expectedFxRates = previous.action === "bulk-prices"
          ? Object.fromEntries([...new Set([...state.materials, ...state.expenses].map((item) => item.currency ?? state.organization.currency))].filter((code) => code !== state.organization.currency).flatMap((code) => state.fxQuotes?.[code] ? [[code, state.fxQuotes[code]!.ratePpm]] : []))
          : undefined;
        const mutation = mutationSchema.parse({ ...previous, expectedRevision: state.revision, ...(expectedFxRates ? { expectedFxRates } : {}) }) as Mutation;
        const dedupeKey = createHash("sha256").update(JSON.stringify({ ...mutation, idempotencyKey: undefined })).digest("hex");
        const duplicate = await byPendingDedupeKey(principal, dedupeKey);
        if (duplicate && duplicate.id !== row.id) {
          const assertionId = crypto.randomUUID();
          await dbBatch([
            { sql: "INSERT INTO assistant_proposal_assertions (id, valid) VALUES (?, (SELECT CASE WHEN status='pending' AND organization_id=? THEN 1 ELSE 0 END FROM assistant_proposals WHERE id=?))", params: [assertionId, principal.organizationId, row.id] },
            { sql: "UPDATE assistant_proposals SET status='superseded', decision_by=?, decision_note=?, decided_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='pending'", params: [principal.userId, `Duplicada por ${duplicate.id}`, row.id, principal.organizationId] },
            { sql: "INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json) VALUES (?, ?, ?, ?, 'superseded', ?)", params: [crypto.randomUUID(), principal.organizationId, row.id, principal.userId, eventPayload({ reason: "Se conservó otra propuesta idéntica", duplicateOf: duplicate.id })] },
            { sql: "DELETE FROM assistant_proposal_assertions WHERE id=?", params: [assertionId] },
          ]);
          continue;
        }
        const preview = previewMutation(state, mutation);
        const presentation = mutationProposalPresentation(state, mutation as Record<string, unknown>, preview.before, preview.after, { label: row.title, brief: row.summary });
        impactChanged = JSON.stringify(proposalDetails(row)) !== JSON.stringify(presentation.details);
        patch = { title: presentation.title, summary: presentation.summary, details: JSON.stringify(presentation.details), payload: JSON.stringify(mutation), dedupeKey };
      } else {
        if (!profileState.draft || profileState.revision !== row.applied_profile_revision || JSON.stringify(profileState.draft) !== JSON.stringify(productionProfileSchema.parse(JSON.parse(row.payload_json)))) continue;
        const profile = productionProfileSchema.parse(JSON.parse(row.payload_json));
        const presentation = profileOptions(profile, state).presentation;
        impactChanged = JSON.stringify(proposalDetails(row)) !== JSON.stringify(presentation.details);
        patch = { title: presentation.title, summary: presentation.summary, details: JSON.stringify(presentation.details) };
      }
      const assertionId = crypto.randomUUID();
      const updated = await dbBatch([
        { sql: "INSERT INTO assistant_proposal_assertions (id, valid) VALUES (?, (SELECT CASE WHEN status='pending' AND organization_id=? AND base_organization_revision=? AND (SELECT revision FROM organizations WHERE id=?)=? THEN 1 ELSE 0 END FROM assistant_proposals WHERE id=?))", params: [assertionId, principal.organizationId, row.base_organization_revision, principal.organizationId, state.revision, row.id] },
        { sql: "UPDATE assistant_proposals SET title=?, summary=?, details_json=?, payload_json=COALESCE(?, payload_json), dedupe_key=COALESCE(?, dedupe_key), base_organization_revision=? WHERE id=? AND organization_id=? AND status='pending' AND base_organization_revision=? RETURNING id", params: [patch.title, patch.summary, patch.details, patch.payload ?? null, patch.dedupeKey ?? null, state.revision, row.id, principal.organizationId, row.base_organization_revision] },
        { sql: "INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json) VALUES (?, ?, ?, ?, 'refreshed', ?)", params: [crypto.randomUUID(), principal.organizationId, row.id, principal.userId, eventPayload({ previousRevision: row.base_organization_revision, currentRevision: state.revision, impactChanged, reason: impactChanged ? "Se actualizó el impacto calculado; sigue pendiente de aprobación." : "Se actualizó la revisión base; el impacto calculado no cambió." })] },
        { sql: "DELETE FROM assistant_proposal_assertions WHERE id=?", params: [assertionId] },
      ]);
      if (!updated[1]?.length) continue;
    } catch (error) {
      console.error("Pending Cozte proposal refresh failed", row.id, error);
    }
  }
}

function profileOptions(profile: ProductionProfile, state?: DomainState) {
  const gaps = profileGaps(profile);
  const referenceErrors = validateProfileReferences(profile);
  const presentation = productionProfilePresentation(profile, gaps, referenceErrors, state ? { currency: state.organization.currency, costs: calculateProductionCosts(profile, state.organization.currency, state.fxQuotes) } : undefined);
  return { gaps, referenceErrors, presentation };
}

export async function createProductionProfileProposal(
  principal: Principal,
  rawProfile: unknown,
  options: { source?: ProposalSource; stateSnapshot?: DomainState; profileRevision?: number } = {},
): Promise<Record<string, unknown>> {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para proponer cambios de producción");
  const parsedSource = sourceSchema.parse(options.source);
  const profile = productionProfileSchema.parse(rawProfile);
  if (parsedSource) {
    const prior = await bySource(principal, parsedSource);
    if (prior) return { ...toolResult(prior), gaps: profileGaps(profile), referenceErrors: validateProfileReferences(profile) };
  }
  const [state, existingProfile] = await Promise.all([
    options.stateSnapshot ? Promise.resolve(options.stateSnapshot) : loadState(principal),
    loadProductionProfile(principal),
  ]);
  if (state.organization.id !== principal.organizationId) throw new ApiError(403, "La empresa de la propuesta no coincide con tu sesión");
  const expectedProfileRevision = options.profileRevision ?? existingProfile.revision;
  const { gaps, referenceErrors, presentation } = profileOptions(profile, state);
  const evaluableProducts = evaluableProfileProducts(profile, state.organization.currency, state.fxQuotes);
  const reviewReason = productionProfileReviewReason(existingProfile.draft ?? existingProfile.confirmed, profile);
  const impactsEvaluatedProduct = changesEvaluatedProductCosts(existingProfile.confirmed, profile, state.organization.currency, state.fxQuotes);
  if (!reviewReason) {
    const currentJson = JSON.stringify(existingProfile.draft ?? existingProfile.confirmed);
    if (currentJson === JSON.stringify(profile)) return { kind: "profile-draft", status: "unchanged", draftRevision: existingProfile.revision, gaps, referenceErrors, evaluableProducts };
    if (existingProfile.confirmed || evaluableProducts.length > 0) {
      const saved = await saveProductionProfileDirectly(principal, profile, expectedProfileRevision, state.revision);
      return { kind: existingProfile.confirmed ? "profile-update" : "profile-evaluated", applied: true, status: "applied", profileRevision: saved.revision, gaps, referenceErrors, evaluableProducts, costUpdated: impactsEvaluatedProduct };
    }
    const saved = await saveProductionProfileDraft(principal, profile, expectedProfileRevision, state.revision);
    return { kind: "profile-draft", status: "building", draftRevision: saved.revision, gaps, referenceErrors, evaluableProducts };
  }
  const proposalId = crypto.randomUUID();
  const payload = JSON.stringify(profile);
  const details = JSON.stringify(presentation.details);
  assertSize(payload); assertSize(details);
  const assertionId = crypto.randomUUID();
  const statements = [
    { sql: "INSERT OR IGNORE INTO production_profiles (organization_id) VALUES (?)", params: [principal.organizationId] },
    { sql: "INSERT INTO assistant_proposal_assertions (id, valid) VALUES (?, (SELECT CASE WHEN (SELECT revision FROM organizations WHERE id=?)=? AND COALESCE((SELECT revision FROM production_profiles WHERE organization_id=?),0)=? THEN 1 ELSE 0 END))", params: [assertionId, principal.organizationId, state.revision, principal.organizationId, expectedProfileRevision] },
    { sql: "INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json) SELECT lower(hex(randomblob(16))), organization_id, id, ?, 'superseded', ? FROM assistant_proposals WHERE organization_id=? AND kind='production-profile' AND status='pending'", params: [principal.userId, eventPayload({ replacedBy: proposalId }), principal.organizationId] },
    { sql: "UPDATE assistant_proposals SET status='superseded', decision_by=?, decision_note=?, decided_at=CURRENT_TIMESTAMP WHERE organization_id=? AND kind='production-profile' AND status='pending'", params: [principal.userId, `Reemplazada por ${proposalId}`, principal.organizationId] },
    { sql: "INSERT INTO assistant_proposals (id, organization_id, created_by, source_run_id, source_tool_call_id, kind, title, summary, details_json, payload_json, status, base_organization_revision, base_profile_revision, applied_profile_revision) VALUES (?, ?, ?, ?, ?, 'production-profile', ?, ?, ?, ?, 'pending', ?, ?, ?)", params: [proposalId, principal.organizationId, principal.userId, parsedSource?.runId ?? null, parsedSource?.toolCallId ?? null, presentation.title, presentation.summary, details, payload, state.revision, expectedProfileRevision, expectedProfileRevision + 1] },
    { sql: "UPDATE production_profiles SET draft_json=?, revision=revision+1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND revision=?", params: [payload, principal.userId, principal.organizationId, expectedProfileRevision] },
    { sql: "INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json) VALUES (?, ?, ?, ?, 'created', ?)", params: [crypto.randomUUID(), principal.organizationId, proposalId, principal.userId, eventPayload({ source: parsedSource ? "cozte" : "manual", title: presentation.title, baseOrganizationRevision: state.revision, baseProfileRevision: expectedProfileRevision, gaps, referenceErrors })] },
    { sql: "DELETE FROM assistant_proposal_assertions WHERE id=?", params: [assertionId] },
  ];
  try { await dbBatch(statements); }
  catch (error) {
    if (error instanceof ApiError && error.status === 409 && parsedSource) {
      const prior = await bySource(principal, parsedSource);
      if (prior) return { ...toolResult(prior), gaps, referenceErrors };
    }
    throw error;
  }
  const row = await getRow(principal, proposalId);
  if (!row) throw new Error("La propuesta de producción se guardó, pero no se pudo recuperar");
  return { ...toolResult(row), gaps, referenceErrors, evaluableProducts, reviewReason: "Eliminar productos, insumos o gastos del mapa de producción" };
}

async function markProposalStale(principal: Principal, proposalId: string, reason: string) {
  const assertionId = crypto.randomUUID();
  try {
    await dbBatch([
      { sql: "INSERT INTO assistant_proposal_assertions (id, valid) VALUES (?, (SELECT CASE WHEN status='pending' AND organization_id=? THEN 1 ELSE 0 END FROM assistant_proposals WHERE id=?))", params: [assertionId, principal.organizationId, proposalId] },
      { sql: "UPDATE assistant_proposals SET status='stale', decision_by=?, decision_note=?, decided_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='pending'", params: [principal.userId, reason, proposalId, principal.organizationId] },
      { sql: "INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json) VALUES (?, ?, ?, ?, 'stale', ?)", params: [crypto.randomUUID(), principal.organizationId, proposalId, principal.userId, eventPayload({ reason })] },
      { sql: "DELETE FROM assistant_proposal_assertions WHERE id=?", params: [assertionId] },
    ]);
  } catch { /* A concurrent approval/rejection owns the final status. */ }
}

async function requestProposalChanges(principal: Principal, row: ProposalRow, note: string): Promise<AssistantProposal> {
  if (row.status !== "pending") throw new ApiError(409, "Esta propuesta ya no está pendiente. Actualiza la lista.");
  const assertionId = crypto.randomUUID();
  await dbBatch([
    { sql: "INSERT INTO assistant_proposal_assertions (id, valid) VALUES (?, (SELECT CASE WHEN status='pending' AND organization_id=? THEN 1 ELSE 0 END FROM assistant_proposals WHERE id=?))", params: [assertionId, principal.organizationId, row.id] },
    ...(row.kind === "production-profile" ? [{ sql: "UPDATE production_profiles SET draft_json=NULL, revision=revision+1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND revision=? AND draft_json=(SELECT payload_json FROM assistant_proposals WHERE id=? AND status='pending' AND applied_profile_revision=?)", params: [principal.userId, principal.organizationId, row.applied_profile_revision ?? -1, row.id, row.applied_profile_revision ?? -1] }] : []),
    { sql: "UPDATE assistant_proposals SET status='stale', decision_by=?, decision_note=?, decided_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='pending'", params: [principal.userId, note, row.id, principal.organizationId] },
    { sql: "INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json) VALUES (?, ?, ?, ?, 'stale', ?)", params: [crypto.randomUUID(), principal.organizationId, row.id, principal.userId, eventPayload({ origin: "user-requested-changes", note })] },
    { sql: "DELETE FROM assistant_proposal_assertions WHERE id=?", params: [assertionId] },
  ]);
  const updated = await getAssistantProposal(principal, row.id);
  if (!updated) throw new ApiError(404, "La propuesta ya no está disponible");
  return updated;
}

async function recordApprovalFailure(principal: Principal, proposalId: string, error: unknown) {
  const reason = error instanceof ApiError ? error.message.slice(0, 500) : "No se pudo aplicar por un error del sistema. La propuesta sigue pendiente.";
  try {
    await dbBatch([{
      sql: "INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json) SELECT ?, organization_id, id, ?, 'approval_failed', ? FROM assistant_proposals WHERE id=? AND organization_id=? AND status='pending'",
      params: [crypto.randomUUID(), principal.userId, eventPayload({ reason }), proposalId, principal.organizationId],
    }]);
  } catch { /* Preserve the original decision error if audit logging is unavailable. */ }
}

async function rejectProposal(principal: Principal, row: ProposalRow, note: string | null): Promise<AssistantProposal> {
  if (row.status === "rejected") return (await getAssistantProposal(principal, row.id))!;
  if (row.status !== "pending") throw new ApiError(409, "La propuesta ya no está pendiente. Actualiza la lista.");
  const assertionId = crypto.randomUUID();
  const statements = [
    { sql: "INSERT INTO assistant_proposal_assertions (id, valid) VALUES (?, (SELECT CASE WHEN status='pending' AND organization_id=? THEN 1 ELSE 0 END FROM assistant_proposals WHERE id=?))", params: [assertionId, principal.organizationId, row.id] },
    ...(row.kind === "production-profile" ? [{ sql: "UPDATE production_profiles SET draft_json=NULL, revision=revision+1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND revision=? AND draft_json=(SELECT payload_json FROM assistant_proposals WHERE id=? AND status='pending' AND applied_profile_revision=?)", params: [principal.userId, principal.organizationId, row.applied_profile_revision ?? -1, row.id, row.applied_profile_revision ?? -1] }] : []),
    { sql: "UPDATE assistant_proposals SET status='rejected', decision_by=?, decision_note=?, decided_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='pending'", params: [principal.userId, note, row.id, principal.organizationId] },
    { sql: "INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json) VALUES (?, ?, ?, ?, 'rejected', ?)", params: [crypto.randomUUID(), principal.organizationId, row.id, principal.userId, eventPayload({ note })] },
    { sql: "DELETE FROM assistant_proposal_assertions WHERE id=?", params: [assertionId] },
  ];
  await dbBatch(statements);
  const updated = await getAssistantProposal(principal, row.id);
  if (!updated) throw new ApiError(404, "La propuesta ya no está disponible");
  return updated;
}

export async function decideAssistantProposal(
  principal: Principal,
  proposalId: string,
  input: { decision: "approve" | "reject" | "request-changes"; note?: string | null },
): Promise<{ proposal: AssistantProposal; result?: unknown; needsReview?: boolean }> {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para decidir propuestas");
  const note = input.note?.trim() || null;
  if (note && note.length > 500) throw new ApiError(400, "La nota es demasiado larga");
  const row = await getRow(principal, proposalId);
  if (!row) throw new ApiError(404, "No encontramos esta propuesta para tu empresa");
  if (input.decision === "request-changes") {
    if (!note || note.length < 3) throw new ApiError(400, "Describe los ajustes que necesitas en al menos 3 caracteres");
    return { proposal: await requestProposalChanges(principal, row, note) };
  }
  if (input.decision === "reject") return { proposal: await rejectProposal(principal, row, note) };
  if (row.status === "approved") return { proposal: (await getAssistantProposal(principal, row.id))!, result: proposalResult(row) };
  if (row.status !== "pending") throw new ApiError(409, "Esta propuesta requiere una revisión nueva antes de aprobarla.");

  try {
    if (row.kind === "production-profile") {
      const state = await loadState(principal);
      if (state.revision !== row.base_organization_revision) return { ...(await refreshProfileProposal(principal, row, state)), needsReview: true };
      const profile = await confirmProductionProfile(principal, row.applied_profile_revision ?? -1, row.id);
      await refreshPendingProposalBases(principal, row.id).catch((error) => console.error("Pending Cozte proposal refresh failed after profile approval", error));
      const proposal = await getAssistantProposal(principal, row.id);
      if (!proposal) throw new Error("El mapa se confirmó, pero no se recuperó su registro de auditoría");
      return { proposal, result: { profileRevision: profile.revision, confirmed: true } };
    }
    let mutation = mutationSchema.parse(proposalPayload(row)) as Mutation;
    const currentState = await loadState(principal);
    if (currentState.revision !== mutation.expectedRevision) {
      const rebased = await rebaseMutationProposal(principal, row, mutation, currentState);
      if (rebased.proposal) return { proposal: rebased.proposal, needsReview: true };
      mutation = rebased.mutation;
    }
    const result = await commitMutation(principal, mutation, { assistantProposalId: row.id });
    await refreshPendingProposalBases(principal, row.id).catch((error) => console.error("Pending Cozte proposal refresh failed after cost approval", error));
    const proposal = await getAssistantProposal(principal, row.id);
    if (!proposal) throw new Error("El cambio se aplicó, pero no se recuperó su registro de auditoría");
    return { proposal, result };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      await markProposalStale(principal, row.id, "La base de costos o la propuesta cambió desde que se preparó. Vuelve a revisarla con Cozte.");
      const latest = await getAssistantProposal(principal, row.id);
      if (latest?.status === "approved") return { proposal: latest, result: proposalResult((await getRow(principal, row.id))!) };
    }
    if (!(error instanceof ApiError && error.status === 409)) await recordApprovalFailure(principal, row.id, error);
    throw error;
  }
}

export async function proposeCatalogMutation(principal: Principal, rawMutation: unknown): Promise<Record<string, unknown>> {
  const parsed = mutationSchema.parse(rawMutation);
  const state = await loadState(principal);
  const mutation = mutationSchema.parse({ ...parsed, expectedRevision: state.revision }) as Mutation;
  if (!mutationNeedsHumanReview(mutation)) return { applied: true, result: await commitMutation(principal, mutation, { source: "user" }) };
  return createMutationProposal(principal, mutation, { stateSnapshot: state });
}
