-- 023_branches_extension.sql
-- Extend branches table with eTIMS branch ID, wallet linkage, approval policy, and default flag
-- Also add updated_at to wallets for consistency

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS etims_branch_id varchar(2),
  ADD COLUMN IF NOT EXISTS wallet_id uuid REFERENCES wallets(id),
  ADD COLUMN IF NOT EXISTS approval_policy_id uuid REFERENCES approval_policies(id),
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Only one default branch per tenant
CREATE UNIQUE INDEX IF NOT EXISTS branches_tenant_default_uidx
  ON branches (tenant_id)
  WHERE is_default = true;

-- Index for lookups by eTIMS branch ID
CREATE INDEX IF NOT EXISTS branches_tenant_etims_idx
  ON branches (tenant_id, etims_branch_id);

-- Index for wallet-branch lookup
CREATE INDEX IF NOT EXISTS wallets_branch_idx
  ON wallets (branch_id);

-- Update etims_devices to link to branches via etims_branch_id
-- (etims_devices.branch_id is varchar(2) matching branches.etims_branch_id)