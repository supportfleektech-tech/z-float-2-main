-- ============================================================
-- Z-float down migration: 029_soft_delete.down.sql
-- Rollback: Remove soft delete (deleted_at) columns and indexes
-- ============================================================

-- ------------------------------------------------------------------
-- 1. Core entities
-- ------------------------------------------------------------------

DROP INDEX IF EXISTS users_deleted_at_idx;
ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS tenants_deleted_at_idx;
ALTER TABLE tenants DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS wallets_deleted_at_idx;
ALTER TABLE wallets DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS payments_deleted_at_idx;
ALTER TABLE payments DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS payment_batches_deleted_at_idx;
ALTER TABLE payment_batches DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS beneficiaries_deleted_at_idx;
ALTER TABLE beneficiaries DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS customers_deleted_at_idx;
ALTER TABLE customers DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS collections_deleted_at_idx;
ALTER TABLE collections DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS approval_policies_deleted_at_idx;
ALTER TABLE approval_policies DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS approval_requests_deleted_at_idx;
ALTER TABLE approval_requests DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS webhook_events_deleted_at_idx;
ALTER TABLE webhook_events DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS webhook_deliveries_deleted_at_idx;
ALTER TABLE webhook_deliveries DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS outbox_events_deleted_at_idx;
ALTER TABLE outbox_events DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS audit_events_deleted_at_idx;
ALTER TABLE audit_events DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS journals_deleted_at_idx;
ALTER TABLE journals DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS journal_entries_deleted_at_idx;
ALTER TABLE journal_entries DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS ledger_accounts_deleted_at_idx;
ALTER TABLE ledger_accounts DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS kyb_cases_deleted_at_idx;
ALTER TABLE kyb_cases DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS kyc_cases_deleted_at_idx;
ALTER TABLE kyc_cases DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS kyc_subjects_deleted_at_idx;
ALTER TABLE kyc_subjects DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS recon_exceptions_deleted_at_idx;
ALTER TABLE recon_exceptions DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS recon_runs_deleted_at_idx;
ALTER TABLE recon_runs DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS fee_versions_deleted_at_idx;
ALTER TABLE fee_versions DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS api_keys_deleted_at_idx;
ALTER TABLE api_keys DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS invitations_deleted_at_idx;
ALTER TABLE invitations DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS invoices_deleted_at_idx;
ALTER TABLE invoices DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS reversals_deleted_at_idx;
ALTER TABLE reversals DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS settlements_deleted_at_idx;
ALTER TABLE settlements DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS payment_schedules_deleted_at_idx;
ALTER TABLE payment_schedules DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS fee_rules_deleted_at_idx;
ALTER TABLE fee_rules DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS payment_routes_deleted_at_idx;
ALTER TABLE payment_routes DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS providers_deleted_at_idx;
ALTER TABLE providers DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS payment_methods_deleted_at_idx;
ALTER TABLE payment_methods DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS branches_deleted_at_idx;
ALTER TABLE branches DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS departments_deleted_at_idx;
ALTER TABLE departments DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS roles_deleted_at_idx;
ALTER TABLE roles DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS permissions_deleted_at_idx;
ALTER TABLE permissions DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS settings_deleted_at_idx;
ALTER TABLE settings DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS feature_flags_deleted_at_idx;
ALTER TABLE feature_flags DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS pages_deleted_at_idx;
ALTER TABLE pages DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS posts_deleted_at_idx;
ALTER TABLE posts DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS support_tickets_deleted_at_idx;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS chart_of_accounts_deleted_at_idx;
ALTER TABLE chart_of_accounts DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS business_accounts_deleted_at_idx;
ALTER TABLE business_accounts DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS funding_events_deleted_at_idx;
ALTER TABLE funding_events DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS idempotency_records_deleted_at_idx;
ALTER TABLE idempotency_records DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS verification_documents_deleted_at_idx;
ALTER TABLE verification_documents DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS wallet_reservations_deleted_at_idx;
ALTER TABLE wallet_reservations DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS balance_snapshots_deleted_at_idx;
ALTER TABLE balance_snapshots DROP COLUMN IF EXISTS deleted_at;

-- ------------------------------------------------------------------
-- 2. eTIMS tables
-- ------------------------------------------------------------------
DROP INDEX IF EXISTS etims_devices_deleted_at_idx;
ALTER TABLE etims_devices DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS etims_documents_deleted_at_idx;
ALTER TABLE etims_documents DROP COLUMN IF EXISTS deleted_at;

-- ------------------------------------------------------------------
-- 3. Support system tables
-- ------------------------------------------------------------------
DROP INDEX IF EXISTS support_agents_deleted_at_idx;
ALTER TABLE support_agents DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS support_chat_sessions_deleted_at_idx;
ALTER TABLE support_chat_sessions DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS support_chat_messages_deleted_at_idx;
ALTER TABLE support_chat_messages DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS callback_requests_deleted_at_idx;
ALTER TABLE callback_requests DROP COLUMN IF EXISTS deleted_at;

-- ------------------------------------------------------------------
-- 4. Custom migration tables
-- ------------------------------------------------------------------
DROP INDEX IF EXISTS budgets_deleted_at_idx;
ALTER TABLE budgets DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS budget_items_deleted_at_idx;
ALTER TABLE budget_items DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS spend_limits_deleted_at_idx;
ALTER TABLE spend_limits DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS petty_cash_wallets_deleted_at_idx;
ALTER TABLE petty_cash_wallets DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS accounting_connections_deleted_at_idx;
ALTER TABLE accounting_connections DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS accounting_mappings_deleted_at_idx;
ALTER TABLE accounting_mappings DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS accounting_sync_log_deleted_at_idx;
ALTER TABLE accounting_sync_log DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS payroll_runs_deleted_at_idx;
ALTER TABLE payroll_runs DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS payslips_deleted_at_idx;
ALTER TABLE payslips DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS aml_watchlists_deleted_at_idx;
ALTER TABLE aml_watchlists DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS payment_links_deleted_at_idx;
ALTER TABLE payment_links DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS recon_exception_activity_deleted_at_idx;
ALTER TABLE recon_exception_activity DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS reports_deleted_at_idx;
ALTER TABLE reports DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS wallet_ledger_entries_deleted_at_idx;
ALTER TABLE wallet_ledger_entries DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS webhook_subscriptions_deleted_at_idx;
ALTER TABLE webhook_subscriptions DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS kyc_documents_deleted_at_idx;
ALTER TABLE kyc_documents DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS kyc_profiles_deleted_at_idx;
ALTER TABLE kyc_profiles DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS kyc_screenings_deleted_at_idx;
ALTER TABLE kyc_screenings DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS mfa_backup_codes_deleted_at_idx;
ALTER TABLE mfa_backup_codes DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS notification_preferences_deleted_at_idx;
ALTER TABLE notification_preferences DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS expense_ledgers_deleted_at_idx;
ALTER TABLE expense_ledgers DROP COLUMN IF EXISTS deleted_at;

-- ------------------------------------------------------------------
-- 5. Drop helper function
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS zf_is_not_deleted(record anyelement);