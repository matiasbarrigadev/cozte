-- Conclusions Cozte writes in the cost analysis, kept so they can be reviewed later.
CREATE TABLE cost_insights (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  created_by TEXT NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('week', 'month')),
  text TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 1,
  source_json TEXT NOT NULL,
  first_period TEXT,
  last_period TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX cost_insights_org_created ON cost_insights (organization_id, created_at DESC);
