-- The first-time questions (who you are, your company's name and country) are asked once per company.
ALTER TABLE organizations ADD COLUMN onboarded_at TEXT;
-- When the name was set in Cozte: for a while, an older name remembered from the account does not replace it.
ALTER TABLE organizations ADD COLUMN name_set_at TEXT;
-- How the person likes to be called, so Cozte can address them by name.
ALTER TABLE memberships ADD COLUMN display_name TEXT NOT NULL DEFAULT '';

-- Companies already at work in Cozte skip the first-time questions.
UPDATE organizations SET onboarded_at = CURRENT_TIMESTAMP
WHERE country IS NOT NULL
   OR EXISTS (SELECT 1 FROM products p WHERE p.organization_id = organizations.id)
   OR EXISTS (SELECT 1 FROM materials m WHERE m.organization_id = organizations.id)
   OR EXISTS (SELECT 1 FROM shared_expenses e WHERE e.organization_id = organizations.id)
   OR EXISTS (SELECT 1 FROM sales s WHERE s.organization_id = organizations.id);
