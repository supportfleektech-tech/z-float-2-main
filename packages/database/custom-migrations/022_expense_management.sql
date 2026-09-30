-- 022_expense_management.sql
-- Add expense categories, ledgers (groups), and receipt file references.

CREATE TABLE IF NOT EXISTS expense_ledgers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(120) NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS expense_ledgers_tenant_name_uidx ON expense_ledgers (tenant_id, name);

ALTER TABLE charges ADD COLUMN IF NOT EXISTS category varchar(80) NOT NULL DEFAULT 'General';
ALTER TABLE charges ADD COLUMN IF NOT EXISTS ledger_id uuid REFERENCES expense_ledgers(id);
ALTER TABLE charges ADD COLUMN IF NOT EXISTS receipt_file_id uuid REFERENCES file_objects(id);
