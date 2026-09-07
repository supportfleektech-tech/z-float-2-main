-- 015_webhook_reliability.sql
-- Phase 2 (GAP-ANALYSIS): webhook reliability ops on the OUTBOUND delivery log.
--  1. DLQ visibility: failed deliveries keep the payload + attempts and now
--     also the LAST error (network reason / HTTP status / why it stopped).
--  2. Secret rotation: per-subscription signing-secret versioning so rotation
--     is auditable (old secret invalidates immediately on rotate; retried and
--     replayed deliveries are re-signed with the CURRENT secret on the next
--     attempt — documented regeneration semantics).

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE webhook_subscriptions
  ADD COLUMN IF NOT EXISTS secret_version   INTEGER   NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS secret_rotated_at TIMESTAMPTZ;
