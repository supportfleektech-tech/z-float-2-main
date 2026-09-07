-- Canonical webhook delivery body: exact bytes that are HMAC-signed and POSTed.
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS payload_body text;
