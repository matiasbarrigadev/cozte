CREATE TABLE fx_revaluation_runs (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  fingerprint TEXT NOT NULL,
  source TEXT NOT NULL,
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, source, as_of)
);
