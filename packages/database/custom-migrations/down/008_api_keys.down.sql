-- ============================================================
-- Z-float down migration: 008_api_keys.down.sql
-- Rollback: Drop api_keys table
-- ============================================================

DROP INDEX IF EXISTS api_keys_hash_idx;
DROP INDEX IF EXISTS api_keys_tenant_idx;
DROP TABLE IF EXISTS api_keys;