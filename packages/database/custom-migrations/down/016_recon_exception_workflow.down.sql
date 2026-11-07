-- ============================================================
-- Z-float down migration: 016_recon_exception_workflow.down.sql
-- Rollback: Drop recon_exception_activity table
-- ============================================================

DROP INDEX IF EXISTS recon_exception_activity_tenant_idx;
DROP INDEX IF EXISTS recon_exception_activity_exc_idx;
DROP TABLE IF EXISTS recon_exception_activity;