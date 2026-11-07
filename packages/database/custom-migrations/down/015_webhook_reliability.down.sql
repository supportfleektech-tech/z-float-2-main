-- ============================================================
-- Z-float down migration: 015_webhook_reliability.down.sql
-- Rollback: Drop webhook reliability columns
-- ============================================================

ALTER TABLE webhook_subscriptions DROP COLUMN IF EXISTS secret_rotated_at;
ALTER TABLE webhook_subscriptions DROP COLUMN IF EXISTS secret_version;

ALTER TABLE webhook_deliveries DROP COLUMN IF EXISTS last_error;