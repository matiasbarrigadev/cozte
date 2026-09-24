-- Close proposals created under the former approval-everything workflow.
-- Keep both proposal rows and an explicit event so the audit trail remains intact.
INSERT INTO assistant_proposal_events (
  id, organization_id, proposal_id, actor_id, event_type, payload_json, created_at
)
SELECT
  lower(hex(randomblob(16))),
  organization_id,
  id,
  'system:workflow-transition',
  'superseded',
  json_object(
    'source', 'workflow-transition',
    'reason', 'Closed when routine changes moved to direct execution; request again only if still needed.'
  ),
  CURRENT_TIMESTAMP
FROM assistant_proposals
WHERE status = 'pending';

UPDATE assistant_proposals
SET status = 'superseded',
    decision_by = 'system:workflow-transition',
    decision_note = 'Closed during the move to direct execution for routine changes.',
    decided_at = CURRENT_TIMESTAMP
WHERE status = 'pending';
