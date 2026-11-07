-- ============================================================
-- Z-float down migration: 006_webhook_payload_body.down.sql
-- Rollback: Drop webhook_deliveries.payload_body column
-- ============================================================

ALTER TABLE webhook_deliveries DROP COLUMN IF EXISTS payload_body;