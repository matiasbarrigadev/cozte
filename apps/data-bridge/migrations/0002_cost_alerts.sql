CREATE TABLE cost_alerts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  material_id TEXT NOT NULL REFERENCES materials(id),
  kind TEXT NOT NULL CHECK (kind IN ('stale_price')),
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  message TEXT NOT NULL,
  first_detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  UNIQUE (organization_id, material_id, kind)
);
CREATE INDEX cost_alerts_org_status_idx ON cost_alerts(organization_id, status);
