CREATE TABLE assistant_proposals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  created_by TEXT NOT NULL,
  source_run_id TEXT,
  source_tool_call_id TEXT,
  dedupe_key TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('production-profile', 'cost-mutation')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'superseded', 'stale')),
  base_organization_revision INTEGER NOT NULL,
  base_profile_revision INTEGER,
  applied_profile_revision INTEGER,
  decision_by TEXT,
  decision_note TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT
);

CREATE UNIQUE INDEX assistant_proposals_tool_call_idx
  ON assistant_proposals(source_run_id, source_tool_call_id)
WHERE source_run_id IS NOT NULL AND source_tool_call_id IS NOT NULL;

CREATE UNIQUE INDEX assistant_proposals_pending_dedupe_idx
  ON assistant_proposals(organization_id, dedupe_key)
  WHERE kind = 'cost-mutation' AND status = 'pending' AND dedupe_key IS NOT NULL;

CREATE UNIQUE INDEX assistant_proposals_single_pending_profile_idx
  ON assistant_proposals(organization_id)
  WHERE kind = 'production-profile' AND status = 'pending';

CREATE INDEX assistant_proposals_org_status_created_idx
  ON assistant_proposals(organization_id, status, created_at DESC);

CREATE TABLE assistant_proposal_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  proposal_id TEXT NOT NULL REFERENCES assistant_proposals(id),
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'approved', 'rejected', 'superseded', 'stale', 'approval_failed')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX assistant_proposal_events_proposal_created_idx
  ON assistant_proposal_events(proposal_id, created_at, id);

CREATE TABLE assistant_proposal_assertions (
  id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);

-- Preserve already-pending production-profile drafts created before the proposal ledger existed.
INSERT INTO assistant_proposals (
  id, organization_id, created_by, kind, title, summary, details_json, payload_json,
  status, base_organization_revision, base_profile_revision, applied_profile_revision
)
SELECT
  lower(hex(randomblob(16))),
  p.organization_id,
  COALESCE(p.updated_by, 'system:migration'),
  'production-profile',
  CASE
    WHEN COALESCE(json_array_length(json_extract(p.draft_json, '$.products')), 0) > 1
      THEN 'Propuesta: Crear estos ' || json_array_length(json_extract(p.draft_json, '$.products')) || ' productos'
    WHEN COALESCE(json_array_length(json_extract(p.draft_json, '$.products')), 0) = 1
      THEN 'Propuesta: Crear producto ' || COALESCE(json_extract(p.draft_json, '$.products[0].name'), '')
    ELSE 'Propuesta: Actualizar el proceso productivo'
  END,
  COALESCE(NULLIF(json_extract(p.draft_json, '$.businessSummary'), ''), 'Revisar y aprobar el mapa de producción antes de llevarlo a los costos vigentes.'),
  '{}',
  p.draft_json,
  'pending',
  COALESCE(o.revision, 0),
  MAX(p.revision - 1, 0),
  p.revision
FROM production_profiles p
LEFT JOIN organizations o ON o.id = p.organization_id
WHERE p.draft_json IS NOT NULL;

INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json)
SELECT lower(hex(randomblob(16))), organization_id, id, created_by, 'created',
  '{"source":"migration","note":"Se preservó una propuesta de producción pendiente anterior."}'
FROM assistant_proposals
WHERE status = 'pending' AND kind = 'production-profile' AND source_run_id IS NULL;
