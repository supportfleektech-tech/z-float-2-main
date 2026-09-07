-- 016_recon_exception_workflow.sql
-- Phase 3 (GAP-ANALYSIS): reconciliation exception resolution workflow.
-- Append-only activity history per recon exception (comments, resolve/reopen
-- transitions). The resolution state itself lives on recon_exceptions
-- (status/resolution/resolved_by_id/resolved_at — present since migration 005);
-- this table records WHO did WHAT WHEN so the workflow is auditable in-app.

CREATE TABLE IF NOT EXISTS recon_exception_activity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id  UUID NOT NULL REFERENCES recon_exceptions(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL,
  actor_id      UUID,
  action        VARCHAR(20) NOT NULL,  -- comment | resolve | reopen
  note          TEXT,
  from_status   VARCHAR(20),
  to_status     VARCHAR(20),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recon_exception_activity_exc_idx
  ON recon_exception_activity(exception_id, created_at);
CREATE INDEX IF NOT EXISTS recon_exception_activity_tenant_idx
  ON recon_exception_activity(tenant_id, created_at DESC);
