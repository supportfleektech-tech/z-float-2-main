-- 025_budgets.sql
-- Budget management with spend limits at team/branch/employee level
-- Petty-cash sub-wallets with daily/monthly limits

-- Budget periods enum
CREATE TYPE budget_period AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM');

-- Budget scope enum
CREATE TYPE budget_scope AS ENUM ('TENANT', 'BRANCH', 'DEPARTMENT', 'EMPLOYEE');

-- Spend limit action enum
CREATE TYPE spend_limit_action AS ENUM ('WARN', 'BLOCK', 'REQUIRE_APPROVAL');

-- Budget status enum
CREATE TYPE budget_status AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'ARCHIVED');

-- Main budgets table
CREATE TABLE budgets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name varchar(200) NOT NULL,
    description text,
    scope budget_scope NOT NULL DEFAULT 'TENANT',
    scope_ref uuid, -- branch_id, department_id, or user_id depending on scope
    period budget_period NOT NULL DEFAULT 'MONTHLY',
    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,
    total_limit_minor bigint NOT NULL,
    status budget_status NOT NULL DEFAULT 'DRAFT',
    -- Approval workflow
    approval_required boolean NOT NULL DEFAULT false,
    approval_policy_id uuid REFERENCES approval_policies(id) ON DELETE SET NULL,
    -- Metadata
    created_by_id uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Budget items - category-level limits within a budget
CREATE TABLE budget_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    category varchar(100) NOT NULL, -- e.g., "travel", "office_supplies", "marketing", "payroll"
    sub_category varchar(100), -- optional finer granularity
    limit_minor bigint NOT NULL,
    -- Soft vs hard limits
    warn_threshold_pct integer NOT NULL DEFAULT 80, -- percentage (80 = 80%)
    block_threshold_pct integer NOT NULL DEFAULT 100,
    -- Spend tracking (denormalized for quick checks)
    spent_minor bigint NOT NULL DEFAULT 0,
    committed_minor bigint NOT NULL DEFAULT 0, -- reservations/pending approvals
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Spend limits - granular limits per entity (branch, department, employee)
-- Can be used standalone or linked to a budget
CREATE TABLE spend_limits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entity_type budget_scope NOT NULL, -- BRANCH, DEPARTMENT, EMPLOYEE
    entity_id uuid NOT NULL, -- branch_id, department_id, or user_id
    category varchar(100), -- optional: limit per category
    sub_category varchar(100), -- optional finer granularity
    period budget_period NOT NULL DEFAULT 'MONTHLY',
    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,
    limit_minor bigint NOT NULL,
    action spend_limit_action NOT NULL DEFAULT 'WARN', -- WARN | BLOCK | REQUIRE_APPROVAL
    -- Spend tracking
    spent_minor bigint NOT NULL DEFAULT 0,
    committed_minor bigint NOT NULL DEFAULT 0,
    -- Alerts sent flags (to avoid spam)
    alert_80_sent boolean NOT NULL DEFAULT false,
    alert_90_sent boolean NOT NULL DEFAULT false,
    alert_100_sent boolean NOT NULL DEFAULT false,
    created_by_id uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Petty cash wallets - child wallets with daily/monthly limits
CREATE TABLE petty_cash_wallets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    parent_wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    -- The child wallet itself (links to wallets table)
    wallet_id uuid NOT NULL UNIQUE REFERENCES wallets(id) ON DELETE CASCADE,
    -- Employee who owns/operates this petty cash wallet
    employee_id uuid NOT NULL REFERENCES users(id),
    -- Optional: branch/department association
    branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
    department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
    -- Limits
    daily_limit_minor bigint NOT NULL,
    monthly_limit_minor bigint NOT NULL,
    -- Spend tracking (current period)
    daily_spent_minor bigint NOT NULL DEFAULT 0,
    monthly_spent_minor bigint NOT NULL DEFAULT 0,
    daily_committed_minor bigint NOT NULL DEFAULT 0,
    monthly_committed_minor bigint NOT NULL DEFAULT 0,
    -- Period tracking
    daily_period_start timestamptz NOT NULL DEFAULT now(),
    monthly_period_start timestamptz NOT NULL DEFAULT now(),
    -- Approval: transactions over threshold need approval
    approval_threshold_minor bigint NOT NULL DEFAULT 0, -- 0 = no auto-approval needed
    approval_policy_id uuid REFERENCES approval_policies(id) ON DELETE SET NULL,
    -- Status
    status varchar(30) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | FROZEN | CLOSED
    -- Alerts sent
    daily_alert_80_sent boolean NOT NULL DEFAULT false,
    daily_alert_90_sent boolean NOT NULL DEFAULT false,
    monthly_alert_80_sent boolean NOT NULL DEFAULT false,
    monthly_alert_90_sent boolean NOT NULL DEFAULT false,
    created_by_id uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Budget spend tracking - audit trail of spend against budgets
CREATE TABLE budget_spend_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    budget_id uuid REFERENCES budgets(id) ON DELETE SET NULL,
    budget_item_id uuid REFERENCES budget_items(id) ON DELETE SET NULL,
    spend_limit_id uuid REFERENCES spend_limits(id) ON DELETE SET NULL,
    petty_cash_wallet_id uuid REFERENCES petty_cash_wallets(id) ON DELETE SET NULL,
    payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
    event_type varchar(30) NOT NULL, -- SPENT | RESERVED | RELEASED | ADJUSTED
    category varchar(100),
    sub_category varchar(100),
    amount_minor bigint NOT NULL,
    balance_after_minor bigint NOT NULL,
    committed_after_minor bigint NOT NULL,
    note text,
    created_by_id uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS budgets_tenant_idx ON budgets (tenant_id);
CREATE INDEX IF NOT EXISTS budgets_scope_idx ON budgets (tenant_id, scope, scope_ref);
CREATE INDEX IF NOT EXISTS budgets_period_idx ON budgets (tenant_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS budgets_status_idx ON budgets (tenant_id, status);

CREATE INDEX IF NOT EXISTS budget_items_budget_idx ON budget_items (budget_id);
CREATE UNIQUE INDEX IF NOT EXISTS budget_items_budget_cat_uidx ON budget_items (budget_id, category, sub_category);

CREATE INDEX IF NOT EXISTS spend_limits_tenant_idx ON spend_limits (tenant_id);
CREATE INDEX IF NOT EXISTS spend_limits_entity_idx ON spend_limits (tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS spend_limits_period_idx ON spend_limits (tenant_id, period_start, period_end);
CREATE UNIQUE INDEX IF NOT EXISTS spend_limits_entity_cat_uidx ON spend_limits (tenant_id, entity_type, entity_id, category, sub_category, period_start);

CREATE INDEX IF NOT EXISTS petty_cash_wallets_tenant_idx ON petty_cash_wallets (tenant_id);
CREATE INDEX IF NOT EXISTS petty_cash_wallets_parent_idx ON petty_cash_wallets (parent_wallet_id);
CREATE INDEX IF NOT EXISTS petty_cash_wallets_employee_idx ON petty_cash_wallets (employee_id);
CREATE INDEX IF NOT EXISTS petty_cash_wallets_branch_idx ON petty_cash_wallets (branch_id);

CREATE INDEX IF NOT EXISTS budget_spend_events_tenant_idx ON budget_spend_events (tenant_id);
CREATE INDEX IF NOT EXISTS budget_spend_events_budget_idx ON budget_spend_events (budget_id);
CREATE INDEX IF NOT EXISTS budget_spend_events_payment_idx ON budget_spend_events (payment_id);
CREATE INDEX IF NOT EXISTS budget_spend_events_petty_idx ON budget_spend_events (petty_cash_wallet_id);
CREATE INDEX IF NOT EXISTS budget_spend_events_created_idx ON budget_spend_events (created_at);