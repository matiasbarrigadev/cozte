ALTER TABLE cost_snapshots ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE cost_snapshots ADD COLUMN cost_view TEXT NOT NULL DEFAULT 'estimated_current' CHECK (cost_view IN ('target', 'actual', 'scenario', 'estimated_current'));

CREATE TABLE production_profile_snapshots (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  revision INTEGER NOT NULL,
  profile_json TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, revision)
);
CREATE INDEX profile_snapshots_org_date_idx ON production_profile_snapshots(organization_id, created_at DESC);

CREATE TABLE production_profile_commit_assertions (
  id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);
