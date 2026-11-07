-- ============================================================
-- Z-float down migration: 021_supplier_bank_details.down.sql
-- Rollback: Drop beneficiary bank detail columns
-- ============================================================

ALTER TABLE beneficiaries DROP COLUMN IF EXISTS till_name;
ALTER TABLE beneficiaries DROP COLUMN IF EXISTS paybill_name;
ALTER TABLE beneficiaries DROP COLUMN IF EXISTS bank_name;