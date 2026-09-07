-- Developer API keys (tenant-scoped). Full keys are shown once at creation;
-- only their SHA-256 hash is stored.

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(120) NOT NULL,
  key_prefix varchar(16) NOT NULL,
  key_hash varchar(64) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  last_used_at timestamptz,
  created_by_id uuid,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys(key_hash);
