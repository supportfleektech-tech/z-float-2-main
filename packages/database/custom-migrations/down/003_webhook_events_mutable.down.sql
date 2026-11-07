-- ============================================================
-- Z-float down migration: 003_webhook_events_mutable.down.sql
-- Rollback: Restore append-only trigger and original index
-- ============================================================

-- Drop unique index
DROP INDEX IF EXISTS webhook_events_provider_event_uidx;

-- Recreate non-unique index (original)
CREATE INDEX IF NOT EXISTS webhook_events_provider_event_uidx ON webhook_events (provider_event_id);

-- Recreate append-only trigger
CREATE OR REPLACE FUNCTION zf_no_update_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'table is append-only';
END;
$$;

CREATE TRIGGER trg_no_update_webhook_events
  BEFORE UPDATE ON webhook_events
  FOR EACH ROW EXECUTE FUNCTION zf_no_update_trigger();