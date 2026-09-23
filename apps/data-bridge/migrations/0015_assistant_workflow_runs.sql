ALTER TABLE assistant_runs ADD COLUMN workflow_run_id TEXT;

CREATE UNIQUE INDEX assistant_runs_workflow_run
  ON assistant_runs (workflow_run_id)
  WHERE workflow_run_id IS NOT NULL;
