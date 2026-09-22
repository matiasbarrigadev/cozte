CREATE TABLE production_profiles (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
  confirmed_json TEXT,
  draft_json TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE assistant_conversations (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL,
  messages_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, user_id)
);
