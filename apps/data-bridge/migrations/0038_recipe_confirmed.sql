-- A recipe is complete only when the person says so: Cozte suggests what may be missing and asks first.
ALTER TABLE products ADD COLUMN recipe_confirmed_at TEXT;

-- Businesses already set up before the path (their workspace was opened whole) keep their recipes as complete.
UPDATE products SET recipe_confirmed_at = CURRENT_TIMESTAMP
WHERE organization_id IN (SELECT id FROM organizations WHERE unlock_all = 1);

-- The supplies stage closed without a confirmed recipe reopens, so its completion is recorded when it really happens.
UPDATE journey_progress SET completed_at = NULL
WHERE stage_id = 'insumos' AND organization_id IN (SELECT id FROM organizations WHERE unlock_all = 0);

-- Stages started on a path the company left (before switching between project and operating) and never finished.
DELETE FROM journey_progress
WHERE completed_at IS NULL
  AND journey_key <> COALESCE((SELECT COALESCE(o.journey_key, o.business_mode, 'operating') FROM organizations o WHERE o.id = journey_progress.organization_id), 'operating');
