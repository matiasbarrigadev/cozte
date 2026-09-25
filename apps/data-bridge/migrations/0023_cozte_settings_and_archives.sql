-- How each person wants Cozte to explain (per person: an org can mix students and accountants).
CREATE TABLE cozte_user_settings (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL,
  explanation_level TEXT CHECK (explanation_level IN ('simple', 'medium', 'advanced')),
  -- Widgets pinned to the board next to the chat, by the person or by Cozte.
  board_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, user_id)
);

-- "New conversation" keeps the previous one here instead of deleting it.
CREATE TABLE assistant_conversation_archives (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX assistant_conversation_archives_owner ON assistant_conversation_archives (organization_id, user_id, created_at DESC);
