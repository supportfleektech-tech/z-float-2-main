-- ============================================================
-- Z-float down migration: 018_perf_indexes.down.sql
-- Rollback: Drop performance indexes
-- ============================================================

DROP INDEX IF EXISTS audit_events_action_created_idx;
DROP INDEX IF EXISTS notifications_tenant_created_idx;
DROP INDEX IF EXISTS webhook_deliveries_created_idx;
DROP INDEX IF EXISTS webhook_deliveries_tenant_created_idx;