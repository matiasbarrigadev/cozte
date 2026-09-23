DROP INDEX assistant_proposal_events_proposal_created_idx;

ALTER TABLE assistant_proposal_events RENAME TO assistant_proposal_events_before_refresh;

CREATE TABLE assistant_proposal_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  proposal_id TEXT NOT NULL REFERENCES assistant_proposals(id),
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'approved', 'rejected', 'superseded', 'stale', 'approval_failed', 'refreshed')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO assistant_proposal_events (id, organization_id, proposal_id, actor_id, event_type, payload_json, created_at)
SELECT id, organization_id, proposal_id, actor_id, event_type, payload_json, created_at
FROM assistant_proposal_events_before_refresh;

DROP TABLE assistant_proposal_events_before_refresh;

CREATE INDEX assistant_proposal_events_proposal_created_idx
  ON assistant_proposal_events(proposal_id, created_at, id);
