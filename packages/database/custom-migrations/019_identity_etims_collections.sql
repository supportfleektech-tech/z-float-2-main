-- 019_identity_etims_collections.sql
--  1) Identity: ID document + KRA PIN on payees, staff and tenants so people
--     can be identified by more than a (recyclable, SIM-swappable) phone.
--  2) Collections: inbound money (M-Pesa STK push, C2B paybill/till,
--     payment links, bank) + a customers (payer) book.
--  3) KRA eTIMS: OSCU/VSCU devices and fiscal documents (tax invoices,
--     receipts, credit notes) with signed-field immutability.

-- ---------- 1) identity ----------
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS id_type varchar(20);
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS id_number varchar(30);
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS kra_pin varchar(11);
CREATE INDEX IF NOT EXISTS beneficiaries_tenant_kra_idx ON beneficiaries (tenant_id, kra_pin);
CREATE INDEX IF NOT EXISTS beneficiaries_tenant_idno_idx ON beneficiaries (tenant_id, id_number);

ALTER TABLE users ADD COLUMN IF NOT EXISTS id_type varchar(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_number varchar(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS kra_pin varchar(11);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kra_pin varchar(11);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS collection_account_ref varchar(20);
CREATE UNIQUE INDEX IF NOT EXISTS tenants_collection_ref_uidx ON tenants (collection_account_ref) WHERE collection_account_ref IS NOT NULL;

-- KRA PIN shape guard at the database edge (app normalizes before insert).
DO $$ BEGIN
  ALTER TABLE beneficiaries ADD CONSTRAINT beneficiaries_kra_pin_chk CHECK (kra_pin IS NULL OR kra_pin ~ '^[AP][0-9]{9}[A-Z]$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_kra_pin_chk CHECK (kra_pin IS NULL OR kra_pin ~ '^[AP][0-9]{9}[A-Z]$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE tenants ADD CONSTRAINT tenants_kra_pin_chk CHECK (kra_pin IS NULL OR kra_pin ~ '^[AP][0-9]{9}[A-Z]$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- 2) customers + collections ----------
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type varchar(20) NOT NULL DEFAULT 'individual',
  name varchar(200) NOT NULL,
  phone varchar(20),
  email varchar(254),
  id_type varchar(20),
  id_number varchar(30),
  kra_pin varchar(11) CHECK (kra_pin IS NULL OR kra_pin ~ '^[AP][0-9]{9}[A-Z]$'),
  address text,
  notes text,
  created_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_tenant_idx ON customers (tenant_id);
CREATE INDEX IF NOT EXISTS customers_tenant_phone_idx ON customers (tenant_id, phone);
CREATE INDEX IF NOT EXISTS customers_tenant_kra_idx ON customers (tenant_id, kra_pin);
CREATE INDEX IF NOT EXISTS customers_tenant_idno_idx ON customers (tenant_id, id_number);

CREATE TABLE IF NOT EXISTS collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  collection_number varchar(40) NOT NULL,
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  channel varchar(30) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency varchar(3) NOT NULL DEFAULT 'KES',
  account_reference varchar(60),
  description text,
  customer_id uuid REFERENCES customers(id),
  payer_name varchar(200),
  payer_phone varchar(20),
  payer_id_type varchar(20),
  payer_id_number varchar(30),
  payer_kra_pin varchar(11),
  invoice_id uuid,
  receipt_id uuid,
  payment_link_id uuid,
  provider_code varchar(60),
  provider_reference varchar(120),
  receipt_number varchar(40),
  failure_reason text,
  idempotency_key varchar(128),
  raw_callback jsonb,
  requested_by_id uuid,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS collections_number_uidx ON collections (collection_number);
CREATE UNIQUE INDEX IF NOT EXISTS collections_idem_uidx ON collections (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS collections_tenant_created_idx ON collections (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS collections_tenant_status_idx ON collections (tenant_id, status);
CREATE INDEX IF NOT EXISTS collections_provider_ref_idx ON collections (provider_reference);
CREATE INDEX IF NOT EXISTS collections_invoice_idx ON collections (invoice_id);
-- A provider transaction (C2B TransID / M-Pesa receipt) can credit a wallet once.
CREATE UNIQUE INDEX IF NOT EXISTS collections_channel_receipt_uidx
  ON collections (channel, receipt_number) WHERE receipt_number IS NOT NULL;

-- ---------- 3) eTIMS ----------
CREATE TABLE IF NOT EXISTS etims_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kra_pin varchar(11) NOT NULL CHECK (kra_pin ~ '^[AP][0-9]{9}[A-Z]$'),
  branch_id varchar(2) NOT NULL DEFAULT '00',
  device_serial varchar(100) NOT NULL,
  driver varchar(20) NOT NULL DEFAULT 'sandbox',
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  cmc_key_encrypted text,
  sdc_id varchar(40),
  mrc_no varchar(40),
  taxpayer_name varchar(200),
  last_invoice_no integer NOT NULL DEFAULT 0,
  auto_receipt boolean NOT NULL DEFAULT true,
  default_tax_type varchar(1) NOT NULL DEFAULT 'B' CHECK (default_tax_type IN ('A','B','C','D','E')),
  last_error text,
  initialised_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS etims_devices_tenant_branch_uidx ON etims_devices (tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS etims_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id uuid REFERENCES etims_devices(id),
  doc_type varchar(20) NOT NULL CHECK (doc_type IN ('INVOICE','RECEIPT','CREDIT_NOTE','PAYMENT_RECEIPT')),
  number varchar(40) NOT NULL,
  invoice_no integer,
  original_document_id uuid,
  status varchar(20) NOT NULL DEFAULT 'DRAFT',
  payment_status varchar(20) NOT NULL DEFAULT 'UNPAID',
  customer_id uuid REFERENCES customers(id),
  customer_name varchar(200),
  customer_phone varchar(20),
  customer_email varchar(254),
  customer_kra_pin varchar(11),
  customer_id_type varchar(20),
  customer_id_number varchar(30),
  currency varchar(3) NOT NULL DEFAULT 'KES',
  lines jsonb NOT NULL,
  tax_summary jsonb NOT NULL,
  subtotal_minor bigint NOT NULL,
  tax_minor bigint NOT NULL,
  total_minor bigint NOT NULL,
  paid_minor bigint NOT NULL DEFAULT 0,
  payment_method varchar(20),
  due_at timestamptz,
  notes text,
  collection_id uuid,
  cu_invoice_no varchar(60),
  receipt_no integer,
  total_receipt_no integer,
  internal_data varchar(120),
  receipt_signature varchar(120),
  sdc_id varchar(40),
  mrc_no varchar(40),
  signed_at timestamptz,
  verification_url text,
  sandbox boolean NOT NULL DEFAULT true,
  submission_attempts integer NOT NULL DEFAULT 0,
  last_error text,
  request_payload jsonb,
  response_payload jsonb,
  public_token varchar(40),
  created_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS etims_documents_tenant_number_uidx ON etims_documents (tenant_id, number);
CREATE UNIQUE INDEX IF NOT EXISTS etims_documents_public_token_uidx ON etims_documents (public_token);
CREATE INDEX IF NOT EXISTS etims_documents_tenant_created_idx ON etims_documents (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS etims_documents_tenant_status_idx ON etims_documents (tenant_id, status);
CREATE INDEX IF NOT EXISTS etims_documents_collection_idx ON etims_documents (collection_id);
-- One KRA invoice number per device (sequence integrity).
CREATE UNIQUE INDEX IF NOT EXISTS etims_documents_device_invno_uidx
  ON etims_documents (device_id, invoice_no) WHERE invoice_no IS NOT NULL;

-- Signed fiscal documents are immutable: amounts, lines, parties and KRA
-- signature fields cannot change after SIGNED. Only payment progress and
-- operational metadata may be updated. Corrections go through credit notes.
CREATE OR REPLACE FUNCTION etims_documents_signed_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'SIGNED' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.lines::text IS DISTINCT FROM OLD.lines::text
       OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
       OR NEW.tax_minor IS DISTINCT FROM OLD.tax_minor
       OR NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
       OR NEW.customer_kra_pin IS DISTINCT FROM OLD.customer_kra_pin
       OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
       OR NEW.receipt_signature IS DISTINCT FROM OLD.receipt_signature
       OR NEW.internal_data IS DISTINCT FROM OLD.internal_data
       OR NEW.cu_invoice_no IS DISTINCT FROM OLD.cu_invoice_no
       OR NEW.invoice_no IS DISTINCT FROM OLD.invoice_no
       OR NEW.number IS DISTINCT FROM OLD.number THEN
      RAISE EXCEPTION 'etims document % is SIGNED and immutable — issue a credit note instead', OLD.number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS etims_documents_signed_immutable_trg ON etims_documents;
CREATE TRIGGER etims_documents_signed_immutable_trg
  BEFORE UPDATE ON etims_documents
  FOR EACH ROW EXECUTE FUNCTION etims_documents_signed_immutable();

CREATE OR REPLACE FUNCTION etims_documents_no_delete_signed() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'SIGNED' THEN
    RAISE EXCEPTION 'etims document % is SIGNED and cannot be deleted', OLD.number;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS etims_documents_no_delete_signed_trg ON etims_documents;
CREATE TRIGGER etims_documents_no_delete_signed_trg
  BEFORE DELETE ON etims_documents
  FOR EACH ROW EXECUTE FUNCTION etims_documents_no_delete_signed();

-- ---------- permissions for existing installs ----------
-- (fresh installs: the seed wires these; existing roles get them here)
INSERT INTO permissions (code, name) VALUES
  ('collections.manage', 'Receive payments (collections)'),
  ('invoices.manage', 'Issue eTIMS invoices & receipts')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('collections.manage', 'invoices.manage')
WHERE r.scope = 'BUSINESS' AND r.name IN ('OWNER', 'ADMIN', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'invoices.manage'
WHERE r.scope = 'BUSINESS' AND r.name = 'ACCOUNTANT'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'collections.manage'
WHERE r.scope = 'BUSINESS' AND r.name = 'MAKER'
ON CONFLICT DO NOTHING;
