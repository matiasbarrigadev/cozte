-- Each chat message on its own row, with when it was written: the chat loads in pages, Cozte sees a recent window
-- with dates, and older messages stay searchable instead of being dropped once a single JSON value filled up.
CREATE TABLE assistant_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  parts_json TEXT NOT NULL,
  -- Lowercase text without accents, for searching past conversations.
  search_text TEXT NOT NULL DEFAULT '',
  -- ISO 8601 in UTC; null for messages imported without a known time.
  created_at TEXT,
  -- "New conversation" archives the current messages instead of deleting them.
  archived_at TEXT,
  UNIQUE (organization_id, user_id, message_id)
);

CREATE INDEX assistant_messages_recent ON assistant_messages (organization_id, user_id, seq DESC);
