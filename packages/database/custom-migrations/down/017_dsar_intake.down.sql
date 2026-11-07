-- ============================================================
-- Z-float down migration: 017_dsar_intake.down.sql
-- Rollback: Drop DSAR intake columns and indexes
-- ============================================================

DROP INDEX IF EXISTS data_requests_email_idx;
DROP INDEX IF EXISTS data_requests_status_idx;
ALTER TABLE data_requests DROP COLUMN IF EXISTS note;
ALTER TABLE data_requests DROP COLUMN IF EXISTS requester_name;
ALTER TABLE data_requests DROP COLUMN IF EXISTS requester_email;
ALTER TABLE data_requests ALTER COLUMN tenant_id SET NOT NULL;