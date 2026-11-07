-- ============================================================
-- Z-float down migration: 022_expense_management.down.sql
-- Rollback: Drop expense_ledgers table and charges columns
-- ============================================================

ALTER TABLE charges DROP COLUMN IF EXISTS receipt_file_id;
ALTER TABLE charges DROP COLUMN IF EXISTS ledger_id;
ALTER TABLE charges DROP COLUMN IF EXISTS category;

DROP INDEX IF EXISTS expense_ledgers_tenant_name_uidx;
DROP TABLE IF EXISTS expense_ledgers;