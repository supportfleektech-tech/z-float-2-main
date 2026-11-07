-- ============================================================
-- Z-float down migration: 027_accounting_integration.down.sql
-- Rollback: Drop accounting integration tables and triggers
-- ============================================================

DROP TRIGGER IF EXISTS update_accounting_mappings_updated_at ON accounting_mappings;
DROP TRIGGER IF EXISTS update_accounting_connections_updated_at ON accounting_connections;

DROP INDEX IF EXISTS accounting_sync_log_created_idx;
DROP INDEX IF EXISTS accounting_sync_log_status_idx;
DROP INDEX IF EXISTS accounting_sync_log_entity_idx;
DROP INDEX IF EXISTS accounting_sync_log_connection_idx;
DROP INDEX IF EXISTS accounting_sync_log_tenant_idx;
DROP TABLE IF EXISTS accounting_sync_log;

DROP INDEX IF EXISTS accounting_mappings_ledger_idx;
DROP INDEX IF EXISTS accounting_mappings_chart_idx;
DROP INDEX IF EXISTS accounting_mappings_tenant_idx;
DROP INDEX IF EXISTS accounting_mappings_conn_external_uidx;
DROP TABLE IF EXISTS accounting_mappings;

DROP INDEX IF EXISTS accounting_connections_status_idx;
DROP INDEX IF EXISTS accounting_connections_tenant_idx;
DROP INDEX IF EXISTS accounting_connections_tenant_provider_uidx;
DROP TABLE IF EXISTS accounting_connections;

DROP FUNCTION IF EXISTS update_updated_at_column();