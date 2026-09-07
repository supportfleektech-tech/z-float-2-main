-- Batch product (payroll vs bulk payments vs airtime) — added after initial release.
ALTER TABLE payment_batches
  ADD COLUMN IF NOT EXISTS product varchar(30) NOT NULL DEFAULT 'bulk_payment';

-- Reconcile: index lookup by provider reference (reconciliation engine hot path).
CREATE INDEX IF NOT EXISTS payments_provider_reference_idx ON payments (provider_reference) WHERE provider_reference IS NOT NULL;
