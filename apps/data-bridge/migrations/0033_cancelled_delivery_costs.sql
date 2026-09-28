-- A cancelled or removed delivery does not go out, so its sale stops carrying a delivery cost (the app now does this
-- when a delivery is cancelled or removed). This fixes the sales left behind before: an active cancelled delivery, or
-- only removed deliveries and none active. Each corrected sale gets an audit event that keeps the cost it had, so the
-- change shows in its history and can be undone by hand.
INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json)
SELECT lower(hex(randomblob(16))), s.organization_id, 'system', 'update-sale', s.id,
  json_object('before', json_object('deliveryCostMinor', s.delivery_cost_minor), 'patch', json_object('deliveryCost', 0), 'reason', 'Entrega cancelada o quitada: sin costo de entrega', 'source', 'user')
FROM sales s
WHERE s.archived_at IS NULL AND s.delivery_cost_minor > 0 AND (
  EXISTS (SELECT 1 FROM deliveries d WHERE d.sale_id = s.id AND d.archived_at IS NULL AND d.status = 'cancelled')
  OR (NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.sale_id = s.id AND d.archived_at IS NULL)
    AND EXISTS (SELECT 1 FROM deliveries d WHERE d.sale_id = s.id AND d.archived_at IS NOT NULL))
);

UPDATE sales SET delivery_cost_minor = 0
WHERE archived_at IS NULL AND delivery_cost_minor > 0 AND (
  EXISTS (SELECT 1 FROM deliveries d WHERE d.sale_id = sales.id AND d.archived_at IS NULL AND d.status = 'cancelled')
  OR (NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.sale_id = sales.id AND d.archived_at IS NULL)
    AND EXISTS (SELECT 1 FROM deliveries d WHERE d.sale_id = sales.id AND d.archived_at IS NOT NULL))
);
