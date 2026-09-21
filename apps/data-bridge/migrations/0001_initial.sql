CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Mi empresa',
  currency TEXT NOT NULL DEFAULT 'CLP',
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE memberships (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE materials (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  supplier TEXT NOT NULL DEFAULT '',
  purchase_unit TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX materials_org_idx ON materials(organization_id, name);

CREATE TABLE material_prices (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  material_id TEXT NOT NULL REFERENCES materials(id),
  version INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  source TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (material_id, version)
);
CREATE INDEX material_prices_latest_idx ON material_prices(material_id, version DESC);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  lot_units INTEGER NOT NULL CHECK (lot_units > 0),
  sale_price_minor INTEGER NOT NULL CHECK (sale_price_minor >= 0),
  sales_variable_minor INTEGER NOT NULL DEFAULT 0 CHECK (sales_variable_minor >= 0),
  labor_lot_minor INTEGER NOT NULL DEFAULT 0 CHECK (labor_lot_minor >= 0),
  production_hours_milli INTEGER NOT NULL DEFAULT 0 CHECK (production_hours_milli >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX products_org_idx ON products(organization_id, name);

CREATE TABLE product_materials (
  product_id TEXT NOT NULL REFERENCES products(id),
  material_id TEXT NOT NULL REFERENCES materials(id),
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  PRIMARY KEY (product_id, material_id)
);

CREATE TABLE shared_expenses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  period TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  allocation_basis TEXT NOT NULL CHECK (allocation_basis IN ('hours', 'units')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX expenses_org_period_idx ON shared_expenses(organization_id, period);

CREATE TABLE shared_expense_versions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  expense_id TEXT NOT NULL REFERENCES shared_expenses(id),
  version INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  source TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (expense_id, version)
);

CREATE TABLE change_sets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  idempotency_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, idempotency_key)
);

-- The CHECK constraint aborts a D1 batch atomically if concurrent state changed.
CREATE TABLE commit_assertions (
  change_set_id TEXT PRIMARY KEY REFERENCES change_sets(id),
  valid INTEGER NOT NULL CHECK (valid = 1)
);

CREATE TABLE cost_snapshots (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  change_set_id TEXT REFERENCES change_sets(id),
  total_lot_minor INTEGER,
  unit_minor INTEGER,
  margin_percent REAL,
  lines_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX snapshots_product_idx ON cost_snapshots(organization_id, product_id, created_at DESC);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL,
  note TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX audit_org_idx ON audit_events(organization_id, created_at DESC);

CREATE TABLE source_documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  object_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
