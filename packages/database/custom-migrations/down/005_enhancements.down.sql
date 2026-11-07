-- ============================================================
-- Z-float down migration: 005_enhancements.down.sql
-- Rollback: Drop MFA backup codes, payment links, webhook subscriptions, webhook deliveries
-- ============================================================

DROP INDEX IF EXISTS webhook_deliveries_sub_idx;
DROP INDEX IF EXISTS webhook_deliveries_tenant_idx;
DROP TABLE IF EXISTS webhook_deliveries;

DROP INDEX IF EXISTS webhook_subscriptions_tenant_idx;
DROP TABLE IF EXISTS webhook_subscriptions;

DROP INDEX IF EXISTS payment_links_token_idx;
DROP INDEX IF EXISTS payment_links_tenant_idx;
DROP TABLE IF EXISTS payment_links;

DROP INDEX IF EXISTS mfa_backup_codes_user_idx;
DROP TABLE IF EXISTS mfa_backup_codes;