-- Support system tables
CREATE TABLE IF NOT EXISTS "support_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid NOT NULL UNIQUE,
	"display_name" varchar(200) NOT NULL,
	"email" varchar(254) NOT NULL,
	"phone" varchar(20),
	"avatar_url" varchar(500),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_platform" boolean DEFAULT false NOT NULL,
	"max_concurrent_chats" integer DEFAULT 3 NOT NULL,
	"current_chats" integer DEFAULT 0 NOT NULL,
	"skills" varchar(60)[] DEFAULT '{}'::varchar[],
	"working_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "support_chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid NOT NULL,
	"agent_id" uuid,
	"status" varchar(20) DEFAULT 'WAITING' NOT NULL,
	"subject" varchar(300),
	"priority" varchar(20) DEFAULT 'NORMAL' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "support_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_is_agent" boolean DEFAULT false NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "callback_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"email" varchar(254),
	"preferred_time" timestamp with time zone NOT NULL,
	"timezone" varchar(50) DEFAULT 'Africa/Nairobi' NOT NULL,
	"reason" text,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"assigned_agent_id" uuid,
	"scheduled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Foreign keys
ALTER TABLE "support_agents" ADD CONSTRAINT "support_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "support_chat_sessions" ADD CONSTRAINT "support_chat_sessions_agent_id_support_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."support_agents"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "support_chat_messages" ADD CONSTRAINT "support_chat_messages_session_id_support_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."support_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "callback_requests" ADD CONSTRAINT "callback_requests_assigned_agent_id_support_agents_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."support_agents"("id") ON DELETE set null ON UPDATE no action;

-- Indexes
CREATE INDEX IF NOT EXISTS "support_agents_tenant_idx" ON "support_agents" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "support_agents_active_idx" ON "support_agents" USING btree ("is_active");
CREATE INDEX IF NOT EXISTS "support_chat_messages_session_idx" ON "support_chat_messages" USING btree ("session_id");
CREATE INDEX IF NOT EXISTS "support_chat_sessions_tenant_idx" ON "support_chat_sessions" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "support_chat_sessions_user_idx" ON "support_chat_sessions" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "support_chat_sessions_agent_idx" ON "support_chat_sessions" USING btree ("agent_id");
CREATE INDEX IF NOT EXISTS "support_chat_sessions_status_idx" ON "support_chat_sessions" USING btree ("status");
CREATE INDEX IF NOT EXISTS "callback_requests_tenant_idx" ON "callback_requests" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "callback_requests_user_idx" ON "callback_requests" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "callback_requests_status_idx" ON "callback_requests" USING btree ("status");
CREATE INDEX IF NOT EXISTS "callback_requests_preferred_time_idx" ON "callback_requests" USING btree ("preferred_time");
