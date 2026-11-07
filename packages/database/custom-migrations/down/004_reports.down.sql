-- ============================================================
-- Z-float down migration: 004_reports.down.sql
-- Rollback: Drop reports table
-- ============================================================

DROP INDEX IF EXISTS reports_tenant_idx;
DROP TABLE IF EXISTS reports;