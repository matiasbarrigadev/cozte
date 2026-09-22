CREATE TABLE assistant_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'aborted')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  error_text TEXT,
  UNIQUE (organization_id, user_id, message_id)
);

CREATE INDEX assistant_runs_recent ON assistant_runs (organization_id, started_at DESC);

CREATE TABLE assistant_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX assistant_run_events_run ON assistant_run_events (run_id, created_at, id);
