-- 014_platform_config_approvals.sql
-- Maker-checker for platform-admin configuration changes (KNOWN_LIMITATIONS #14b).
-- Platform config change requests are ordinary approval_requests rows with
-- tenant_id = PLATFORM_TENANT_ID ("00000000-0000-0000-0000-000000000000"),
-- resource_type = 'platform_config'. These columns record the apply outcome
-- after the final APPROVE so admins/auditors can see whether the approved
-- change was successfully executed (or why it failed).

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS executed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_error TEXT;
