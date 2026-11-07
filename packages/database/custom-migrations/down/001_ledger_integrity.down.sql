-- ============================================================
-- Z-float down migration: 001_ledger_integrity.down.sql
-- Rollback: Remove ledger integrity triggers and functions
-- ============================================================

DROP TRIGGER IF EXISTS trg_journal_entry_valid ON journal_entries;
DROP TRIGGER IF EXISTS trg_journal_balanced ON journal_entries;
DROP FUNCTION IF EXISTS zf_assert_journal_balanced();
DROP FUNCTION IF EXISTS zf_assert_journal_entry_valid();

DROP TRIGGER IF EXISTS trg_wallet_non_negative ON wallets;
DROP FUNCTION IF EXISTS zf_assert_non_negative_minor();

DROP TRIGGER IF EXISTS trg_ledger_account_balance ON journal_entries;
DROP FUNCTION IF EXISTS zf_sync_ledger_account_balance();

-- Drop immutable table triggers
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_events', 'journal_entries', 'journals', 'payment_status_history',
    'login_events', 'fee_versions', 'approval_policy_versions',
    'security_events'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_no_update_%s ON %I', t, t);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS zf_block_mutation();

DROP INDEX IF EXISTS approval_requests_actor_pending_idx;
DROP INDEX IF EXISTS recon_exceptions_open_idx;
DROP INDEX IF EXISTS payments_batch_idx;
DROP INDEX IF EXISTS outbox_publish_idx;