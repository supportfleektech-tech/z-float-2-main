-- ============================================================
-- Z-float down migration: 025_budgets.down.sql
-- Rollback: Drop budget tables and enum types
-- ============================================================

DROP INDEX IF EXISTS budget_spend_events_created_idx;
DROP INDEX IF EXISTS budget_spend_events_petty_idx;
DROP INDEX IF EXISTS budget_spend_events_payment_idx;
DROP INDEX IF EXISTS budget_spend_events_budget_idx;
DROP INDEX IF EXISTS budget_spend_events_tenant_idx;
DROP TABLE IF EXISTS budget_spend_events;

DROP INDEX IF EXISTS petty_cash_wallets_branch_idx;
DROP INDEX IF EXISTS petty_cash_wallets_employee_idx;
DROP INDEX IF EXISTS petty_cash_wallets_parent_idx;
DROP INDEX IF EXISTS petty_cash_wallets_tenant_idx;
DROP TABLE IF EXISTS petty_cash_wallets;

DROP INDEX IF EXISTS spend_limits_entity_cat_uidx;
DROP INDEX IF EXISTS spend_limits_period_idx;
DROP INDEX IF EXISTS spend_limits_entity_idx;
DROP INDEX IF EXISTS spend_limits_tenant_idx;
DROP TABLE IF EXISTS spend_limits;

DROP INDEX IF EXISTS budget_items_budget_cat_uidx;
DROP INDEX IF EXISTS budget_items_budget_idx;
DROP TABLE IF EXISTS budget_items;

DROP INDEX IF EXISTS budgets_status_idx;
DROP INDEX IF EXISTS budgets_period_idx;
DROP INDEX IF EXISTS budgets_scope_idx;
DROP INDEX IF EXISTS budgets_tenant_idx;
DROP TABLE IF EXISTS budgets;

DROP TYPE IF EXISTS budget_status;
DROP TYPE IF EXISTS spend_limit_action;
DROP TYPE IF EXISTS budget_scope;
DROP TYPE IF EXISTS budget_period;