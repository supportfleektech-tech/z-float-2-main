-- ============================================================
-- Z-float down migration: 020_fee_amount_bands.down.sql
-- Rollback: Drop fee_rules amount band columns
-- ============================================================

ALTER TABLE fee_rules DROP COLUMN IF EXISTS amount_minor_max;
ALTER TABLE fee_rules DROP COLUMN IF EXISTS amount_minor_min;