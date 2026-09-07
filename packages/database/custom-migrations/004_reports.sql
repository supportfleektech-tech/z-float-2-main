-- Reports: async CSV export jobs (reports.generate worker queue).
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_type varchar(40) NOT NULL DEFAULT 'transactions', -- transactions|fees
  format varchar(10) NOT NULL DEFAULT 'csv',
  status varchar(20) NOT NULL DEFAULT 'REQUESTED', -- REQUESTED|GENERATED|FAILED
  payload_ref varchar(400),
  row_count integer NOT NULL DEFAULT 0,
  requested_by_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS reports_tenant_idx ON reports(tenant_id);
