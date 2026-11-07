-- ============================================================
-- Z-float down migration: 009_invite_raw_token.down.sql
-- Rollback: Drop invitations.raw_token column
-- ============================================================

ALTER TABLE invitations DROP COLUMN IF EXISTS raw_token;