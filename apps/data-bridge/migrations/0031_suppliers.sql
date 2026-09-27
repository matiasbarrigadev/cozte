-- Suppliers: one record per supplier instead of a name typed in each purchase. Purchases and delivery zones point to
-- their supplier while keeping the name as it was typed (a snapshot).
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  -- Lowercase without accents or punctuation, like customers.name_key.
  name_key TEXT NOT NULL,
  -- materials: sells supplies; logistics: delivers orders; services: bills services or expenses; other.
  kind TEXT NOT NULL DEFAULT 'materials' CHECK (kind IN ('materials', 'logistics', 'services', 'other')),
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);
CREATE UNIQUE INDEX suppliers_name ON suppliers (organization_id, name_key) WHERE archived_at IS NULL;

ALTER TABLE purchases ADD COLUMN supplier_id TEXT;
CREATE INDEX purchases_supplier ON purchases (organization_id, supplier_id);
ALTER TABLE delivery_zones ADD COLUMN supplier_id TEXT;
-- When the suppliers were built from the names already typed (once per organization).
ALTER TABLE organizations ADD COLUMN suppliers_imported_at TEXT;
