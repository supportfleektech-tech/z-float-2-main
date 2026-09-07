-- Report scheduling: recurring exports (monthly/weekly) with artifact retention.
-- Scheduled runs insert a normal reports row (schedule_id set) and are picked
-- up by the worker's reports.schedule dispatch; the worker also purges
-- artifacts older than the schedule's retention window from storage.

CREATE TABLE IF NOT EXISTS "report_schedules" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "report_type" varchar(40) NOT NULL DEFAULT 'transactions',
  "frequency" varchar(20) NOT NULL DEFAULT 'monthly',
  "retention_days" integer NOT NULL DEFAULT 90,
  "next_run_at" timestamptz NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_by_id" uuid REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "report_schedules_due_idx" ON "report_schedules" ("active", "next_run_at");
CREATE INDEX IF NOT EXISTS "report_schedules_tenant_idx" ON "report_schedules" ("tenant_id");

ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "schedule_id" uuid REFERENCES "report_schedules"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "reports_schedule_idx" ON "reports" ("schedule_id");
