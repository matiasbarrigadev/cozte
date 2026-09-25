-- Each workshop investment can be spread into every unit's cost, if the person decides so with Cozte.
-- Off by default: until then its monthly share only counts in the month's result.
ALTER TABLE purchases ADD COLUMN include_in_unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (include_in_unit_cost IN (0, 1));
ALTER TABLE purchases ADD COLUMN allocation_basis TEXT NOT NULL DEFAULT 'hours' CHECK (allocation_basis IN ('hours', 'units'));
