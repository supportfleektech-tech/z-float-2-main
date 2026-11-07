-- ============================================================
-- Z-float down migration: 019_identity_etims_collections.down.sql
-- Rollback: Remove identity, collections, and eTIMS tables
-- ============================================================

-- Drop role permissions added by this migration
DELETE FROM role_permissions WHERE permission_id IN (
  SELECT id FROM permissions WHERE code IN ('collections.manage', 'invoices.manage')
);
DELETE FROM permissions WHERE code IN ('collections.manage', 'invoices.manage');

-- Drop eTIMS triggers and functions
DROP TRIGGER IF EXISTS etims_documents_signed_immutable_trg ON etims_documents;
DROP FUNCTION IF EXISTS etims_documents_signed_immutable();
DROP TRIGGER IF EXISTS etims_documents_no_delete_signed_trg ON etims_documents;
DROP FUNCTION IF EXISTS etims_documents_no_delete_signed();

-- Drop eTIMS indexes
DROP INDEX IF EXISTS etims_documents_device_invno_uidx;
DROP INDEX IF EXISTS etims_documents_collection_idx;
DROP INDEX IF EXISTS etims_documents_tenant_status_idx;
DROP INDEX IF EXISTS etims_documents_tenant_created_idx;
DROP INDEX IF EXISTS etims_documents_public_token_uidx;
DROP INDEX IF EXISTS etims_documents_tenant_number_uidx;

-- Drop eTIMS tables
DROP TABLE IF EXISTS etims_documents;
DROP INDEX IF EXISTS etims_devices_tenant_branch_uidx;
DROP TABLE IF EXISTS etims_devices;

-- Drop collections indexes
DROP INDEX IF EXISTS collections_channel_receipt_uidx;
DROP INDEX IF EXISTS collections_invoice_idx;
DROP INDEX IF EXISTS collections_provider_ref_idx;
DROP INDEX IF EXISTS collections_tenant_status_idx;
DROP INDEX IF EXISTS collections_tenant_created_idx;
DROP INDEX IF EXISTS collections_idem_uidx;
DROP INDEX IF EXISTS collections_number_uidx;

-- Drop collections table
DROP TABLE IF EXISTS collections;

-- Drop customers indexes
DROP INDEX IF EXISTS customers_tenant_idno_idx;
DROP INDEX IF EXISTS customers_tenant_kra_idx;
DROP INDEX IF EXISTS customers_tenant_phone_idx;
DROP INDEX IF EXISTS customers_tenant_idx;

-- Drop customers table
DROP TABLE IF EXISTS customers;

-- Remove identity columns from beneficiaries, users, tenants
ALTER TABLE beneficiaries DROP COLUMN IF EXISTS id_type;
ALTER TABLE beneficiaries DROP COLUMN IF EXISTS id_number;
ALTER TABLE beneficiaries DROP COLUMN IF EXISTS kra_pin;
DROP INDEX IF EXISTS beneficiaries_tenant_kra_idx;
DROP INDEX IF EXISTS beneficiaries_tenant_idno_idx;

ALTER TABLE users DROP COLUMN IF EXISTS id_type;
ALTER TABLE users DROP COLUMN IF EXISTS id_number;
ALTER TABLE users DROP COLUMN IF EXISTS kra_pin;

ALTER TABLE tenants DROP COLUMN IF EXISTS kra_pin;
ALTER TABLE tenants DROP COLUMN IF EXISTS collection_account_ref;
DROP INDEX IF EXISTS tenants_collection_ref_uidx;