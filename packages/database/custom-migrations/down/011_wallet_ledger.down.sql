-- ============================================================
-- Z-float down migration: 011_wallet_ledger.down.sql
-- Rollback: Drop wallet_ledger_entries table and triggers
-- ============================================================

DROP INDEX IF EXISTS wallet_ledger_denied_idx;
DROP INDEX IF EXISTS wallet_ledger_ref_idx;
DROP INDEX IF EXISTS wallet_ledger_type_idx;
DROP INDEX IF EXISTS wallet_ledger_wallet_created_idx;

DROP TRIGGER IF EXISTS trg_wallet_ledger_entry_valid ON wallet_ledger_entries;
DROP TRIGGER IF EXISTS trg_wallet_ledger_no_update ON wallet_ledger_entries;

DROP FUNCTION IF EXISTS zf_assert_wallet_ledger_entry();
DROP FUNCTION IF EXISTS zf_block_wallet_ledger_mutation();

DROP TABLE IF EXISTS wallet_ledger_entries;