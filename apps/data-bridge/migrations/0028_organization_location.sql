-- Where the business is: the country gives its timezone, how Cozte talks and the usual currency; the city is for
-- reference. The timezone is stored when the country has several.
ALTER TABLE organizations ADD COLUMN country TEXT;
ALTER TABLE organizations ADD COLUMN city TEXT;
ALTER TABLE organizations ADD COLUMN time_zone TEXT;
