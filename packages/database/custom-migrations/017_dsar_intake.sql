-- 017_dsar_intake.sql — GAP closeout: data-subject self-service intake.
-- Public intake rows are anonymous (no tenant): platform admin identity-checks
-- the requester email BEFORE executing export/erasure via the admin endpoints.
ALTER TABLE data_requests ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS requester_email varchar(320);
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS requester_name varchar(200);
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS note text;
CREATE INDEX IF NOT EXISTS data_requests_status_idx ON data_requests (status);
CREATE INDEX IF NOT EXISTS data_requests_email_idx ON data_requests (requester_email);
