-- How the company starts: a project that does not sell yet, or a business already selling.
ALTER TABLE organizations ADD COLUMN business_mode TEXT CHECK (business_mode IN ('project', 'operating'));
-- A path of its own for a group (for example, the students of a course); null = the path of its mode.
ALTER TABLE organizations ADD COLUMN journey_key TEXT;
-- Companies already at work see every module, whatever the level of the person.
ALTER TABLE organizations ADD COLUMN unlock_all INTEGER NOT NULL DEFAULT 0 CHECK (unlock_all IN (0, 1));

-- The discovery paths, editable without a release; a missing key uses the one built into Cozte.
CREATE TABLE journey_definitions (
  key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 2 AND 40),
  definition_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Each company's progress, by stage: when it started talking about it and when its data completed it.
CREATE TABLE journey_progress (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  journey_key TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  PRIMARY KEY (organization_id, journey_key, stage_id)
);

-- A module opened once stays open, even if the data that opened it is later removed.
CREATE TABLE module_unlocks (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  module TEXT NOT NULL,
  unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, module)
);

-- How each price is kept: the person's own, the market's updated every month, or a reference only.
CREATE TABLE price_watches (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('material', 'expense')),
  entity_id TEXT NOT NULL,
  policy TEXT NOT NULL CHECK (policy IN ('manual', 'market_monthly', 'reference')),
  query TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  last_checked_at TEXT,
  last_status TEXT CHECK (last_status IN ('applied', 'unchanged', 'needs_confirmation', 'not_found', 'error')),
  last_amount_milli INTEGER,
  last_currency TEXT,
  last_source_url TEXT,
  last_source_title TEXT,
  last_observed_on TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, entity_kind, entity_id)
);

-- Every web search, to keep each company within its monthly allowance.
CREATE TABLE web_searches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  query TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('chat', 'monthly')),
  results INTEGER NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX web_searches_org_time ON web_searches(organization_id, created_at);

-- The plan a project made before selling, kept to compare it with what really happens.
CREATE TABLE business_plans (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Companies already at work keep every module open; those that sell are businesses in operation.
UPDATE organizations SET unlock_all = 1
WHERE EXISTS (SELECT 1 FROM products p WHERE p.organization_id = organizations.id)
   OR EXISTS (SELECT 1 FROM sales s WHERE s.organization_id = organizations.id);
UPDATE organizations SET business_mode = 'operating'
WHERE business_mode IS NULL AND EXISTS (SELECT 1 FROM sales s WHERE s.organization_id = organizations.id);
