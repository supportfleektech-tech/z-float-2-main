-- Migration 026: Approval tokens and notification preferences for WhatsApp/SMS/USSD approval channels

-- Approval tokens for one-tap approval via WhatsApp/SMS/USSD
CREATE TABLE IF NOT EXISTS approval_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
    step_id UUID REFERENCES approval_steps(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('APPROVE', 'REJECT')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'USED', 'EXPIRED', 'REVOKED')),
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('WHATSAPP', 'SMS', 'USSD', 'EMAIL')),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS approval_tokens_request_idx ON approval_tokens(request_id);
CREATE INDEX IF NOT EXISTS approval_tokens_actor_idx ON approval_tokens(actor_id);
CREATE INDEX IF NOT EXISTS approval_tokens_hash_idx ON approval_tokens(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS approval_tokens_request_actor_decision_uidx ON approval_tokens(request_id, actor_id, decision);

-- Notification preferences per user/channel/event
CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP', 'USSD')),
    event_type VARCHAR(50) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notification_preferences_user_idx ON notification_preferences(user_id);
CREATE INDEX IF NOT EXISTS notification_preferences_tenant_idx ON notification_preferences(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_user_channel_event_uidx ON notification_preferences(user_id, channel, event_type);

-- Add trigger to update updated_at for notification_preferences
CREATE OR REPLACE FUNCTION update_notification_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notification_preferences_updated_at ON notification_preferences;
CREATE TRIGGER trigger_notification_preferences_updated_at
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW EXECUTE FUNCTION update_notification_preferences_updated_at();

-- Insert default notification preferences for existing users
-- IN_APP and SMS enabled by default for approval_requested events
INSERT INTO notification_preferences (user_id, tenant_id, channel, event_type, enabled, priority)
SELECT u.id, u.tenant_id, 'IN_APP', 'approval_requested', TRUE, 10
FROM users u
WHERE u.status = 'ACTIVE' AND u.tenant_id IS NOT NULL
ON CONFLICT (user_id, channel, event_type) DO NOTHING;

INSERT INTO notification_preferences (user_id, tenant_id, channel, event_type, enabled, priority)
SELECT u.id, u.tenant_id, 'SMS', 'approval_requested', TRUE, 20
FROM users u
WHERE u.status = 'ACTIVE' AND u.tenant_id IS NOT NULL AND u.phone IS NOT NULL
ON CONFLICT (user_id, channel, event_type) DO NOTHING;

INSERT INTO notification_preferences (user_id, tenant_id, channel, event_type, enabled, priority)
SELECT u.id, u.tenant_id, 'EMAIL', 'approval_requested', TRUE, 30
FROM users u
WHERE u.status = 'ACTIVE' AND u.tenant_id IS NOT NULL AND u.email IS NOT NULL
ON CONFLICT (user_id, channel, event_type) DO NOTHING;

-- WhatsApp and USSD disabled by default (users must opt-in)
INSERT INTO notification_preferences (user_id, tenant_id, channel, event_type, enabled, priority)
SELECT u.id, u.tenant_id, 'WHATSAPP', 'approval_requested', FALSE, 40
FROM users u
WHERE u.status = 'ACTIVE' AND u.tenant_id IS NOT NULL AND u.phone IS NOT NULL
ON CONFLICT (user_id, channel, event_type) DO NOTHING;

INSERT INTO notification_preferences (user_id, tenant_id, channel, event_type, enabled, priority)
SELECT u.id, u.tenant_id, 'USSD', 'approval_requested', FALSE, 50
FROM users u
WHERE u.status = 'ACTIVE' AND u.tenant_id IS NOT NULL AND u.phone IS NOT NULL
ON CONFLICT (user_id, channel, event_type) DO NOTHING;