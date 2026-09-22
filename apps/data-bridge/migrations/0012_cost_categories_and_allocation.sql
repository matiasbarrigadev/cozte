CREATE TABLE cost_categories (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX cost_categories_org_name_idx ON cost_categories(organization_id, lower(name));

INSERT INTO cost_categories (id, organization_id, name)
SELECT lower(hex(randomblob(16))), organization_id, category FROM (
  SELECT organization_id, category FROM materials
  UNION
  SELECT organization_id, category FROM shared_expenses
) GROUP BY organization_id, lower(category);

ALTER TABLE shared_expenses ADD COLUMN allocation_shares_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE shared_expenses ADD COLUMN allocation_mode TEXT NOT NULL DEFAULT 'automatic' CHECK (allocation_mode IN ('automatic', 'manual'));
