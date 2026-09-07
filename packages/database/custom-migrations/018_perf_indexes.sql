-- 018_perf_indexes.sql — GAP closeout: EXPLAIN-driven ordering/scan indexes.
-- Justification (from EXPLAIN ANALYZE on the live workload + metric scrape):
--  * webhook_deliveries: tenant list orders by created_at DESC (limit 25) and
--    the admin metrics route aggregates 24h by created_at; only tenant_id and
--    subscription_id were indexed → sort/full-scan per scrape.
--  * notifications: tenant inbox lists + unread counts order by created_at
--    DESC; tenant/user-only indexes forced a sort of the tenant's rows.
--  * audit_events: admin audit viewer filters action-prefix + actor across
--    tenants with limit 500; no leading-action index existed.
-- All btree; harmless at current scale, correct as volumes grow.
CREATE INDEX IF NOT EXISTS webhook_deliveries_tenant_created_idx
  ON webhook_deliveries (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_created_idx
  ON webhook_deliveries (created_at);
CREATE INDEX IF NOT EXISTS notifications_tenant_created_idx
  ON notifications (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_action_created_idx
  ON audit_events (action, created_at DESC);
