-- Tier-1 enhancements: MFA backup codes, payment links, outbound webhooks.
CREATE TABLE IF NOT EXISTS mfa_backup_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash varchar(64) NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mfa_backup_codes_user_idx ON mfa_backup_codes(user_id);

CREATE TABLE IF NOT EXISTS payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token varchar(40) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  description text,
  amount_minor bigint NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'KES',
  channel varchar(30) NOT NULL DEFAULT 'mpesa',
  status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  max_uses integer,
  use_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_by_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_links_tenant_idx ON payment_links(tenant_id);
CREATE INDEX IF NOT EXISTS payment_links_token_idx ON payment_links(token);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  url varchar(500) NOT NULL,
  secret_encrypted text NOT NULL,
  events jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  created_by_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_subscriptions_tenant_idx ON webhook_subscriptions(tenant_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  subscription_id uuid NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_type varchar(100) NOT NULL,
  payload jsonb NOT NULL,
  signature text,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  response_status integer,
  next_retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_tenant_idx ON webhook_deliveries(tenant_id);
CREATE INDEX IF NOT EXISTS webhook_deliveries_sub_idx ON webhook_deliveries(subscription_id);
