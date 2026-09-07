-- webhook_events carries OPERATIONAL state (RECEIVED → PROCESSED/FAILED/DUPLICATE)
-- as the gateway + worker pipeline progresses. Raw payload integrity is preserved
-- by the unique provider_event_id and signed storage; the append-only trigger is
-- therefore removed ONLY for this table. True audit/ledger tables (audit_events,
-- journals, journal_entries, payment_status_history, login_events, fee_versions,
-- approval_policy_versions, security_events) remain append-only.
DROP TRIGGER IF EXISTS trg_no_update_webhook_events ON webhook_events;

-- Clear any historical duplicates (keep the earliest row per provider event) so
-- the unique index can be created.
DELETE FROM webhook_events a
USING webhook_events b
WHERE a.id > b.id AND a.provider_event_id = b.provider_event_id;

-- Enforce single-row-per-provider-event so replay detection is a unique-index
-- violation even if two deliveries race the gateway.
DROP INDEX IF EXISTS webhook_events_provider_event_uidx;
CREATE UNIQUE INDEX webhook_events_provider_event_uidx ON webhook_events (provider_event_id);
