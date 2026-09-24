-- Keep the cost and audit history intact when a user removes an active entity.
ALTER TABLE products ADD COLUMN archived_at TEXT;
ALTER TABLE materials ADD COLUMN archived_at TEXT;
