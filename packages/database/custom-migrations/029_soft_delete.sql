-- ============================================================
-- Z-float custom migrations: 029_soft_delete.sql
-- Add soft delete (deleted_at) to critical entities
-- Table names match the drizzle schema (0000_fat_norman_osborn.sql)
-- and custom migrations
-- ============================================================

-- ------------------------------------------------------------------
-- 1. Core entities that should support soft delete
-- ------------------------------------------------------------------

-- Users (but keep auth constraints)
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS users_deleted_at_idx ON users (deleted_at) WHERE deleted_at IS NOT NULL;

-- Tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS tenants_deleted_at_idx ON tenants (deleted_at) WHERE deleted_at IS NOT NULL;

-- Wallets
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS wallets_deleted_at_idx ON wallets (deleted_at) WHERE deleted_at IS NOT NULL;

-- Payments
ALTER TABLE payments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS payments_deleted_at_idx ON payments (deleted_at) WHERE deleted_at IS NOT NULL;

-- Payment batches (not "batches")
ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS payment_batches_deleted_at_idx ON payment_batches (deleted_at) WHERE deleted_at IS NOT NULL;

-- Beneficiaries (not "payees")
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS beneficiaries_deleted_at_idx ON beneficiaries (deleted_at) WHERE deleted_at IS NOT NULL;

-- Customers (from 019)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS customers_deleted_at_idx ON customers (deleted_at) WHERE deleted_at IS NOT NULL;

-- Collections (from 019)
ALTER TABLE collections ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS collections_deleted_at_idx ON collections (deleted_at) WHERE deleted_at IS NOT NULL;

-- Approval policies
ALTER TABLE approval_policies ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS approval_policies_deleted_at_idx ON approval_policies (deleted_at) WHERE deleted_at IS NOT NULL;

-- Approval requests
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS approval_requests_deleted_at_idx ON approval_requests (deleted_at) WHERE deleted_at IS NOT NULL;

-- Webhook events (not "webhook_deliveries")
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS webhook_events_deleted_at_idx ON webhook_events (deleted_at) WHERE deleted_at IS NOT NULL;

-- Webhook deliveries (from custom migrations)
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS webhook_deliveries_deleted_at_idx ON webhook_deliveries (deleted_at) WHERE deleted_at IS NOT NULL;

-- Outbox events (already append-only, but add for consistency)
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS outbox_events_deleted_at_idx ON outbox_events (deleted_at) WHERE deleted_at IS NOT NULL;

-- Audit events (already append-only, but add for consistency)
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS audit_events_deleted_at_idx ON audit_events (deleted_at) WHERE deleted_at IS NOT NULL;

-- Journals (already append-only via trigger)
ALTER TABLE journals ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS journals_deleted_at_idx ON journals (deleted_at) WHERE deleted_at IS NOT NULL;

-- Journal entries (already append-only via trigger)
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS journal_entries_deleted_at_idx ON journal_entries (deleted_at) WHERE deleted_at IS NOT NULL;

-- Ledger accounts
ALTER TABLE ledger_accounts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS ledger_accounts_deleted_at_idx ON ledger_accounts (deleted_at) WHERE deleted_at IS NOT NULL;

-- KYB cases
ALTER TABLE kyb_cases ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS kyb_cases_deleted_at_idx ON kyb_cases (deleted_at) WHERE deleted_at IS NOT NULL;

-- KYC cases (from custom migrations)
ALTER TABLE kyc_cases ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS kyc_cases_deleted_at_idx ON kyc_cases (deleted_at) WHERE deleted_at IS NOT NULL;

-- KYC subjects
ALTER TABLE kyc_subjects ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS kyc_subjects_deleted_at_idx ON kyc_subjects (deleted_at) WHERE deleted_at IS NOT NULL;

-- Recon exceptions
ALTER TABLE recon_exceptions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS recon_exceptions_deleted_at_idx ON recon_exceptions (deleted_at) WHERE deleted_at IS NOT NULL;

-- Recon runs
ALTER TABLE recon_runs ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS recon_runs_deleted_at_idx ON recon_runs (deleted_at) WHERE deleted_at IS NOT NULL;

-- Fee versions
ALTER TABLE fee_versions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS fee_versions_deleted_at_idx ON fee_versions (deleted_at) WHERE deleted_at IS NOT NULL;

-- API keys
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS api_keys_deleted_at_idx ON api_keys (deleted_at) WHERE deleted_at IS NOT NULL;

-- Invitations (not "invite_tokens")
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS invitations_deleted_at_idx ON invitations (deleted_at) WHERE deleted_at IS NOT NULL;

-- Invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS invoices_deleted_at_idx ON invoices (deleted_at) WHERE deleted_at IS NOT NULL;

-- Reversals
ALTER TABLE reversals ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS reversals_deleted_at_idx ON reversals (deleted_at) WHERE deleted_at IS NOT NULL;

-- Settlements
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS settlements_deleted_at_idx ON settlements (deleted_at) WHERE deleted_at IS NOT NULL;

-- Payment schedules
ALTER TABLE payment_schedules ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS payment_schedules_deleted_at_idx ON payment_schedules (deleted_at) WHERE deleted_at IS NOT NULL;

-- Fee rules
ALTER TABLE fee_rules ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS fee_rules_deleted_at_idx ON fee_rules (deleted_at) WHERE deleted_at IS NOT NULL;

-- Payment routes
ALTER TABLE payment_routes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS payment_routes_deleted_at_idx ON payment_routes (deleted_at) WHERE deleted_at IS NOT NULL;

-- Providers
ALTER TABLE providers ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS providers_deleted_at_idx ON providers (deleted_at) WHERE deleted_at IS NOT NULL;

-- Payment methods
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS payment_methods_deleted_at_idx ON payment_methods (deleted_at) WHERE deleted_at IS NOT NULL;

-- Branches
ALTER TABLE branches ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS branches_deleted_at_idx ON branches (deleted_at) WHERE deleted_at IS NOT NULL;

-- Departments
ALTER TABLE departments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS departments_deleted_at_idx ON departments (deleted_at) WHERE deleted_at IS NOT NULL;

-- Roles
ALTER TABLE roles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS roles_deleted_at_idx ON roles (deleted_at) WHERE deleted_at IS NOT NULL;

-- Permissions
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS permissions_deleted_at_idx ON permissions (deleted_at) WHERE deleted_at IS NOT NULL;

-- Settings
ALTER TABLE settings ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS settings_deleted_at_idx ON settings (deleted_at) WHERE deleted_at IS NOT NULL;

-- Feature flags
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS feature_flags_deleted_at_idx ON feature_flags (deleted_at) WHERE deleted_at IS NOT NULL;

-- Pages
ALTER TABLE pages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS pages_deleted_at_idx ON pages (deleted_at) WHERE deleted_at IS NOT NULL;

-- Posts
ALTER TABLE posts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS posts_deleted_at_idx ON posts (deleted_at) WHERE deleted_at IS NOT NULL;

-- Support tickets
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS support_tickets_deleted_at_idx ON support_tickets (deleted_at) WHERE deleted_at IS NOT NULL;

-- Chart of accounts
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS chart_of_accounts_deleted_at_idx ON chart_of_accounts (deleted_at) WHERE deleted_at IS NOT NULL;

-- Business accounts
ALTER TABLE business_accounts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS business_accounts_deleted_at_idx ON business_accounts (deleted_at) WHERE deleted_at IS NOT NULL;

-- Funding events
ALTER TABLE funding_events ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS funding_events_deleted_at_idx ON funding_events (deleted_at) WHERE deleted_at IS NOT NULL;

-- Idempotency records
ALTER TABLE idempotency_records ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idempotency_records_deleted_at_idx ON idempotency_records (deleted_at) WHERE deleted_at IS NOT NULL;

-- Verification documents
ALTER TABLE verification_documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS verification_documents_deleted_at_idx ON verification_documents (deleted_at) WHERE deleted_at IS NOT NULL;

-- Wallet reservations
ALTER TABLE wallet_reservations ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS wallet_reservations_deleted_at_idx ON wallet_reservations (deleted_at) WHERE deleted_at IS NOT NULL;

-- Balance snapshots
ALTER TABLE balance_snapshots ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS balance_snapshots_deleted_at_idx ON balance_snapshots (deleted_at) WHERE deleted_at IS NOT NULL;

-- ------------------------------------------------------------------
-- 2. eTIMS tables (from 019_identity_etims_collections.sql)
-- ------------------------------------------------------------------
ALTER TABLE etims_devices ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS etims_devices_deleted_at_idx ON etims_devices (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE etims_documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS etims_documents_deleted_at_idx ON etims_documents (deleted_at) WHERE deleted_at IS NOT NULL;

-- ------------------------------------------------------------------
-- 3. Support system tables (from 028_support_tables.sql)
-- ------------------------------------------------------------------
ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS support_agents_deleted_at_idx ON support_agents (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE support_chat_sessions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS support_chat_sessions_deleted_at_idx ON support_chat_sessions (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE support_chat_messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS support_chat_messages_deleted_at_idx ON support_chat_messages (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE callback_requests ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS callback_requests_deleted_at_idx ON callback_requests (deleted_at) WHERE deleted_at IS NOT NULL;

-- ------------------------------------------------------------------
-- 4. Custom migration tables
-- ------------------------------------------------------------------
-- Budgets
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS budgets_deleted_at_idx ON budgets (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS budget_items_deleted_at_idx ON budget_items (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE spend_limits ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS spend_limits_deleted_at_idx ON spend_limits (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE petty_cash_wallets ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS petty_cash_wallets_deleted_at_idx ON petty_cash_wallets (deleted_at) WHERE deleted_at IS NOT NULL;

-- Accounting
ALTER TABLE accounting_connections ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS accounting_connections_deleted_at_idx ON accounting_connections (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE accounting_mappings ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS accounting_mappings_deleted_at_idx ON accounting_mappings (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE accounting_sync_log ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS accounting_sync_log_deleted_at_idx ON accounting_sync_log (deleted_at) WHERE deleted_at IS NOT NULL;

-- Payroll
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS payroll_runs_deleted_at_idx ON payroll_runs (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE payslips ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS payslips_deleted_at_idx ON payslips (deleted_at) WHERE deleted_at IS NOT NULL;

-- AML
ALTER TABLE aml_watchlists ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS aml_watchlists_deleted_at_idx ON aml_watchlists (deleted_at) WHERE deleted_at IS NOT NULL;

-- Payment links
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS payment_links_deleted_at_idx ON payment_links (deleted_at) WHERE deleted_at IS NOT NULL;

-- Recon
ALTER TABLE recon_exception_activity ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS recon_exception_activity_deleted_at_idx ON recon_exception_activity (deleted_at) WHERE deleted_at IS NOT NULL;

-- Reports
ALTER TABLE reports ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS reports_deleted_at_idx ON reports (deleted_at) WHERE deleted_at IS NOT NULL;

-- Wallet ledger
ALTER TABLE wallet_ledger_entries ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS wallet_ledger_entries_deleted_at_idx ON wallet_ledger_entries (deleted_at) WHERE deleted_at IS NOT NULL;

-- Webhook subscriptions
ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS webhook_subscriptions_deleted_at_idx ON webhook_subscriptions (deleted_at) WHERE deleted_at IS NOT NULL;

-- KYC
ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS kyc_documents_deleted_at_idx ON kyc_documents (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE kyc_profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS kyc_profiles_deleted_at_idx ON kyc_profiles (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE kyc_screenings ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS kyc_screenings_deleted_at_idx ON kyc_screenings (deleted_at) WHERE deleted_at IS NOT NULL;

-- MFA
ALTER TABLE mfa_backup_codes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS mfa_backup_codes_deleted_at_idx ON mfa_backup_codes (deleted_at) WHERE deleted_at IS NOT NULL;

-- Notifications
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS notification_preferences_deleted_at_idx ON notification_preferences (deleted_at) WHERE deleted_at IS NOT NULL;

-- Expense ledgers
ALTER TABLE expense_ledgers ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS expense_ledgers_deleted_at_idx ON expense_ledgers (deleted_at) WHERE deleted_at IS NOT NULL;

-- ------------------------------------------------------------------
-- 5. Helper function to filter soft-deleted rows
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zf_is_not_deleted(record anyelement)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (record).deleted_at IS NULL;
$$;

-- ------------------------------------------------------------------
-- 6. Update triggers to set deleted_at on DELETE (for soft delete)
--    Note: This requires application-level changes to use UPDATE instead of DELETE
-- ------------------------------------------------------------------
-- Example trigger (commented out - enable per-table as needed):
-- CREATE OR REPLACE FUNCTION zf_soft_delete_trigger()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- AS $$
-- BEGIN
--   NEW.deleted_at = now();
--   RETURN NEW;
-- END;
-- $$;
-- 
-- CREATE TRIGGER trg_soft_delete_users
--   BEFORE DELETE ON users
--   FOR EACH ROW EXECUTE FUNCTION zf_soft_delete_trigger();