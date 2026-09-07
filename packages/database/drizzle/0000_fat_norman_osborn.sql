CREATE TABLE IF NOT EXISTS "admin_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"tenant_id" uuid,
	"change_type" varchar(60) NOT NULL,
	"entity" varchar(60) NOT NULL,
	"entity_id" varchar(100),
	"diff" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "airtime_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_code" varchar(60) NOT NULL,
	"network" varchar(40) NOT NULL,
	"product_code" varchar(60) NOT NULL,
	"name" varchar(200) NOT NULL,
	"type" varchar(20) NOT NULL,
	"denomination_minor" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"decision" varchar(20) NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" varchar(200) NOT NULL,
	"description" text,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"rules_snapshot" jsonb NOT NULL,
	"change_comment" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid,
	"batch_id" uuid,
	"policy_id" uuid,
	"policy_snapshot" jsonb,
	"status" varchar(30) DEFAULT 'PENDING' NOT NULL,
	"mode" varchar(20) DEFAULT 'SEQUENTIAL' NOT NULL,
	"required_approvals" integer DEFAULT 1 NOT NULL,
	"current_level" integer DEFAULT 1 NOT NULL,
	"due_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"mode" varchar(20) NOT NULL,
	"roles" varchar(60)[] NOT NULL,
	"min_approvers" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor_id" uuid,
	"actor_role" varchar(60),
	"action" varchar(120) NOT NULL,
	"resource_type" varchar(60) NOT NULL,
	"resource_id" varchar(100),
	"before" jsonb,
	"after" jsonb,
	"ip" varchar(45),
	"user_agent" text,
	"request_id" varchar(64),
	"correlation_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ledger_account_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"balance_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "beneficiaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" varchar(30) DEFAULT 'person' NOT NULL,
	"name" varchar(200) NOT NULL,
	"phone" varchar(20),
	"email" varchar(254),
	"bank_account_name" varchar(200),
	"bank_account_number" varchar(40),
	"bank_code" varchar(20),
	"till_number" varchar(12),
	"paybill_number" varchar(12),
	"paybill_account" varchar(40),
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"risk_flags" varchar(40)[] DEFAULT '{}'::varchar[],
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(60) NOT NULL,
	"name" varchar(200) NOT NULL,
	"category" varchar(80),
	"channel" varchar(20) NOT NULL,
	"account_number" varchar(40) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(30) NOT NULL,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"type" varchar(30) DEFAULT 'OPERATING' NOT NULL,
	"number" varchar(40),
	"bank_name" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid,
	"description" varchar(300) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chart_of_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"code" varchar(40) NOT NULL,
	"name" varchar(200) NOT NULL,
	"type" varchar(20) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"purpose" varchar(120) NOT NULL,
	"granted" boolean DEFAULT true NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now(),
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"type" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'REQUESTED' NOT NULL,
	"payload_ref" varchar(200),
	"requested_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" varchar(200) NOT NULL,
	"code" varchar(30) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"tenant_id" uuid,
	"percentage" integer DEFAULT 100 NOT NULL,
	"description" varchar(500),
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fee_calculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid,
	"rule_id" uuid,
	"amount_minor" bigint NOT NULL,
	"fee_minor" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"rule_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fee_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"product" varchar(40) NOT NULL,
	"channel" varchar(30) NOT NULL,
	"provider" varchar(60) NOT NULL,
	"flat_fee_minor" bigint DEFAULT 0 NOT NULL,
	"percent_bps" bigint DEFAULT 0 NOT NULL,
	"min_fee_minor" bigint DEFAULT 0 NOT NULL,
	"max_fee_minor" bigint DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"change_comment" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fee_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fee_rule_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_comment" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"ref" varchar(200) NOT NULL,
	"filename" varchar(260) NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"storage_driver" varchar(30) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"scan_status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"uploaded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "funding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"business_account_id" uuid,
	"amount_minor" bigint NOT NULL,
	"reference" varchar(120),
	"method" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope" varchar(60) NOT NULL,
	"key" varchar(128) NOT NULL,
	"status" varchar(20) DEFAULT 'IN_PROGRESS' NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" varchar(254) NOT NULL,
	"role_id" uuid NOT NULL,
	"branch_ids" uuid[] DEFAULT '{}'::uuid[],
	"token_hash" varchar(64) NOT NULL,
	"invited_by_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" varchar(40) NOT NULL,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"ledger_account_id" uuid NOT NULL,
	"debit_minor" bigint DEFAULT 0 NOT NULL,
	"credit_minor" bigint DEFAULT 0 NOT NULL,
	"memo" text,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference_type" varchar(60) NOT NULL,
	"reference_id" uuid NOT NULL,
	"description" text,
	"created_by_id" uuid,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(20) DEFAULT 'POSTED' NOT NULL,
	"reversal_of_journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kyb_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
	"business_type" varchar(60),
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewed_by_id" uuid,
	"review_notes" text,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kyc_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"id_type" varchar(40),
	"status" varchar(30) DEFAULT 'PENDING' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"chart_account_id" uuid,
	"kind" varchar(20) DEFAULT 'SYSTEM' NOT NULL,
	"wallet_id" uuid,
	"code" varchar(120) NOT NULL,
	"name" varchar(200) NOT NULL,
	"currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"posted_balance_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "login_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid,
	"event" varchar(40) NOT NULL,
	"ip" varchar(45),
	"user_agent" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mfa_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(20) DEFAULT 'TOTP' NOT NULL,
	"secret_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(80) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"subject" varchar(200),
	"body" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid,
	"channel" varchar(20) DEFAULT 'IN_APP' NOT NULL,
	"template_code" varchar(80),
	"title" varchar(200),
	"body" text,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'QUEUED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"aggregate_type" varchar(60) NOT NULL,
	"aggregate_id" varchar(100) NOT NULL,
	"tenant_id" uuid,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(200) NOT NULL,
	"title" varchar(300) NOT NULL,
	"content" text NOT NULL,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid,
	"tenant_id" uuid NOT NULL,
	"file_ref" varchar(200) NOT NULL,
	"filename" varchar(260) NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"scan_status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"uploaded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"provider_id" uuid,
	"provider_reference" varchar(200),
	"request_payload" jsonb,
	"response_payload" jsonb,
	"status" varchar(20) DEFAULT 'QUEUED' NOT NULL,
	"error_code" varchar(100),
	"error_message" text,
	"latency_ms" integer,
	"idempotency_key" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_batch_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"recipient_name" varchar(200) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reference" varchar(100),
	"category" varchar(100),
	"status" varchar(20) DEFAULT 'VALID' NOT NULL,
	"error_message" text,
	"payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"channel" varchar(30) NOT NULL,
	"currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"total_amount_minor" bigint DEFAULT 0 NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"valid_row_count" integer DEFAULT 0 NOT NULL,
	"error_row_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(30) DEFAULT 'UPLOADED' NOT NULL,
	"file_ref" varchar(200),
	"created_by_id" uuid,
	"idempotency_key" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product" varchar(40) NOT NULL,
	"channel" varchar(30) NOT NULL,
	"provider_id" uuid NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"conditions" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"beneficiary_id" uuid,
	"beneficiary_snapshot" jsonb,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"frequency" varchar(20) NOT NULL,
	"cron_expr" varchar(100),
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"channel" varchar(30) DEFAULT 'mpesa' NOT NULL,
	"category" varchar(100),
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"from_status" varchar(30),
	"to_status" varchar(30) NOT NULL,
	"reason" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_number" varchar(40) NOT NULL,
	"batch_id" uuid,
	"product" varchar(40) DEFAULT 'single_payment' NOT NULL,
	"channel" varchar(30) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"fee_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
	"source_wallet_id" uuid,
	"beneficiary_id" uuid,
	"beneficiary_snapshot" jsonb NOT NULL,
	"branch_id" uuid,
	"department_id" uuid,
	"category" varchar(100),
	"remark" text,
	"idempotency_key" varchar(128),
	"provider_id" uuid,
	"provider_reference" varchar(200),
	"provider_status" varchar(60),
	"risk_flags" varchar(40)[] DEFAULT '{}'::varchar[],
	"approval_required" boolean DEFAULT false NOT NULL,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"scheduled_for" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"success_at" timestamp with time zone,
	"failure_reason" text,
	"reversal_reason" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(120) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(200) NOT NULL,
	"title" varchar(300) NOT NULL,
	"excerpt" text,
	"body" text NOT NULL,
	"cover_ref" varchar(200),
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"author_user_id" uuid,
	"published_at" timestamp with time zone,
	"seo" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricing_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(50) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(60) NOT NULL,
	"name" varchar(200) NOT NULL,
	"provider_type" varchar(30) NOT NULL,
	"environment" varchar(20) DEFAULT 'sandbox' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"maintenance" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recon_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid,
	"payment_id" uuid,
	"kind" varchar(40) NOT NULL,
	"severity" varchar(20) DEFAULT 'MEDIUM' NOT NULL,
	"status" varchar(20) DEFAULT 'OPEN' NOT NULL,
	"resolution" text,
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recon_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid,
	"source" varchar(30) NOT NULL,
	"provider_reference" varchar(200) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"normalized" jsonb,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"payment_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recon_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"match_type" varchar(20) DEFAULT 'EXACT' NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recon_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_id" uuid,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"source" varchar(30) DEFAULT 'API_POLL' NOT NULL,
	"status" varchar(30) DEFAULT 'RUNNING' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"journal_id" uuid,
	"amount_minor" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(20) DEFAULT 'REQUESTED' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"scope" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid,
	"event_type" varchar(80) NOT NULL,
	"severity" varchar(20) DEFAULT 'INFO' NOT NULL,
	"details" jsonb,
	"ip" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid,
	"token_hash" varchar(64) NOT NULL,
	"ip" varchar(45),
	"user_agent" text,
	"device_name" varchar(200),
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now(),
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" varchar(20) DEFAULT 'GLOBAL' NOT NULL,
	"scope_ref" uuid,
	"key" varchar(120) NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"provider_id" uuid,
	"gross_minor" bigint DEFAULT 0 NOT NULL,
	"fees_minor" bigint DEFAULT 0 NOT NULL,
	"net_minor" bigint DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid,
	"subject" varchar(300) NOT NULL,
	"body" text NOT NULL,
	"status" varchar(30) DEFAULT 'OPEN' NOT NULL,
	"priority" varchar(20) DEFAULT 'NORMAL' NOT NULL,
	"assigned_to_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"status" varchar(30) DEFAULT 'PENDING' NOT NULL,
	"risk_tier" varchar(20) DEFAULT 'STANDARD' NOT NULL,
	"kyb_status" varchar(30) DEFAULT 'NOT_SUBMITTED' NOT NULL,
	"default_currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_is_admin" boolean DEFAULT false NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_ids" uuid[] DEFAULT '{}'::uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_tenant_id_pk" PRIMARY KEY("user_id","role_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"email" varchar(254) NOT NULL,
	"phone" varchar(20),
	"full_name" varchar(200) NOT NULL,
	"password_hash" text,
	"status" varchar(30) DEFAULT 'PENDING_INVITE' NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret_encrypted" text,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid,
	"file_ref" varchar(200) NOT NULL,
	"doc_type" varchar(60) NOT NULL,
	"status" varchar(30) DEFAULT 'PENDING' NOT NULL,
	"scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" varchar(20) DEFAULT 'HELD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" varchar(200) NOT NULL,
	"currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"available_minor" bigint DEFAULT 0 NOT NULL,
	"reserved_minor" bigint DEFAULT 0 NOT NULL,
	"status" varchar(30) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid,
	"tenant_id" uuid,
	"type" varchar(100) NOT NULL,
	"provider_event_id" varchar(200),
	"payload" jsonb NOT NULL,
	"signature" text,
	"headers" jsonb,
	"status" varchar(20) DEFAULT 'RECEIVED' NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_step_id_approval_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."approval_steps"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_policy_versions" ADD CONSTRAINT "approval_policy_versions_policy_id_approval_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."approval_policies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_batch_id_payment_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payment_batches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_policy_id_approval_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."approval_policies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_ledger_account_id_ledger_accounts_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_accounts" ADD CONSTRAINT "business_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "charges" ADD CONSTRAINT "charges_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "departments" ADD CONSTRAINT "departments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fee_calculations" ADD CONSTRAINT "fee_calculations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fee_calculations" ADD CONSTRAINT "fee_calculations_rule_id_fee_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."fee_rules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fee_versions" ADD CONSTRAINT "fee_versions_fee_rule_id_fee_rules_id_fk" FOREIGN KEY ("fee_rule_id") REFERENCES "public"."fee_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "funding_events" ADD CONSTRAINT "funding_events_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "funding_events" ADD CONSTRAINT "funding_events_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_ledger_account_id_ledger_accounts_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kyb_cases" ADD CONSTRAINT "kyb_cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_chart_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("chart_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_attachments" ADD CONSTRAINT "payment_attachments_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_batch_rows" ADD CONSTRAINT "payment_batch_rows_batch_id_payment_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payment_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_batch_rows" ADD CONSTRAINT "payment_batch_rows_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_batches" ADD CONSTRAINT "payment_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_routes" ADD CONSTRAINT "payment_routes_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_source_wallet_id_wallets_id_fk" FOREIGN KEY ("source_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recon_exceptions" ADD CONSTRAINT "recon_exceptions_item_id_recon_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."recon_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recon_exceptions" ADD CONSTRAINT "recon_exceptions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recon_items" ADD CONSTRAINT "recon_items_run_id_recon_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."recon_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recon_items" ADD CONSTRAINT "recon_items_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recon_matches" ADD CONSTRAINT "recon_matches_item_id_recon_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."recon_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recon_matches" ADD CONSTRAINT "recon_matches_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recon_runs" ADD CONSTRAINT "recon_runs_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reversals" ADD CONSTRAINT "reversals_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reversals" ADD CONSTRAINT "reversals_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settlements" ADD CONSTRAINT "settlements_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_case_id_kyb_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."kyb_cases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallet_reservations" ADD CONSTRAINT "wallet_reservations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallet_reservations" ADD CONSTRAINT "wallet_reservations_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallets" ADD CONSTRAINT "wallets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallets" ADD CONSTRAINT "wallets_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_actions_request_actor_uidx" ON "approval_actions" USING btree ("request_id","actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_actions_request_idx" ON "approval_actions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_policies_tenant_idx" ON "approval_policies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_tenant_status_idx" ON "approval_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_steps_request_idx" ON "approval_steps" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_tenant_idx" ON "audit_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_resource_idx" ON "audit_events" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "balance_snapshots_account_asof_idx" ON "balance_snapshots" USING btree ("ledger_account_id","as_of");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "beneficiaries_tenant_idx" ON "beneficiaries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "beneficiaries_phone_idx" ON "beneficiaries" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billers_code_uidx" ON "billers" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "branches_tenant_code_uidx" ON "branches" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "branches_tenant_idx" ON "branches" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chart_of_accounts_tenant_code_uidx" ON "chart_of_accounts" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_records_tenant_idx" ON "consent_records" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_requests_tenant_idx" ON "data_requests" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "departments_tenant_code_uidx" ON "departments" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_key_tenant_uidx" ON "feature_flags" USING btree ("key","tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fee_calculations_tenant_idx" ON "fee_calculations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fee_rules_tenant_idx" ON "fee_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "funding_events_tenant_idx" ON "funding_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_records_scope_key_uidx" ON "idempotency_records" USING btree ("tenant_id","scope","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_records_tenant_idx" ON "idempotency_records" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invitations_token_hash_uidx" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_entries_journal_idx" ON "journal_entries" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_entries_account_idx" ON "journal_entries" USING btree ("ledger_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journals_tenant_idx" ON "journals" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journals_ref_idx" ON "journals" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kyb_cases_tenant_idx" ON "kyb_cases" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_accounts_tenant_code_uidx" ON "ledger_accounts" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_accounts_wallet_uidx" ON "ledger_accounts" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_events_user_idx" ON "login_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_events_created_idx" ON "login_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_templates_code_uidx" ON "notification_templates" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_tenant_idx" ON "notifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pages_slug_uidx" ON "pages" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_attachments_payment_idx" ON "payment_attachments" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_attempts_payment_idx" ON "payment_attempts" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_batch_rows_batch_idx" ON "payment_batch_rows" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_batch_rows_row_uidx" ON "payment_batch_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_batches_tenant_idx" ON "payment_batches" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_routes_product_channel_provider_uidx" ON "payment_routes" USING btree ("product","channel","provider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_schedules_tenant_idx" ON "payment_schedules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_status_history_payment_idx" ON "payment_status_history" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_idem_key_uidx" ON "payments" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_number_uidx" ON "payments" USING btree ("payment_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_tenant_status_idx" ON "payments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_wallet_idx" ON "payments" USING btree ("source_wallet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_created_idx" ON "payments" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_code_uidx" ON "permissions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "posts_slug_uidx" ON "posts" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "providers_code_uidx" ON "providers" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recon_exceptions_tenant_status_idx" ON "recon_exceptions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recon_items_tenant_idx" ON "recon_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recon_items_provider_ref_idx" ON "recon_items" USING btree ("provider_reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reversals_tenant_idx" ON "reversals" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "roles_scope_name_uidx" ON "roles" USING btree ("scope","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_events_created_idx" ON "security_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_events_type_idx" ON "security_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_hash_uidx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "settings_scope_key_uidx" ON "settings" USING btree ("scope","scope_ref","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_tenant_idx" ON "support_tickets" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_uidx" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_roles_tenant_idx" ON "user_roles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_tenant_uidx" ON "users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_reservations_payment_uidx" ON "wallet_reservations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallets_tenant_idx" ON "wallets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_provider_event_uidx" ON "webhook_events" USING btree ("provider_id","provider_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_status_idx" ON "webhook_events" USING btree ("status");