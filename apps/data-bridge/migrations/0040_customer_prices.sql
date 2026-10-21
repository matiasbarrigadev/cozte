-- What a customer usually buys through (their channel: retail, wholesale, with delivery) and their price agreement:
-- a share above or below the channel's price, in hundredths of a percent, and fixed prices for some products.
ALTER TABLE customers ADD COLUMN default_channel_id TEXT;
ALTER TABLE customers ADD COLUMN price_adjustment_bps INTEGER NOT NULL DEFAULT 0 CHECK (price_adjustment_bps BETWEEN -9000 AND 10000);

CREATE TABLE customer_prices (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id, product_id)
);
CREATE INDEX customer_prices_org ON customer_prices (organization_id, customer_id);
