-- ============================================================
-- Z-float down migration: 028_support_tables.down.sql
-- Rollback: Remove support system tables
-- ============================================================

DROP INDEX IF EXISTS callback_requests_preferred_time_idx;
DROP INDEX IF EXISTS callback_requests_status_idx;
DROP INDEX IF EXISTS callback_requests_user_idx;
DROP INDEX IF EXISTS callback_requests_tenant_idx;
DROP INDEX IF EXISTS support_chat_sessions_status_idx;
DROP INDEX IF EXISTS support_chat_sessions_agent_idx;
DROP INDEX IF EXISTS support_chat_sessions_user_idx;
DROP INDEX IF EXISTS support_chat_sessions_tenant_idx;
DROP INDEX IF EXISTS support_chat_messages_session_idx;
DROP INDEX IF EXISTS support_agents_active_idx;
DROP INDEX IF EXISTS support_agents_tenant_idx;

ALTER TABLE callback_requests DROP CONSTRAINT IF EXISTS callback_requests_assigned_agent_id_support_agents_id_fk;
ALTER TABLE support_chat_messages DROP CONSTRAINT IF EXISTS support_chat_messages_session_id_support_chat_sessions_id_fk;
ALTER TABLE support_chat_sessions DROP CONSTRAINT IF EXISTS support_chat_sessions_agent_id_support_agents_id_fk;
ALTER TABLE support_agents DROP CONSTRAINT IF EXISTS support_agents_user_id_users_id_fk;

DROP TABLE IF EXISTS callback_requests;
DROP TABLE IF EXISTS support_chat_messages;
DROP TABLE IF EXISTS support_chat_sessions;
DROP TABLE IF EXISTS support_agents;