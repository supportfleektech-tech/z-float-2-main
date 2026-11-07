-- ============================================================
-- Z-float down migration: 014_platform_config_approvals.down.sql
-- Rollback: Drop platform config approval columns
-- ============================================================

ALTER TABLE approval_requests DROP COLUMN IF EXISTS execution_error;
ALTER TABLE approval_requests DROP COLUMN IF EXISTS executed_at;