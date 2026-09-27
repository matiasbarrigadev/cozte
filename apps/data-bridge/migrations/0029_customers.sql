-- Customers with their addresses: one record per client instead of a name typed in each sale. Sales point to their
-- customer and deliveries to the address used, while keeping the name and address as they were (a snapshot).
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  -- Lowercase without accents or punctuation: the same customer written differently is one record.
  name_key TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);
CREATE UNIQUE INDEX customers_name ON customers (organization_id, name_key) WHERE archived_at IS NULL;

CREATE TABLE customer_addresses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  label TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  -- Neighborhood, city or area: groups deliveries and, later, decides how each one is delivered.
  zone TEXT NOT NULL DEFAULT '',
  recipient TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);
CREATE INDEX customer_addresses_customer ON customer_addresses (organization_id, customer_id);

ALTER TABLE sales ADD COLUMN customer_id TEXT;
CREATE INDEX sales_customer ON sales (organization_id, customer_id);
ALTER TABLE deliveries ADD COLUMN customer_address_id TEXT;
-- When the customers were built from the names already typed in sales (once per organization).
ALTER TABLE organizations ADD COLUMN customers_imported_at TEXT;
