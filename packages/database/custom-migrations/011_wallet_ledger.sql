-- ============================================================
-- Z-float custom migrations: 011_wallet_ledger.sql
-- Per-wallet reservation ledger (C-3): append-only audit trail of
-- reserved-vs-settled movements INCLUDING denied reservation
-- (double-spend) attempts. Balance-after columns let the ledger
-- be replayed to prove wallet balances.
-- ============================================================

-- The table itself (kept here so fresh databases provision it through the
-- custom-migration runner without a drizzle-kit pass; schema/index.ts keeps
-- the drizzle definition in sync for type generation).
CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  entry_type varchar(24) NOT NULL,
  ref_type varchar(30),
  ref_id uuid,
  amount_minor bigint NOT NULL,
  delta_available_minor bigint NOT NULL,
  delta_reserved_minor bigint NOT NULL,
  available_after_minor bigint NOT NULL,
  reserved_after_minor bigint NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_ledger_wallet_created_idx
  ON wallet_ledger_entries (wallet_id, created_at);
CREATE INDEX IF NOT EXISTS wallet_ledger_type_idx
  ON wallet_ledger_entries (entry_type, wallet_id);
CREATE INDEX IF NOT EXISTS wallet_ledger_ref_idx
  ON wallet_ledger_entries (ref_type, ref_id);

-- ------------------------------------------------------------------
-- 1. Append-only: wallet_ledger_entries can never be updated/deleted.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zf_block_wallet_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'wallet_ledger_entries is append-only and cannot be mutated'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_ledger_no_update ON wallet_ledger_entries;
CREATE TRIGGER trg_wallet_ledger_no_update
  BEFORE UPDATE OR DELETE ON wallet_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION zf_block_wallet_ledger_mutation();

-- ------------------------------------------------------------------
-- 2. Deltas must be consistent with the operation type and the
--    balance-after columns must be the wallet state at write time.
--    (Guard rails — the application writes them; this catches bugs.)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zf_assert_wallet_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_av bigint;
  expected_rs bigint;
BEGIN
  IF NEW.amount_minor < 0 OR NEW.delta_available_minor IS NULL OR NEW.delta_reserved_minor IS NULL THEN
    RAISE EXCEPTION 'wallet_ledger_entries row % has negative or null amounts', NEW.id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT available_minor, reserved_minor INTO expected_av, expected_rs
    FROM wallets WHERE id = NEW.wallet_id;

  IF expected_av IS NULL THEN
    RAISE EXCEPTION 'wallet_ledger_entries row % references unknown wallet %', NEW.id, NEW.wallet_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Balance-after must equal the actual wallet state.
  IF NEW.available_after_minor <> expected_av OR NEW.reserved_after_minor <> expected_rs THEN
    RAISE EXCEPTION 'wallet_ledger_entries row % balance-after (av=%, rs=%) != wallet state (av=%, rs=%)',
      NEW.id, NEW.available_after_minor, NEW.reserved_after_minor, expected_av, expected_rs
      USING ERRCODE = 'P0001';
  END IF;

  -- Delta semantics per operation type.
  IF NEW.entry_type = 'FUND' THEN
    IF NEW.delta_available_minor <> NEW.amount_minor OR NEW.delta_reserved_minor <> 0 THEN
      RAISE EXCEPTION 'wallet_ledger_entries FUND row % has wrong deltas', NEW.id USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.entry_type = 'RESERVE' THEN
    IF NEW.delta_available_minor <> -NEW.amount_minor OR NEW.delta_reserved_minor <> NEW.amount_minor THEN
      RAISE EXCEPTION 'wallet_ledger_entries RESERVE row % has wrong deltas', NEW.id USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.entry_type = 'RELEASE' THEN
    IF NEW.delta_available_minor <> NEW.amount_minor OR NEW.delta_reserved_minor <> -NEW.amount_minor THEN
      RAISE EXCEPTION 'wallet_ledger_entries RELEASE row % has wrong deltas', NEW.id USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.entry_type = 'APPLY' THEN
    IF NEW.delta_available_minor <> 0 OR NEW.delta_reserved_minor <> -NEW.amount_minor THEN
      RAISE EXCEPTION 'wallet_ledger_entries APPLY row % has wrong deltas', NEW.id USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.entry_type = 'RESERVE_DENIED' THEN
    IF NEW.delta_available_minor <> 0 OR NEW.delta_reserved_minor <> 0 THEN
      RAISE EXCEPTION 'wallet_ledger_entries RESERVE_DENIED row % must have zero deltas', NEW.id USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'wallet_ledger_entries row % has unknown entry_type %', NEW.id, NEW.entry_type
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_ledger_entry_valid ON wallet_ledger_entries;
CREATE TRIGGER trg_wallet_ledger_entry_valid
  BEFORE INSERT ON wallet_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION zf_assert_wallet_ledger_entry();

-- ------------------------------------------------------------------
-- 3. Denied-attempt index for the double-spend audit view.
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS wallet_ledger_denied_idx
  ON wallet_ledger_entries (wallet_id, created_at DESC)
  WHERE entry_type = 'RESERVE_DENIED';
