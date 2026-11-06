-- Accounting Integration Tables (P2-5)
-- Creates tables for accounting connections, mappings, and sync logs

-- Function to update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Accounting connections (OAuth2 tokens per tenant per provider)
CREATE TABLE accounting_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL, -- quickbooks | xero | zoho | sage
    status VARCHAR(20) NOT NULL DEFAULT 'CONNECTING', -- CONNECTING | CONNECTED | DISCONNECTED | ERROR | EXPIRED
    access_token_encrypted TEXT, -- AES-256-GCM encrypted
    refresh_token_encrypted TEXT, -- AES-256-GCM encrypted
    token_expires_at TIMESTAMPTZ,
    realm_id VARCHAR(100), -- provider-specific company/realm ID
    company_name VARCHAR(200),
    scopes VARCHAR(500)[] DEFAULT '{}',
    last_synced_at TIMESTAMPTZ,
    last_sync_status VARCHAR(20),
    last_sync_error TEXT,
    oauth_state VARCHAR(128), -- temporary for OAuth flow
    pkce_verifier VARCHAR(128), -- temporary for PKCE
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX accounting_connections_tenant_provider_uidx ON accounting_connections(tenant_id, provider);
CREATE INDEX accounting_connections_tenant_idx ON accounting_connections(tenant_id);
CREATE INDEX accounting_connections_status_idx ON accounting_connections(status);

-- Accounting mappings (chart of accounts ↔ external accounts)
CREATE TABLE accounting_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES accounting_connections(id) ON DELETE CASCADE,
    chart_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
    ledger_account_id UUID REFERENCES ledger_accounts(id) ON DELETE SET NULL,
    external_account_id VARCHAR(200) NOT NULL,
    external_account_name VARCHAR(200) NOT NULL,
    external_account_code VARCHAR(100),
    external_account_type VARCHAR(50),
    direction VARCHAR(20) NOT NULL DEFAULT 'OUTBOUND', -- OUTBOUND | INBOUND | BIDIRECTIONAL
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX accounting_mappings_conn_external_uidx ON accounting_mappings(connection_id, external_account_id);
CREATE INDEX accounting_mappings_tenant_idx ON accounting_mappings(tenant_id);
CREATE INDEX accounting_mappings_chart_idx ON accounting_mappings(chart_account_id);
CREATE INDEX accounting_mappings_ledger_idx ON accounting_mappings(ledger_account_id);

-- Accounting sync log (audit trail of sync operations)
CREATE TABLE accounting_sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES accounting_connections(id) ON DELETE CASCADE,
    sync_type VARCHAR(20) NOT NULL, -- PAYMENT | INVOICE | ETIMS | JOURNAL_ENTRY | FULL
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | IN_PROGRESS | COMPLETED | FAILED | PARTIAL
    entity_id UUID, -- Z-float entity being synced
    entity_type VARCHAR(30), -- payment | invoice | journal | etc.
    provider_reference VARCHAR(200), -- provider's transaction reference
    external_id VARCHAR(200), -- provider's external ID (e.g., QuickBooks TxnId)
    records_synced INTEGER NOT NULL DEFAULT 0,
    records_failed INTEGER NOT NULL DEFAULT 0,
    errors JSONB DEFAULT '[]'::jsonb,
    request_payload JSONB,
    response_payload JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX accounting_sync_log_tenant_idx ON accounting_sync_log(tenant_id);
CREATE INDEX accounting_sync_log_connection_idx ON accounting_sync_log(connection_id);
CREATE INDEX accounting_sync_log_entity_idx ON accounting_sync_log(entity_type, entity_id);
CREATE INDEX accounting_sync_log_status_idx ON accounting_sync_log(status);
CREATE INDEX accounting_sync_log_created_idx ON accounting_sync_log(created_at);

-- Trigger to update updated_at on accounting_connections
CREATE TRIGGER update_accounting_connections_updated_at
    BEFORE UPDATE ON accounting_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update updated_at on accounting_mappings
CREATE TRIGGER update_accounting_mappings_updated_at
    BEFORE UPDATE ON accounting_mappings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();