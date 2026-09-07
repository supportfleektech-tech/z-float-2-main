-- ============================================================
-- Z-float custom migrations: 001_ledger_integrity.sql
-- Data-integrity rules that cannot be expressed as plain DDL.
-- ============================================================

-- ------------------------------------------------------------------
-- 1. Journal balance enforcement (deferred constraint trigger)
--    Every journal must have sum(debit) == sum(credit).
--    Deferred so multi-row postings are checked after the statement
--    (and after commit when set CONSTRAINTS ... DEFERRED).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zf_assert_journal_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  dr bigint;
  cr bigint;
BEGIN
  SELECT COALESCE(SUM(debit_minor), 0), COALESCE(SUM(credit_minor), 0)
    INTO dr, cr
    FROM journal_entries
   WHERE journal_id = NEW.journal_id;
  IF dr <> cr THEN
    RAISE EXCEPTION 'Journal % is unbalanced: debits=% credits=%', NEW.journal_id, dr, cr
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION zf_assert_journal_entry_valid()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- An entry must not be zero and must be purely debit or credit.
  IF NEW.debit_minor < 0 OR NEW.credit_minor < 0 THEN
    RAISE EXCEPTION 'Journal entry % has negative amounts', NEW.id
      USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.debit_minor = 0 AND NEW.credit_minor = 0)
     OR (NEW.debit_minor > 0 AND NEW.credit_minor > 0) THEN
    RAISE EXCEPTION 'Journal entry % must be purely debit or purely credit', NEW.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_entry_valid ON journal_entries;
CREATE TRIGGER trg_journal_entry_valid
  BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION zf_assert_journal_entry_valid();

DROP TRIGGER IF EXISTS trg_journal_balanced ON journal_entries;
CREATE CONSTRAINT TRIGGER trg_journal_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION zf_assert_journal_balanced();

-- ------------------------------------------------------------------
-- 2. Money columns must never be negative for balances (guard rails).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zf_assert_non_negative_minor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.available_minor < 0 OR NEW.reserved_minor < 0 THEN
    RAISE EXCEPTION 'Wallet % balance went negative (available=%, reserved=%)',
      NEW.id, NEW.available_minor, NEW.reserved_minor
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_non_negative ON wallets;
CREATE TRIGGER trg_wallet_non_negative
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION zf_assert_non_negative_minor();

-- ------------------------------------------------------------------
-- 3. Ledger account balance must match wallet balance for wallet-kind
--    ledger accounts (consistency guard on journal posting).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zf_sync_ledger_account_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE ledger_accounts la
     SET posted_balance_minor = la.posted_balance_minor
       + (NEW.debit_minor - NEW.credit_minor)
   WHERE la.id = NEW.ledger_account_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_account_balance ON journal_entries;
CREATE TRIGGER trg_ledger_account_balance
  AFTER INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION zf_sync_ledger_account_balance();

-- ------------------------------------------------------------------
-- 4. Audit & ledger tables are immutable: no UPDATE/DELETE allowed.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zf_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only and cannot be mutated', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;

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
    EXECUTE format('CREATE TRIGGER trg_no_update_%s BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION zf_block_mutation()', t, t);
  END LOOP;
END $$;

-- ------------------------------------------------------------------
-- 5. Index support for the approval inbox and reconciliation queues.
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS approval_requests_actor_pending_idx
  ON approval_requests (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS recon_exceptions_open_idx
  ON recon_exceptions (tenant_id, status) WHERE status IN ('OPEN','INVESTIGATING','ESCALATED');

CREATE INDEX IF NOT EXISTS payments_batch_idx ON payments (batch_id) WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS outbox_publish_idx ON outbox_events (published_at) WHERE published_at IS NULL;
