-- Presentations Cozte builds with the business's own data. Charts and figures are frozen into deck_json when a
-- slide is created or its data refreshed, so a shared link shows exactly what the deck says, nothing more.
CREATE TABLE presentations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'cozte',
  deck_json TEXT NOT NULL,
  -- Public link: null while private; turning sharing off and on again issues a new token.
  share_token TEXT UNIQUE,
  shared_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);
CREATE INDEX presentations_org ON presentations (organization_id, archived_at, updated_at DESC);

-- Previous versions of each deck, so any change (the person's or Cozte's) can be undone.
CREATE TABLE presentation_versions (
  id TEXT PRIMARY KEY,
  presentation_id TEXT NOT NULL REFERENCES presentations(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  theme TEXT NOT NULL,
  deck_json TEXT NOT NULL,
  change_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX presentation_versions_deck ON presentation_versions (presentation_id, revision DESC);
