-- ============================================================
-- Z-float down migration: 002_batch_product.down.sql
-- Rollback: Batch product column and payments provider_reference index
-- ============================================================

-- Drop index
DROP INDEX IF EXISTS payments_provider_reference_idx;

-- Drop column
ALTER TABLE payment_batches DROP COLUMN IF EXISTS product;