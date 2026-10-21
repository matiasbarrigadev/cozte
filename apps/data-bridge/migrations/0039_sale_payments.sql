-- What has been collected of each sale and how: what the customer still owes is the rest.
ALTER TABLE sales ADD COLUMN paid_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_minor >= 0);
ALTER TABLE sales ADD COLUMN payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('cash', 'transfer', 'debit', 'credit'));
-- The day the sale was paid in full; null while something is owed.
ALTER TABLE sales ADD COLUMN paid_on TEXT;

-- Sales recorded before payments were tracked count as collected on the day they were sold.
UPDATE sales SET paid_minor = total_minor, paid_on = sold_on;

CREATE INDEX sales_owed ON sales (organization_id, archived_at, paid_minor, total_minor);
