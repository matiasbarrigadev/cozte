-- Route sheets: the order of each stop in its day's route (null until someone or Cozte arranges it) and where the
-- routes start from (empty: from wherever the driver is).
ALTER TABLE deliveries ADD COLUMN route_position INTEGER;
ALTER TABLE organizations ADD COLUMN route_origin TEXT NOT NULL DEFAULT '';
