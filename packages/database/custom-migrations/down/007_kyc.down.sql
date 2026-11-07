-- ============================================================
-- Z-float down migration: 007_kyc.down.sql
-- Rollback: Drop KYC/AML tables
-- ============================================================

DROP INDEX IF EXISTS kyc_cases_payment_idx;
DROP INDEX IF EXISTS kyc_cases_status_idx;
DROP INDEX IF EXISTS kyc_cases_tenant_idx;
DROP TABLE IF EXISTS kyc_cases;

DROP INDEX IF EXISTS kyc_screenings_payment_idx;
DROP INDEX IF EXISTS kyc_screenings_tenant_idx;
DROP TABLE IF EXISTS kyc_screenings;

DROP INDEX IF EXISTS kyc_documents_tenant_idx;
DROP TABLE IF EXISTS kyc_documents;

DROP INDEX IF EXISTS kyc_profiles_tenant_idx;
DROP TABLE IF EXISTS kyc_profiles;

DROP INDEX IF EXISTS aml_watchlists_name_idx;
DROP TABLE IF EXISTS aml_watchlists;