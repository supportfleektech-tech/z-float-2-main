-- ============================================================
-- Z-float custom migrations: 013_webhook_events_payload_body.sql
-- Schema-drift repair: ingestWebhook persists the exact serialized bytes
-- it received (payload_body, used for signature verification and replay),
-- but no migration ever created the column on webhook_events. Align the
-- table with packages/database/src/schema.
-- ============================================================

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS payload_body text;
