-- ============================================================
-- Z-float down migration: 023_branches_extension.down.sql
-- Rollback: Drop branches extension columns and indexes
-- ============================================================

DROP INDEX IF EXISTS wallets_branch_idx;
DROP INDEX IF EXISTS branches_tenant_etims_idx;
DROP INDEX IF EXISTS branches_tenant_default_uidx;

ALTER TABLE wallets DROP COLUMN IF EXISTS updated_at;

ALTER TABLE branches DROP COLUMN IF EXISTS updated_at;
ALTER TABLE branches DROP COLUMN IF EXISTS is_default;
ALTER TABLE branches DROP COLUMN IF EXISTS approval_policy_id;
ALTER TABLE branches DROP COLUMN IF EXISTS wallet_id;
ALTER TABLE branches DROP COLUMN IF EXISTS etims_branch_id;