-- Invitations: demo-mode raw token carrier (never populated in production;
-- the raw token is emailed out-of-band and only its SHA-256 hash is stored).
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "raw_token" text;
