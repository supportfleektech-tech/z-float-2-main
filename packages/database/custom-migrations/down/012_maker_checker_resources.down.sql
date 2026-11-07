-- ============================================================
-- Z-float down migration: 012_maker_checker_resources.down.sql
-- Rollback: Drop maker-checker resource columns and indexes
-- ============================================================

DROP INDEX IF EXISTS invitations_role_approval_idx;
ALTER TABLE invitations DROP COLUMN IF EXISTS role_approved_by_id;
ALTER TABLE invitations DROP COLUMN IF EXISTS role_approval_status;

DROP INDEX IF EXISTS approval_requests_resource_idx;
ALTER TABLE approval_requests DROP COLUMN IF EXISTS resource_id;
ALTER TABLE approval_requests DROP COLUMN IF EXISTS resource_type;