-- Monthly volume lets a lot carry only its share of the month's shared expenses.
ALTER TABLE products ADD COLUMN batches_per_month_milli INTEGER CHECK (batches_per_month_milli IS NULL OR batches_per_month_milli > 0);

-- Durable facts and decisions Cozte must remember across conversations.
CREATE TABLE cozte_notes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  text TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);

CREATE INDEX cozte_notes_org_active ON cozte_notes (organization_id, archived_at, created_at);
