-- Deliveries are their own world: each sale that has to reach the customer gets a delivery with its date, status and
-- logistics details. What delivering costs stays on the sale (sales.delivery_cost_minor), so the month's result is
-- computed exactly as before; the delivery table edits it through the sale.
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  sale_id TEXT NOT NULL REFERENCES sales(id),
  scheduled_on TEXT NOT NULL,
  -- Time window in the person's words ("9 a 13", "tarde").
  time_window TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'on_the_way', 'delivered', 'failed', 'cancelled')),
  method TEXT NOT NULL DEFAULT '',
  carrier TEXT NOT NULL DEFAULT '',
  recipient TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  tracking TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  delivered_on TEXT,
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'cozte')),
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);
-- One active delivery per sale for now; split deliveries can drop this later.
CREATE UNIQUE INDEX deliveries_sale ON deliveries (sale_id) WHERE archived_at IS NULL;
CREATE INDEX deliveries_org_date ON deliveries (organization_id, archived_at, scheduled_on);
CREATE INDEX deliveries_org_status ON deliveries (organization_id, archived_at, status);

-- Sales recorded before deliveries existed: the ones that paid to deliver were delivered on their sale date.
INSERT INTO deliveries (id, organization_id, sale_id, scheduled_on, status, method, recipient, delivered_on, source, actor_id)
SELECT lower(hex(randomblob(16))), s.organization_id, s.id, s.sold_on, 'delivered', COALESCE(c.delivery_method, ''), s.customer, s.sold_on, s.source, s.actor_id
FROM sales s LEFT JOIN sales_channels c ON c.id = s.channel_id
WHERE s.archived_at IS NULL AND s.delivery_cost_minor > 0;
