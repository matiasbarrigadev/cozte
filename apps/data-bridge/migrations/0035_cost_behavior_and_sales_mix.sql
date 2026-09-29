-- How each monthly expense behaves as production moves: fixed (the same every month), variable (grows with each unit,
-- lot or hour produced) or mixed (a fixed base plus a part that grows). Variable parts go into each product's variable
-- cost; fixed parts stay in the month's structure. The note says why (Cozte's recommendation or the person's choice).
ALTER TABLE shared_expenses ADD COLUMN behavior TEXT NOT NULL DEFAULT 'fixed' CHECK (behavior IN ('fixed', 'variable', 'mixed'));
ALTER TABLE shared_expenses ADD COLUMN variable_driver TEXT CHECK (variable_driver IN ('unit', 'lot', 'hour'));
ALTER TABLE shared_expenses ADD COLUMN variable_share_bps INTEGER NOT NULL DEFAULT 10000 CHECK (variable_share_bps BETWEEN 0 AND 10000);
ALTER TABLE shared_expenses ADD COLUMN behavior_note TEXT NOT NULL DEFAULT '';

-- The planned sales mix for the break-even of a normal month: each product's share of what is sold, in units or in
-- revenue, and where it comes from (chosen, last month's sales, the production plan, equal parts, or automatic).
CREATE TABLE sales_mix_plans (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
  basis TEXT NOT NULL DEFAULT 'units' CHECK (basis IN ('units', 'revenue')),
  source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual', 'last_month', 'plan', 'equal')),
  -- Product id → share in hundredths of a percent (manual source); adds up to 10000.
  shares_json TEXT NOT NULL DEFAULT '{}',
  -- A monthly profit to aim for, on top of covering the fixed costs.
  target_profit_minor INTEGER NOT NULL DEFAULT 0 CHECK (target_profit_minor >= 0),
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
