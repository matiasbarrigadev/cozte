-- Beyond production: monthly expenses belong to an area, and the business records its sales channels,
-- day-to-day purchases and sales, each one optionally backed by a receipt or delivery note.

ALTER TABLE shared_expenses ADD COLUMN area TEXT NOT NULL DEFAULT 'production' CHECK (area IN ('production', 'delivery', 'sales', 'admin'));

-- Chat attachments are kept as documents so Cozte can attach them to the purchase or sale they back.
ALTER TABLE source_documents ADD COLUMN origin TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE source_documents ADD COLUMN run_id TEXT;
ALTER TABLE source_documents ADD COLUMN ordinal INTEGER;
CREATE INDEX source_documents_org_created ON source_documents (organization_id, created_at DESC);

CREATE TABLE sales_channels (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  delivery_method TEXT NOT NULL DEFAULT '',
  -- Share of the price the channel keeps (commission, card, platform), in hundredths of a percent.
  commission_bps INTEGER NOT NULL DEFAULT 0 CHECK (commission_bps BETWEEN 0 AND 10000),
  fee_per_order_minor INTEGER NOT NULL DEFAULT 0 CHECK (fee_per_order_minor >= 0),
  delivery_cost_per_order_minor INTEGER NOT NULL DEFAULT 0 CHECK (delivery_cost_per_order_minor >= 0),
  units_per_order_milli INTEGER NOT NULL DEFAULT 1000 CHECK (units_per_order_milli > 0),
  -- Channel price relative to the list price (-2500 = 25 % less, for wholesale), in hundredths of a percent.
  price_adjustment_bps INTEGER NOT NULL DEFAULT 0 CHECK (price_adjustment_bps BETWEEN -9000 AND 10000),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sales_channels_org ON sales_channels (organization_id, archived_at);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  purchased_on TEXT NOT NULL,
  description TEXT NOT NULL,
  supplier TEXT NOT NULL DEFAULT '',
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL,
  native_amount_milli INTEGER NOT NULL,
  -- material: stock for the recipes; expense: consumed this month; fixed_payment: pays a monthly expense;
  -- investment: lasts years and is spread over its useful life.
  kind TEXT NOT NULL CHECK (kind IN ('material', 'expense', 'fixed_payment', 'investment')),
  area TEXT NOT NULL CHECK (area IN ('production', 'delivery', 'sales', 'admin')),
  material_id TEXT,
  quantity_milli INTEGER,
  expense_id TEXT,
  useful_life_months INTEGER CHECK (useful_life_months IS NULL OR useful_life_months BETWEEN 1 AND 600),
  document_id TEXT REFERENCES source_documents(id),
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'cozte')),
  actor_id TEXT NOT NULL,
  idempotency_key TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX purchases_org_date ON purchases (organization_id, purchased_on);
CREATE UNIQUE INDEX purchases_org_idempotency ON purchases (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  sold_on TEXT NOT NULL,
  channel_id TEXT REFERENCES sales_channels(id),
  channel_name TEXT NOT NULL DEFAULT '',
  customer TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  -- Amounts are fixed when the sale is recorded, so a month's result does not move when prices change later.
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  selling_cost_minor INTEGER NOT NULL DEFAULT 0,
  delivery_cost_minor INTEGER NOT NULL DEFAULT 0,
  variable_cost_minor INTEGER,
  production_cost_minor INTEGER,
  document_id TEXT REFERENCES source_documents(id),
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'cozte')),
  actor_id TEXT NOT NULL,
  idempotency_key TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sales_org_date ON sales (organization_id, sold_on);
CREATE UNIQUE INDEX sales_org_idempotency ON sales (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE sale_items (
  sale_id TEXT NOT NULL REFERENCES sales(id),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  -- Materials plus direct labor per unit, and the full cost with the workshop's shared expenses.
  unit_variable_cost_minor INTEGER,
  unit_cost_minor INTEGER,
  PRIMARY KEY (sale_id, product_id)
);
