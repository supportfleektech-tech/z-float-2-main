-- ============================================================
-- Z-float down migration: 013_webhook_events_payload_body.down.sql
-- Rollback: Drop webhook_events.payload_body column
-- ============================================================

ALTER TABLE webhook_events DROP COLUMN IF EXISTS payload_body;