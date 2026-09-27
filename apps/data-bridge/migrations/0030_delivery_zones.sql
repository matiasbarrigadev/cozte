-- Delivery zones: how each area is delivered (own staff, a carrier or picked up), what one order costs, which days it
-- goes out and how long it takes. Each delivery points to its zone, picked from the customer's address.
CREATE TABLE delivery_zones (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  -- Lowercase without accents or punctuation, like customers.name_key.
  name_key TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'own' CHECK (mode IN ('own', 'carrier', 'pickup')),
  -- Who takes the orders: the driver or the courier company.
  carrier TEXT NOT NULL DEFAULT '',
  -- Neighborhoods, towns or cities the zone covers, comma separated; matched against the customer's address.
  areas TEXT NOT NULL DEFAULT '',
  cost_per_order_minor INTEGER NOT NULL DEFAULT 0,
  -- Weekdays it goes out (1 Monday … 7 Sunday, comma separated); empty means any day.
  weekdays TEXT NOT NULL DEFAULT '',
  -- Days from the sale until it can go out.
  lead_days INTEGER NOT NULL DEFAULT 0,
  -- The zone for every address no other zone covers.
  is_fallback INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);
CREATE UNIQUE INDEX delivery_zones_name ON delivery_zones (organization_id, name_key) WHERE archived_at IS NULL;

ALTER TABLE deliveries ADD COLUMN zone_id TEXT;
CREATE INDEX deliveries_zone ON deliveries (organization_id, zone_id);
