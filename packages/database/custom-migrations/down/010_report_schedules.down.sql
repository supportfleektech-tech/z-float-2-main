-- ============================================================
-- Z-float down migration: 010_report_schedules.down.sql
-- Rollback: Drop report_schedules table and reports.schedule_id column
-- ============================================================

DROP INDEX IF EXISTS "reports_schedule_idx";
ALTER TABLE "reports" DROP COLUMN IF EXISTS "schedule_id";

DROP INDEX IF EXISTS "report_schedules_due_idx";
DROP INDEX IF EXISTS "report_schedules_tenant_idx";
DROP TABLE IF EXISTS "report_schedules";