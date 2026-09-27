-- A record's history (Ventas, Entregas, Compras) reads its own events without scanning the whole log.
CREATE INDEX audit_entity_idx ON audit_events (organization_id, entity_id, created_at DESC);
