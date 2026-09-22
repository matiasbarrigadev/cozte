ALTER TABLE material_prices ADD COLUMN currency TEXT;
ALTER TABLE material_prices ADD COLUMN native_amount_milli INTEGER;
ALTER TABLE material_prices ADD COLUMN fx_rate_ppm INTEGER;
ALTER TABLE material_prices ADD COLUMN fx_as_of TEXT;
ALTER TABLE material_prices ADD COLUMN fx_source TEXT;

ALTER TABLE shared_expenses ADD COLUMN currency TEXT;
ALTER TABLE shared_expenses ADD COLUMN native_amount_milli INTEGER;
ALTER TABLE shared_expenses ADD COLUMN fx_rate_ppm INTEGER;
ALTER TABLE shared_expenses ADD COLUMN fx_as_of TEXT;
ALTER TABLE shared_expenses ADD COLUMN fx_source TEXT;

ALTER TABLE shared_expense_versions ADD COLUMN currency TEXT;
ALTER TABLE shared_expense_versions ADD COLUMN native_amount_milli INTEGER;
ALTER TABLE shared_expense_versions ADD COLUMN fx_rate_ppm INTEGER;
ALTER TABLE shared_expense_versions ADD COLUMN fx_as_of TEXT;
ALTER TABLE shared_expense_versions ADD COLUMN fx_source TEXT;

CREATE TABLE fx_quotes (
  id TEXT PRIMARY KEY,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate_ppm INTEGER NOT NULL CHECK (rate_ppm > 0),
  as_of TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (from_currency, to_currency, as_of, source)
);

CREATE TABLE fx_publications (
  hour_slot TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  rates_json TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fx_refresh_locks (
  hour_slot TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
