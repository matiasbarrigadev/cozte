ALTER TABLE materials ADD COLUMN category TEXT NOT NULL DEFAULT 'Materia prima';
ALTER TABLE shared_expenses ADD COLUMN category TEXT NOT NULL DEFAULT 'Gastos generales';

CREATE TABLE cost_edit_drafts (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, user_id)
);
