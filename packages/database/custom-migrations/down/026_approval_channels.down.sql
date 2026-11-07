-- ============================================================
-- Z-float down migration: 026_approval_channels.down.sql
-- Rollback: Drop approval_tokens and notification_preferences tables
-- ============================================================

DROP TRIGGER IF EXISTS trigger_notification_preferences_updated_at ON notification_preferences;
DROP FUNCTION IF EXISTS update_notification_preferences_updated_at();

DROP INDEX IF EXISTS notification_preferences_user_channel_event_uidx;
DROP INDEX IF EXISTS notification_preferences_tenant_idx;
DROP INDEX IF EXISTS notification_preferences_user_idx;
DROP TABLE IF EXISTS notification_preferences;

DROP INDEX IF EXISTS approval_tokens_request_actor_decision_uidx;
DROP INDEX IF EXISTS approval_tokens_hash_idx;
DROP INDEX IF EXISTS approval_tokens_actor_idx;
DROP INDEX IF EXISTS approval_tokens_request_idx;
DROP TABLE IF EXISTS approval_tokens;