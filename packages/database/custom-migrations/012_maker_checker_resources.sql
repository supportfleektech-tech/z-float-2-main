-- ============================================================
-- Z-float custom migrations: 012_maker_checker_resources.sql
-- Maker-checker (Batch: maker-checker hardening):
--  1. approval_requests can now target ANY sensitive resource
--     (beneficiary payee-book entries, reversals, privileged
--     role invites), not just payments/batches. The payment_id /
--     batch_id columns remain for payments (backward compatible).
--  2. invitations gain a role-approval workflow so granting
--     privileged business roles (APPROVER / FINANCE_MANAGER /
--     OWNER / ADMIN) requires an independent checker.
-- ============================================================

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS resource_type varchar(40);
ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS resource_id uuid;

CREATE INDEX IF NOT EXISTS approval_requests_resource_idx
  ON approval_requests (resource_type, resource_id)
  WHERE resource_type IS NOT NULL;

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS role_approval_status varchar(12) NOT NULL DEFAULT 'NONE';
-- NONE (no approval needed / auto) | PENDING | APPROVED | REJECTED

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS role_approved_by_id uuid;

CREATE INDEX IF NOT EXISTS invitations_role_approval_idx
  ON invitations (role_approval_status) WHERE role_approval_status = 'PENDING';
