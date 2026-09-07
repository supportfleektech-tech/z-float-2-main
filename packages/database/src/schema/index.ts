import { pgTable, uuid, text, timestamp, boolean, jsonb, bigint, integer, uniqueIndex, index, primaryKey, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Shared column helpers */
export const id = () => uuid("id").primaryKey().defaultRandom();
export const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
/**
 * NOTE: `$onUpdate` must return a Date, NOT a sql`...` fragment — drizzle 0.36.x
 * wraps the onUpdate result in sql.param() without unwrapping SQL fragments,
 * which crashes PgTimestamp.mapToDriverValue ("value.toISOString is not a function").
 */
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date());
/** Money in integer minor units (cents). bigint — never floats. */
export const minor = (name: string) => bigint(name, { mode: "bigint" });
export const tenantId = () => uuid("tenant_id");

/* ------------------------------------------------------------------ */
/* Identity & access                                                   */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: id(),
    tenantId: tenantId(),
    email: varchar("email", { length: 254 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    fullName: varchar("full_name", { length: 200 }).notNull(),
    passwordHash: text("password_hash"),
    status: varchar("status", { length: 30 }).notNull().default("PENDING_INVITE"), // ACTIVE | SUSPENDED | PENDING_INVITE | DISABLED
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecretEncrypted: text("mfa_secret_encrypted"),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdById: uuid("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_tenant_uidx").on(t.tenantId, t.email),
    index("users_email_idx").on(t.email),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tenantId: tenantId(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    ip: varchar("ip", { length: 45 }),
    userAgent: text("user_agent"),
    deviceName: varchar("device_name", { length: 200 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_hash_uidx").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const mfaFactors = pgTable("mfa_factors", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 20 }).notNull().default("TOTP"),
  secretEncrypted: text("secret_encrypted").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const roles = pgTable(
  "roles",
  {
    id: id(),
    tenantId: tenantId(),
    scope: varchar("scope", { length: 20 }).notNull(), // PLATFORM | BUSINESS
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("roles_scope_name_uidx").on(t.scope, t.name)],
);

export const permissions = pgTable(
  "permissions",
  {
    id: id(),
    code: varchar("code", { length: 120 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("permissions_code_uidx").on(t.code)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    tenantId: tenantId().notNull(),
    branchIds: uuid("branch_ids").array().default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId, t.tenantId] }), index("user_roles_tenant_idx").on(t.tenantId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    email: varchar("email", { length: 254 }).notNull(),
    roleId: uuid("role_id").notNull(),
    branchIds: uuid("branch_ids").array().default(sql`'{}'::uuid[]`),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    /** Raw token — demo-only convenience, never persisted in production. */
    rawToken: text("raw_token"),
    invitedById: uuid("invited_by_id"),
    /** Maker-checker for privileged role grants: NONE | PENDING | APPROVED | REJECTED. */
    roleApprovalStatus: varchar("role_approval_status", { length: 12 }).notNull().default("NONE"),
    roleApprovedById: uuid("role_approved_by_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invitations_token_hash_uidx").on(t.tokenHash)],
);

export const loginEvents = pgTable(
  "login_events",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id"),
    event: varchar("event", { length: 40 }).notNull(), // LOGIN_SUCCESS | LOGIN_FAILURE | MFA_CHALLENGE | LOGOUT | SESSION_REVOKED
    ip: varchar("ip", { length: 45 }),
    userAgent: text("user_agent"),
    details: jsonb("details"),
    createdAt: createdAt(),
  },
  (t) => [index("login_events_user_idx").on(t.userId), index("login_events_created_idx").on(t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Tenant / business                                                   */
/* ------------------------------------------------------------------ */

export const tenants = pgTable(
  "tenants",
  {
    id: id(),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("PENDING"), // PENDING | ACTIVE | SUSPENDED | CLOSED
    riskTier: varchar("risk_tier", { length: 20 }).notNull().default("STANDARD"),
    kybStatus: varchar("kyb_status", { length: 30 }).notNull().default("NOT_SUBMITTED"),
    defaultCurrency: varchar("default_currency", { length: 3 }).notNull().default("KES"),
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("tenants_slug_uidx").on(t.slug)],
);

export const branches = pgTable(
  "branches",
  {
    id: id(),
    tenantId: tenantId().notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    code: varchar("code", { length: 30 }).notNull(),
    address: text("address"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("branches_tenant_code_uidx").on(t.tenantId, t.code), index("branches_tenant_idx").on(t.tenantId)],
);

export const departments = pgTable(
  "departments",
  {
    id: id(),
    tenantId: tenantId().notNull().references(() => tenants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id),
    name: varchar("name", { length: 200 }).notNull(),
    code: varchar("code", { length: 30 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("departments_tenant_code_uidx").on(t.tenantId, t.code)],
);

export const businessAccounts = pgTable("business_accounts", {
  id: id(),
  tenantId: tenantId().notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  type: varchar("type", { length: 30 }).notNull().default("OPERATING"),
  number: varchar("number", { length: 40 }),
  bankName: varchar("bank_name", { length: 200 }),
  createdAt: createdAt(),
});

export const wallets = pgTable(
  "wallets",
  {
    id: id(),
    tenantId: tenantId().notNull().references(() => tenants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id),
    name: varchar("name", { length: 200 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("KES"),
    /** Spendable balance (minor units). Reserved amounts are excluded. */
    availableMinor: minor("available_minor").notNull().default(sql`0`),
    /** Amount held by in-flight reservations (minor units). */
    reservedMinor: minor("reserved_minor").notNull().default(sql`0`),
    status: varchar("status", { length: 30 }).notNull().default("ACTIVE"), // ACTIVE | FROZEN | CLOSED
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("wallets_tenant_idx").on(t.tenantId)],
);

export const beneficiaries = pgTable(
  "beneficiaries",
  {
    id: id(),
    tenantId: tenantId().notNull().references(() => tenants.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 30 }).notNull().default("person"), // person | supplier | employee | biller
    name: varchar("name", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 254 }),
    bankAccountName: varchar("bank_account_name", { length: 200 }),
    bankAccountNumber: varchar("bank_account_number", { length: 40 }),
    bankCode: varchar("bank_code", { length: 20 }),
    tillNumber: varchar("till_number", { length: 12 }),
    paybillNumber: varchar("paybill_number", { length: 12 }),
    paybillAccount: varchar("paybill_account", { length: 40 }),
    status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
    riskFlags: varchar("risk_flags", { length: 40 }).array().default(sql`'{}'::varchar[]`),
    notes: text("notes"),
    createdById: uuid("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("beneficiaries_tenant_idx").on(t.tenantId), index("beneficiaries_phone_idx").on(t.phone)],
);

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export const paymentStatuses = [
  "DRAFT",
  "VALIDATING",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "QUEUED",
  "PROCESSING",
  "PROVIDER_PENDING",
  "SUCCESS",
  "FAILED",
  "REVERSED",
  "CANCELLED",
] as const;

export const payments = pgTable(
  "payments",
  {
    id: id(),
    tenantId: tenantId().notNull().references(() => tenants.id, { onDelete: "cascade" }),
    paymentNumber: varchar("payment_number", { length: 40 }).notNull(),
    batchId: uuid("batch_id"),
    product: varchar("product", { length: 40 }).notNull().default("single_payment"),
    channel: varchar("channel", { length: 30 }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    feeMinor: minor("fee_minor").notNull().default(sql`0`),
    totalMinor: minor("total_minor").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("KES"),
    status: varchar("status", { length: 30 }).notNull().default("DRAFT"),
    sourceWalletId: uuid("source_wallet_id").references(() => wallets.id),
    beneficiaryId: uuid("beneficiary_id").references(() => beneficiaries.id),
    /** Snapshot of the destination at creation time (immutable). */
    beneficiarySnapshot: jsonb("beneficiary_snapshot").notNull(),
    branchId: uuid("branch_id").references(() => branches.id),
    departmentId: uuid("department_id").references(() => departments.id),
    category: varchar("category", { length: 100 }),
    remark: text("remark"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    providerId: uuid("provider_id").references(() => providers.id),
    providerReference: varchar("provider_reference", { length: 200 }),
    providerStatus: varchar("provider_status", { length: 60 }),
    riskFlags: varchar("risk_flags", { length: 40 }).array().default(sql`'{}'::varchar[]`),
    approvalRequired: boolean("approval_required").notNull().default(false),
    approvedById: uuid("approved_by_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    successAt: timestamp("success_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    reversalReason: text("reversal_reason"),
    createdById: uuid("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("payments_idem_key_uidx").on(t.tenantId, t.idempotencyKey),
    uniqueIndex("payments_number_uidx").on(t.paymentNumber),
    index("payments_tenant_status_idx").on(t.tenantId, t.status),
    index("payments_wallet_idx").on(t.sourceWalletId),
    index("payments_created_idx").on(t.createdAt),
  ],
);

export const paymentStatusHistory = pgTable(
  "payment_status_history",
  {
    id: id(),
    paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
    fromStatus: varchar("from_status", { length: 30 }),
    toStatus: varchar("to_status", { length: 30 }).notNull(),
    reason: text("reason"),
    actorId: uuid("actor_id"),
    createdAt: createdAt(),
  },
  (t) => [index("payment_status_history_payment_idx").on(t.paymentId)],
);

export const paymentBatches = pgTable(
  "payment_batches",
  {
    id: id(),
    tenantId: tenantId().notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    channel: varchar("channel", { length: 30 }).notNull(),
    product: varchar("product", { length: 30 }).notNull().default("bulk_payment"),
    currency: varchar("currency", { length: 3 }).notNull().default("KES"),
    totalAmountMinor: minor("total_amount_minor").notNull().default(sql`0`),
    rowCount: integer("row_count").notNull().default(0),
    validRowCount: integer("valid_row_count").notNull().default(0),
    errorRowCount: integer("error_row_count").notNull().default(0),
    status: varchar("status", { length: 30 }).notNull().default("UPLOADED"), // UPLOADED|SCANNED|PARSED|VALIDATED|IN_REVIEW|SUBMITTED|APPROVED|PROCESSING|COMPLETED|PARTIALLY_FAILED|FAILED|CANCELLED
    fileRef: varchar("file_ref", { length: 200 }),
    createdById: uuid("created_by_id"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payment_batches_tenant_idx").on(t.tenantId)],
);

export const paymentBatchRows = pgTable(
  "payment_batch_rows",
  {
    id: id(),
    batchId: uuid("batch_id").notNull().references(() => paymentBatches.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    recipientName: varchar("recipient_name", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 20 }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    reference: varchar("reference", { length: 100 }),
    category: varchar("category", { length: 100 }),
    status: varchar("status", { length: 20 }).notNull().default("VALID"), // VALID|ERROR|PENDING|SUCCESS|FAILED|SKIPPED
    errorMessage: text("error_message"),
    paymentId: uuid("payment_id").references(() => payments.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payment_batch_rows_batch_idx").on(t.batchId),
    uniqueIndex("payment_batch_rows_row_uidx").on(t.batchId, t.rowNumber),
  ],
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: id(),
    paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull().default(1),
    providerId: uuid("provider_id").references(() => providers.id),
    providerReference: varchar("provider_reference", { length: 200 }),
    requestPayload: jsonb("request_payload"),
    responsePayload: jsonb("response_payload"),
    status: varchar("status", { length: 20 }).notNull().default("QUEUED"), // QUEUED|SENT|PENDING|SUCCESS|FAILED|TIMEOUT|UNKNOWN
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: text("error_message"),
    latencyMs: integer("latency_ms"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payment_attempts_payment_idx").on(t.paymentId)],
);

export const paymentMethods = pgTable("payment_methods", {
  id: id(),
  tenantId: tenantId().notNull().references(() => tenants.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 30 }).notNull(), // mpesa | till | paybill | bank
  name: varchar("name", { length: 100 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const paymentSchedules = pgTable(
  "payment_schedules",
  {
    id: id(),
    tenantId: tenantId().notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    beneficiaryId: uuid("beneficiary_id").references(() => beneficiaries.id),
    beneficiarySnapshot: jsonb("beneficiary_snapshot"),
    amountMinor: minor("amount_minor").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("KES"),
    frequency: varchar("frequency", { length: 20 }).notNull(), // DAILY|WEEKLY|MONTHLY|CUSTOM
    cronExpr: varchar("cron_expr", { length: 100 }),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    status: varchar("status", { length: 20 }).notNull().default("ACTIVE"), // ACTIVE|PAUSED|COMPLETED|CANCELLED
    channel: varchar("channel", { length: 30 }).notNull().default("mpesa"),
    category: varchar("category", { length: 100 }),
    createdById: uuid("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payment_schedules_tenant_idx").on(t.tenantId)],
);

export const paymentAttachments = pgTable(
  "payment_attachments",
  {
    id: id(),
    paymentId: uuid("payment_id").references(() => payments.id),
    tenantId: tenantId().notNull(),
    fileRef: varchar("file_ref", { length: 200 }).notNull(),
    filename: varchar("filename", { length: 260 }).notNull(),
    mimeType: varchar("mime_type", { length: 120 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
    scanStatus: varchar("scan_status", { length: 20 }).notNull().default("PENDING"), // PENDING|CLEAN|INFECTED|ERROR
    uploadedById: uuid("uploaded_by_id"),
    createdAt: createdAt(),
  },
  (t) => [index("payment_attachments_payment_idx").on(t.paymentId)],
);

/* ------------------------------------------------------------------ */
/* Ledger                                                              */
/* ------------------------------------------------------------------ */

export const chartOfAccounts = pgTable(
  "chart_of_accounts",
  {
    id: id(),
    tenantId: tenantId(),
    code: varchar("code", { length: 40 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    type: varchar("type", { length: 20 }).notNull(), // ASSET|LIABILITY|EQUITY|REVENUE|EXPENSE
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("chart_of_accounts_tenant_code_uidx").on(t.tenantId, t.code)],
);

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    chartAccountId: uuid("chart_account_id").references(() => chartOfAccounts.id),
    kind: varchar("kind", { length: 20 }).notNull().default("SYSTEM"), // SYSTEM | WALLET
    walletId: uuid("wallet_id").references(() => wallets.id),
    code: varchar("code", { length: 120 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("KES"),
    /** Running posted balance (minor units). */
    postedBalanceMinor: minor("posted_balance_minor").notNull().default(sql`0`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("ledger_accounts_tenant_code_uidx").on(t.tenantId, t.code),
    uniqueIndex("ledger_accounts_wallet_uidx").on(t.walletId),
  ],
);

export const journals = pgTable(
  "journals",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    referenceType: varchar("reference_type", { length: 60 }).notNull(), // payment | funding | reversal | fee
    referenceId: uuid("reference_id").notNull(),
    description: text("description"),
    createdById: uuid("created_by_id"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    status: varchar("status", { length: 20 }).notNull().default("POSTED"), // POSTED | REVERSED
    reversalOfJournalId: uuid("reversal_of_journal_id"),
    createdAt: createdAt(),
  },
  (t) => [index("journals_tenant_idx").on(t.tenantId), index("journals_ref_idx").on(t.referenceType, t.referenceId)],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: id(),
    journalId: uuid("journal_id").notNull().references(() => journals.id, { onDelete: "cascade" }),
    ledgerAccountId: uuid("ledger_account_id").notNull().references(() => ledgerAccounts.id),
    debitMinor: minor("debit_minor").notNull().default(sql`0`),
    creditMinor: minor("credit_minor").notNull().default(sql`0`),
    memo: text("memo"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("journal_entries_journal_idx").on(t.journalId),
    index("journal_entries_account_idx").on(t.ledgerAccountId),
  ],
);

export const balanceSnapshots = pgTable(
  "balance_snapshots",
  {
    id: id(),
    ledgerAccountId: uuid("ledger_account_id").notNull().references(() => ledgerAccounts.id),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    balanceMinor: minor("balance_minor").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("balance_snapshots_account_asof_idx").on(t.ledgerAccountId, t.asOf)],
);

export const walletReservations = pgTable(
  "wallet_reservations",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    paymentId: uuid("payment_id").notNull().references(() => payments.id),
    walletId: uuid("wallet_id").notNull().references(() => wallets.id),
    amountMinor: minor("amount_minor").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("HELD"), // HELD | RELEASED | APPLIED
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("wallet_reservations_payment_uidx").on(t.paymentId)],
);

/**
 * Per-wallet reservation ledger (C-3) — append-only audit trail of every
 * reserved-vs-settled movement on a wallet, INCLUDING denied reservation
 * attempts (double-spend attempts). Every row carries the signed deltas and
 * the wallet's available/reserved balance after the operation, so the ledger
 * can be replayed to prove balances and to audit denied attempts.
 * Immutability is enforced by a DB trigger (see custom-migrations/011).
 */
export const walletLedgerEntries = pgTable(
  "wallet_ledger_entries",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    walletId: uuid("wallet_id").notNull().references(() => wallets.id, { onDelete: "cascade" }),
    /**
     * FUND (available +) | RESERVE (available -, reserved +) |
     * RESERVE_DENIED (attempt rejected — deltas 0) | RELEASE (reserved ->
     * available) | APPLY (reserved -> settled, reserved only).
     */
    entryType: varchar("entry_type", { length: 24 }).notNull(),
    refType: varchar("ref_type", { length: 30 }), // payment | funding | payment_link
    refId: uuid("ref_id"),
    /** Operation amount (positive minor units). */
    amountMinor: minor("amount_minor").notNull(),
    deltaAvailableMinor: minor("delta_available_minor").notNull(),
    deltaReservedMinor: minor("delta_reserved_minor").notNull(),
    availableAfterMinor: minor("available_after_minor").notNull(),
    reservedAfterMinor: minor("reserved_after_minor").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("wallet_ledger_wallet_created_idx").on(t.walletId, t.createdAt),
    index("wallet_ledger_type_idx").on(t.entryType, t.walletId),
    index("wallet_ledger_ref_idx").on(t.refType, t.refId),
  ],
);


export const fundingEvents = pgTable(
  "funding_events",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    walletId: uuid("wallet_id").notNull().references(() => wallets.id),
    businessAccountId: uuid("business_account_id").references(() => businessAccounts.id),
    amountMinor: minor("amount_minor").notNull(),
    reference: varchar("reference", { length: 120 }),
    method: varchar("method", { length: 30 }).notNull(), // MPESA | BANK_TRANSFER | MANUAL_ADJUSTMENT
    status: varchar("status", { length: 20 }).notNull().default("PENDING"),
    createdById: uuid("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("funding_events_tenant_idx").on(t.tenantId)],
);

export const reversals = pgTable(
  "reversals",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    paymentId: uuid("payment_id").notNull().references(() => payments.id),
    journalId: uuid("journal_id").references(() => journals.id),
    amountMinor: minor("amount_minor").notNull(),
    reason: text("reason").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("REQUESTED"), // REQUESTED|PROCESSED|FAILED
    createdById: uuid("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("reversals_tenant_idx").on(t.tenantId)],
);

export const settlements = pgTable("settlements", {
  id: id(),
  tenantId: tenantId().notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  providerId: uuid("provider_id").references(() => providers.id),
  grossMinor: minor("gross_minor").notNull().default(sql`0`),
  feesMinor: minor("fees_minor").notNull().default(sql`0`),
  netMinor: minor("net_minor").notNull().default(sql`0`),
  status: varchar("status", { length: 20 }).notNull().default("DRAFT"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

export const pricingPlans = pgTable("pricing_plans", {
  id: id(),
  name: varchar("name", { length: 200 }).notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  createdAt: createdAt(),
});

export const feeRules = pgTable(
  "fee_rules",
  {
    id: id(),
    tenantId: tenantId(),
    product: varchar("product", { length: 40 }).notNull(),
    channel: varchar("channel", { length: 30 }).notNull(),
    provider: varchar("provider", { length: 60 }).notNull(),
    flatFeeMinor: minor("flat_fee_minor").notNull().default(sql`0`),
    percentBps: minor("percent_bps").notNull().default(sql`0`),
    minFeeMinor: minor("min_fee_minor").notNull().default(sql`0`),
    maxFeeMinor: minor("max_fee_minor").notNull().default(sql`0`),
    currency: varchar("currency", { length: 3 }).notNull().default("KES"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    status: varchar("status", { length: 20 }).notNull().default("ACTIVE"), // ACTIVE|DRAFT|DISABLED
    version: integer("version").notNull().default(1),
    changeComment: text("change_comment"),
    createdById: uuid("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("fee_rules_tenant_idx").on(t.tenantId)],
);

export const feeVersions = pgTable("fee_versions", {
  id: id(),
  feeRuleId: uuid("fee_rule_id").notNull().references(() => feeRules.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  changeComment: text("change_comment"),
  createdById: uuid("created_by_id"),
  createdAt: createdAt(),
});

export const feeCalculations = pgTable(
  "fee_calculations",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    paymentId: uuid("payment_id").references(() => payments.id),
    ruleId: uuid("rule_id").references(() => feeRules.id),
    amountMinor: minor("amount_minor").notNull(),
    feeMinor: minor("fee_minor").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("KES"),
    /** Immutable snapshot of the rule that produced this fee. */
    ruleSnapshot: jsonb("rule_snapshot").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("fee_calculations_tenant_idx").on(t.tenantId)],
);

export const invoices = pgTable("invoices", {
  id: id(),
  tenantId: tenantId().notNull(),
  number: varchar("number", { length: 40 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("DRAFT"),
  amountMinor: minor("amount_minor").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const charges = pgTable("charges", {
  id: id(),
  tenantId: tenantId().notNull(),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  description: varchar("description", { length: 300 }).notNull(),
  amountMinor: minor("amount_minor").notNull(),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Approvals                                                           */
/* ------------------------------------------------------------------ */

export const approvalPolicies = pgTable(
  "approval_policies",
  {
    id: id(),
    tenantId: tenantId(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    rules: jsonb("rules").notNull().default(sql`'[]'::jsonb`),
    version: integer("version").notNull().default(1),
    active: boolean("active").notNull().default(true),
    createdById: uuid("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("approval_policies_tenant_idx").on(t.tenantId)],
);

export const approvalPolicyVersions = pgTable("approval_policy_versions", {
  id: id(),
  policyId: uuid("policy_id").notNull().references(() => approvalPolicies.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  rulesSnapshot: jsonb("rules_snapshot").notNull(),
  changeComment: text("change_comment"),
  createdById: uuid("created_by_id"),
  createdAt: createdAt(),
});

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    paymentId: uuid("payment_id").references(() => payments.id),
    batchId: uuid("batch_id").references(() => paymentBatches.id),
    /**
     * Maker-checker generalization: resourceType/resourceId let the same
     * engine gate ANY sensitive resource (beneficiary payee-book entries,
     * reversals, privileged role invites) — payments keep paymentId.
     */
    resourceType: varchar("resource_type", { length: 40 }),
    resourceId: uuid("resource_id"),
    policyId: uuid("policy_id").references(() => approvalPolicies.id),
    /** Immutable policy snapshot used for this request. */
    policySnapshot: jsonb("policy_snapshot"),
    status: varchar("status", { length: 30 }).notNull().default("PENDING"), // PENDING|PARTIALLY_APPROVED|APPROVED|REJECTED|EXPIRED|CANCELLED
    mode: varchar("mode", { length: 20 }).notNull().default("SEQUENTIAL"),
    requiredApprovals: integer("required_approvals").notNull().default(1),
    currentLevel: integer("current_level").notNull().default(1),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdById: uuid("created_by_id"),
    /** Platform-config changes (resource_type='platform_config'): set when the
     * approved change was executed; execution_error carries the reason when the
     * apply failed (e.g. a uniqueness conflict appearing after approval). */
    executedAt: timestamp("executed_at", { withTimezone: true }),
    executionError: text("execution_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("approval_requests_tenant_status_idx").on(t.tenantId, t.status)],
);

export const approvalSteps = pgTable(
  "approval_steps",
  {
    id: id(),
    requestId: uuid("request_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    mode: varchar("mode", { length: 20 }).notNull(), // SEQUENTIAL|PARALLEL|ANY
    roles: varchar("roles", { length: 60 }).array().notNull(),
    minApprovers: integer("min_approvers").notNull().default(1),
    status: varchar("status", { length: 20 }).notNull().default("PENDING"), // PENDING|IN_PROGRESS|APPROVED|REJECTED|SKIPPED
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("approval_steps_request_idx").on(t.requestId)],
);

export const approvalActions = pgTable(
  "approval_actions",
  {
    id: id(),
    requestId: uuid("request_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").notNull().references(() => approvalSteps.id),
    actorId: uuid("actor_id").notNull(),
    decision: varchar("decision", { length: 20 }).notNull(), // APPROVE|REJECT|DELEGATE
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("approval_actions_request_actor_uidx").on(t.requestId, t.actorId),
    index("approval_actions_request_idx").on(t.requestId),
  ],
);

export const approvalDelegations = pgTable("approval_delegations", {
  id: id(),
  tenantId: tenantId().notNull(),
  fromUserId: uuid("from_user_id").notNull(),
  toUserId: uuid("to_user_id").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Reconciliation                                                      */
/* ------------------------------------------------------------------ */

export const reconRuns = pgTable("recon_runs", {
  id: id(),
  tenantId: tenantId().notNull(),
  providerId: uuid("provider_id").references(() => providers.id),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  source: varchar("source", { length: 30 }).notNull().default("API_POLL"),
  status: varchar("status", { length: 30 }).notNull().default("RUNNING"),
  createdById: uuid("created_by_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const reconItems = pgTable(
  "recon_items",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    runId: uuid("run_id").references(() => reconRuns.id),
    source: varchar("source", { length: 30 }).notNull(), // PROVIDER_STATEMENT|WEBHOOK|API_POLL
    providerReference: varchar("provider_reference", { length: 200 }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("KES"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    normalized: jsonb("normalized"),
    status: varchar("status", { length: 20 }).notNull().default("PENDING"), // PENDING|MATCHED|PARTIAL|UNMATCHED|DUPLICATE|UNKNOWN
    paymentId: uuid("payment_id").references(() => payments.id),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("recon_items_tenant_idx").on(t.tenantId),
    index("recon_items_provider_ref_idx").on(t.providerReference),
  ],
);

export const reconMatches = pgTable("recon_matches", {
  id: id(),
  itemId: uuid("item_id").notNull().references(() => reconItems.id),
  paymentId: uuid("payment_id").notNull().references(() => payments.id),
  matchType: varchar("match_type", { length: 20 }).notNull().default("EXACT"),
  matchedAt: timestamp("matched_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

export const reconExceptions = pgTable(
  "recon_exceptions",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    itemId: uuid("item_id").references(() => reconItems.id),
    paymentId: uuid("payment_id").references(() => payments.id),
    kind: varchar("kind", { length: 40 }).notNull(), // AMOUNT_MISMATCH|UNMATCHED|DUPLICATE|UNKNOWN|ORPHAN
    severity: varchar("severity", { length: 20 }).notNull().default("MEDIUM"),
    status: varchar("status", { length: 20 }).notNull().default("OPEN"), // OPEN|INVESTIGATING|RESOLVED|ESCALATED
    resolution: text("resolution"),
    resolvedById: uuid("resolved_by_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("recon_exceptions_tenant_status_idx").on(t.tenantId, t.status)],
);

/** Append-only history of exception workflow actions (Phase 3): comments and
 * resolve/reopen transitions, in order, for the in-app audit trail. */
export const reconExceptionActivity = pgTable(
  "recon_exception_activity",
  {
    id: id(),
    exceptionId: uuid("exception_id")
      .notNull()
      .references(() => reconExceptions.id, { onDelete: "cascade" }),
    tenantId: tenantId().notNull(),
    actorId: uuid("actor_id"),
    action: varchar("action", { length: 20 }).notNull(), // comment | resolve | reopen
    note: text("note"),
    fromStatus: varchar("from_status", { length: 20 }),
    toStatus: varchar("to_status", { length: 20 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("recon_exception_activity_exc_idx").on(t.exceptionId, t.createdAt),
    index("recon_exception_activity_tenant_idx").on(t.tenantId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Compliance                                                          */
/* ------------------------------------------------------------------ */

export const kybCases = pgTable(
  "kyb_cases",
  {
    id: id(),
    tenantId: tenantId().notNull().references(() => tenants.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 30 }).notNull().default("DRAFT"), // DRAFT|SUBMITTED|NEEDS_INFO|APPROVED|REJECTED
    businessType: varchar("business_type", { length: 60 }),
    documents: jsonb("documents").notNull().default(sql`'[]'::jsonb`),
    reviewedById: uuid("reviewed_by_id"),
    reviewNotes: text("review_notes"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("kyb_cases_tenant_idx").on(t.tenantId)],
);

export const kycSubjects = pgTable("kyc_subjects", {
  id: id(),
  tenantId: tenantId().notNull(),
  fullName: varchar("full_name", { length: 200 }).notNull(),
  idType: varchar("id_type", { length: 40 }),
  status: varchar("status", { length: 30 }).notNull().default("PENDING"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const verificationDocuments = pgTable("verification_documents", {
  id: id(),
  tenantId: tenantId().notNull(),
  caseId: uuid("case_id").references(() => kybCases.id),
  fileRef: varchar("file_ref", { length: 200 }).notNull(),
  docType: varchar("doc_type", { length: 60 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("PENDING"),
  scannedAt: timestamp("scanned_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const consentRecords = pgTable(
  "consent_records",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    userId: uuid("user_id"),
    purpose: varchar("purpose", { length: 120 }).notNull(),
    granted: boolean("granted").notNull().default(true),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("consent_records_tenant_idx").on(t.tenantId)],
);

export const dataRequests = pgTable(
  "data_requests",
  {
    id: id(),
    tenantId: uuid("tenant_id"),
    userId: uuid("user_id"),
    type: varchar("type", { length: 20 }).notNull(), // EXPORT|DELETE|CORRECTION
    status: varchar("status", { length: 20 }).notNull().default("REQUESTED"),
    // Public intake fields (017): anonymous subjects self-register via
    // POST /api/privacy/requests; a platform admin identity-checks the email
    // BEFORE executing the export/erasure endpoints.
    requesterEmail: varchar("requester_email", { length: 320 }),
    requesterName: varchar("requester_name", { length: 200 }),
    note: text("note"),
    payloadRef: varchar("payload_ref", { length: 200 }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("data_requests_tenant_idx").on(t.tenantId)],
);

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    tenantId: tenantId(),
    actorId: uuid("actor_id"),
    actorRole: varchar("actor_role", { length: 60 }),
    action: varchar("action", { length: 120 }).notNull(),
    resourceType: varchar("resource_type", { length: 60 }).notNull(),
    resourceId: varchar("resource_id", { length: 100 }),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: varchar("ip", { length: 45 }),
    userAgent: text("user_agent"),
    requestId: varchar("request_id", { length: 64 }),
    correlationId: varchar("correlation_id", { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_tenant_idx").on(t.tenantId), index("audit_events_resource_idx").on(t.resourceType, t.resourceId), index("audit_events_created_idx").on(t.createdAt)],
);

export const securityEvents = pgTable(
  "security_events",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id"),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    severity: varchar("severity", { length: 20 }).notNull().default("INFO"),
    details: jsonb("details"),
    ip: varchar("ip", { length: 45 }),
    createdAt: createdAt(),
  },
  (t) => [index("security_events_created_idx").on(t.createdAt), index("security_events_type_idx").on(t.eventType)],
);

export const adminChanges = pgTable("admin_changes", {
  id: id(),
  adminUserId: uuid("admin_user_id").notNull(),
  tenantId: tenantId(),
  changeType: varchar("change_type", { length: 60 }).notNull(),
  entity: varchar("entity", { length: 60 }).notNull(),
  entityId: varchar("entity_id", { length: 100 }),
  diff: jsonb("diff"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

export const fileObjects = pgTable("file_objects", {
  id: id(),
  tenantId: tenantId(),
  ref: varchar("ref", { length: 200 }).notNull(),
  filename: varchar("filename", { length: 260 }).notNull(),
  mimeType: varchar("mime_type", { length: 120 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
  storageDriver: varchar("storage_driver", { length: 30 }).notNull(),
  storageKey: varchar("storage_key", { length: 500 }).notNull(),
  scanStatus: varchar("scan_status", { length: 20 }).notNull().default("PENDING"),
  uploadedById: uuid("uploaded_by_id"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export const notificationTemplates = pgTable(
  "notification_templates",
  {
    id: id(),
    code: varchar("code", { length: 80 }).notNull(),
    channel: varchar("channel", { length: 20 }).notNull(), // IN_APP|EMAIL|SMS
    subject: varchar("subject", { length: 200 }),
    body: text("body").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("notification_templates_code_uidx").on(t.code)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id"),
    channel: varchar("channel", { length: 20 }).notNull().default("IN_APP"),
    templateCode: varchar("template_code", { length: 80 }),
    title: varchar("title", { length: 200 }),
    body: text("body"),
    data: jsonb("data"),
    readAt: timestamp("read_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    status: varchar("status", { length: 20 }).notNull().default("QUEUED"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId), index("notifications_tenant_idx").on(t.tenantId)],
);

/* ------------------------------------------------------------------ */
/* Content / CMS                                                       */
/* ------------------------------------------------------------------ */

export const posts = pgTable(
  "posts",
  {
    id: id(),
    slug: varchar("slug", { length: 200 }).notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    excerpt: text("excerpt"),
    body: text("body").notNull(),
    coverRef: varchar("cover_ref", { length: 200 }),
    status: varchar("status", { length: 20 }).notNull().default("DRAFT"),
    authorUserId: uuid("author_user_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    seo: jsonb("seo"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("posts_slug_uidx").on(t.slug)],
);

export const pages = pgTable(
  "pages",
  {
    id: id(),
    slug: varchar("slug", { length: 200 }).notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    content: text("content").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("DRAFT"),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pages_slug_uidx").on(t.slug)],
);

/* ------------------------------------------------------------------ */
/* Support                                                             */
/* ------------------------------------------------------------------ */

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id"),
    subject: varchar("subject", { length: 300 }).notNull(),
    body: text("body").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("OPEN"),
    priority: varchar("priority", { length: 20 }).notNull().default("NORMAL"),
    assignedToId: uuid("assigned_to_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("support_tickets_tenant_idx").on(t.tenantId)],
);

export const ticketMessages = pgTable("ticket_messages", {
  id: id(),
  ticketId: uuid("ticket_id").notNull().references(() => supportTickets.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id"),
  authorIsAdmin: boolean("author_is_admin").notNull().default(false),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Settings / flags / webhooks / providers                             */
/* ------------------------------------------------------------------ */

export const settings = pgTable(
  "settings",
  {
    id: id(),
    scope: varchar("scope", { length: 20 }).notNull().default("GLOBAL"), // GLOBAL|TENANT
    scopeRef: uuid("scope_ref"),
    key: varchar("key", { length: 120 }).notNull(),
    value: jsonb("value").notNull(),
    updatedById: uuid("updated_by_id"),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("settings_scope_key_uidx").on(t.scope, t.scopeRef, t.key)],
);

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: id(),
    key: varchar("key", { length: 100 }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    tenantId: tenantId(),
    percentage: integer("percentage").notNull().default(100),
    description: varchar("description", { length: 500 }),
    createdById: uuid("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("feature_flags_key_tenant_uidx").on(t.key, t.tenantId)],
);

export const providers = pgTable(
  "providers",
  {
    id: id(),
    code: varchar("code", { length: 60 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    providerType: varchar("provider_type", { length: 30 }).notNull(), // mpesa | bank | airtime | sandbox
    environment: varchar("environment", { length: 20 }).notNull().default("sandbox"),
    enabled: boolean("enabled").notNull().default(true),
    /** Non-secret config. Secrets are stored encrypted via ENCRYPTION_KEY. */
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    priority: integer("priority").notNull().default(100),
    maintenance: boolean("maintenance").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("providers_code_uidx").on(t.code)],
);

export const paymentRoutes = pgTable(
  "payment_routes",
  {
    id: id(),
    product: varchar("product", { length: 40 }).notNull(),
    channel: varchar("channel", { length: 30 }).notNull(),
    providerId: uuid("provider_id").notNull().references(() => providers.id),
    priority: integer("priority").notNull().default(100),
    enabled: boolean("enabled").notNull().default(true),
    conditions: jsonb("conditions"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("payment_routes_product_channel_provider_uidx").on(t.product, t.channel, t.providerId)],
);

export const billers = pgTable(
  "billers",
  {
    id: id(),
    code: varchar("code", { length: 60 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    category: varchar("category", { length: 80 }),
    channel: varchar("channel", { length: 20 }).notNull(), // paybill | till
    accountNumber: varchar("account_number", { length: 40 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("billers_code_uidx").on(t.code)],
);

export const airtimeCatalog = pgTable("airtime_catalog", {
  id: id(),
  providerCode: varchar("provider_code", { length: 60 }).notNull(),
  network: varchar("network", { length: 40 }).notNull(),
  productCode: varchar("product_code", { length: 60 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // AIRTIME | DATA
  denominationMinor: minor("denomination_minor").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("KES"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: id(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    aggregateType: varchar("aggregate_type", { length: 60 }).notNull(),
    aggregateId: varchar("aggregate_id", { length: 100 }).notNull(),
    tenantId: tenantId(),
    payload: jsonb("payload").notNull(),
    attempts: integer("attempts").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [index("outbox_events_unpublished_idx").on(t.publishedAt)],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    scope: varchar("scope", { length: 60 }).notNull(), // payment.create | payment.approve | ...
    key: varchar("key", { length: 128 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("IN_PROGRESS"),
    response: jsonb("response"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("idempotency_records_scope_key_uidx").on(t.tenantId, t.scope, t.key),
    index("idempotency_records_tenant_idx").on(t.tenantId),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    providerId: uuid("provider_id").references(() => providers.id),
    tenantId: tenantId(),
    type: varchar("type", { length: 100 }).notNull(),
    /** Provider-side event id used for deduplication. */
    providerEventId: varchar("provider_event_id", { length: 200 }),
    payload: jsonb("payload").notNull(),
    payloadBody: text("payload_body"), // exact serialized bytes sent (signed payload)
    signature: text("signature"),
    headers: jsonb("headers"),
    status: varchar("status", { length: 20 }).notNull().default("RECEIVED"), // RECEIVED|PROCESSED|DUPLICATE|FAILED
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("webhook_events_provider_event_uidx").on(t.providerId, t.providerEventId),
    index("webhook_events_status_idx").on(t.status),
  ],
);

export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: id(),
    tenantId: tenantId().notNull().references(() => tenants.id, { onDelete: "cascade" }),
    reportType: varchar("report_type", { length: 40 }).notNull().default("transactions"), // transactions|fees
    /** monthly (1st of month) or weekly (Monday). */
    frequency: varchar("frequency", { length: 20 }).notNull().default("monthly"), // monthly|weekly
    /** Scheduled artifacts are purged after this many days (default 90). */
    retentionDays: integer("retention_days").notNull().default(90),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    active: boolean("active").notNull().default(true),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("report_schedules_due_idx").on(t.active, t.nextRunAt), index("report_schedules_tenant_idx").on(t.tenantId)],
);

export const reports = pgTable(
  "reports",
  {
    id: id(),
    tenantId: tenantId().notNull().references(() => tenants.id, { onDelete: "cascade" }),
    reportType: varchar("report_type", { length: 40 }).notNull().default("transactions"), // transactions|fees
    format: varchar("format", { length: 10 }).notNull().default("csv"),
    status: varchar("status", { length: 20 }).notNull().default("REQUESTED"), // REQUESTED|GENERATED|FAILED
    payloadRef: varchar("payload_ref", { length: 400 }),
    rowCount: integer("row_count").notNull().default(0),
    requestedById: uuid("requested_by_id").references(() => users.id),
    /** Set when the report was produced by a recurring schedule. */
    scheduleId: uuid("schedule_id").references(() => reportSchedules.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("reports_tenant_idx").on(t.tenantId), index("reports_schedule_idx").on(t.scheduleId)],
);

export const mfaBackupCodes = pgTable(
  "mfa_backup_codes",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    codeHash: varchar("code_hash", { length: 64 }).notNull(), // sha256 of the one-time code
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("mfa_backup_codes_user_idx").on(t.userId)],
);

export const paymentLinks = pgTable(
  "payment_links",
  {
    id: id(),
    tenantId: tenantId().notNull().references(() => tenants.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 40 }).notNull().unique(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    amountMinor: minor("amount_minor").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("KES"),
    channel: varchar("channel", { length: 30 }).notNull().default("mpesa"),
    status: varchar("status", { length: 20 }).notNull().default("ACTIVE"), // ACTIVE|PAUSED|CLOSED
    maxUses: integer("max_uses"),
    useCount: integer("use_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payment_links_tenant_idx").on(t.tenantId), index("payment_links_token_idx").on(t.token)],
);

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: id(),
    tenantId: tenantId().notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    url: varchar("url", { length: 500 }).notNull(),
    secretEncrypted: text("secret_encrypted").notNull(), // AES-256-GCM (symmetric signing secret)
    secretVersion: integer("secret_version").notNull().default(1),
    secretRotatedAt: timestamp("secret_rotated_at", { withTimezone: true }),
    events: jsonb("events").notNull(), // e.g. ["payment.completed","payment.failed","batch.completed"]
    status: varchar("status", { length: 20 }).notNull().default("ACTIVE"), // ACTIVE|DISABLED
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("webhook_subscriptions_tenant_idx").on(t.tenantId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    subscriptionId: uuid("subscription_id").notNull().references(() => webhookSubscriptions.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    payload: jsonb("payload").notNull(),
    payloadBody: text("payload_body"), // exact serialized bytes sent (signed payload)
    signature: text("signature"),
    status: varchar("status", { length: 20 }).notNull().default("PENDING"), // PENDING|DELIVERED|FAILED
    attempts: integer("attempts").notNull().default(0),
    responseStatus: integer("response_status"),
    /** Last delivery error (network reason / HTTP status / terminal cause) — the DLQ detail. */
    lastError: text("last_error"),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("webhook_deliveries_tenant_idx").on(t.tenantId), index("webhook_deliveries_sub_idx").on(t.subscriptionId)],
);

/* ------------------------------------------------------------------ */
/* KYC / AML                                                           */
/* ------------------------------------------------------------------ */

export const amlWatchlists = pgTable(
  "aml_watchlists",
  {
    id: id(),
    kind: varchar("kind", { length: 20 }).notNull(), // SANCTIONS|PEP|ADVERSE
    name: text("name").notNull(),
    aliases: jsonb("aliases").default([]), // string[]
    country: varchar("country", { length: 80 }),
    reference: varchar("reference", { length: 120 }), // external list reference
    source: varchar("source", { length: 80 }).notNull().default("internal"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("aml_watchlists_name_idx").on(t.name)],
);

export const kycProfiles = pgTable(
  "kyc_profiles",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    businessName: varchar("business_name", { length: 200 }),
    registrationNumber: varchar("registration_number", { length: 80 }),
    verificationLevel: varchar("verification_level", { length: 20 }).notNull().default("NONE"), // NONE|BASIC|FULL
    status: varchar("status", { length: 20 }).notNull().default("NOT_SUBMITTED"), // NOT_SUBMITTED|PENDING|APPROVED|REJECTED
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedById: uuid("reviewed_by_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("kyc_profiles_tenant_idx").on(t.tenantId)],
);

export const kycDocuments = pgTable(
  "kyc_documents",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    profileId: uuid("profile_id").references(() => kycProfiles.id, { onDelete: "cascade" }),
    docType: varchar("doc_type", { length: 40 }).notNull(), // CR12|KRA_PIN|ID_PASSPORT|DIRECTORS|UTILITY|BANK_STATEMENT
    fileId: uuid("file_id").references(() => fileObjects.id),
    status: varchar("status", { length: 20 }).notNull().default("SUBMITTED"), // SUBMITTED|VERIFIED|REJECTED
    notes: text("notes"),
    uploadedById: uuid("uploaded_by_id"),
    createdAt: createdAt(),
  },
  (t) => [index("kyc_documents_tenant_idx").on(t.tenantId)],
);

export const kycScreenings = pgTable(
  "kyc_screenings",
  {
    id: id(),
    tenantId: tenantId(),
    subjectType: varchar("subject_type", { length: 20 }).notNull(), // TENANT|BENEFICIARY|DIRECTOR
    subjectName: text("subject_name").notNull(),
    subjectRef: text("subject_ref"), // phone / registration no
    result: varchar("result", { length: 20 }).notNull(), // CLEAR|HIT
    score: integer("score").notNull().default(0),
    matchedEntries: jsonb("matched_entries").default([]), // [{id,kind,name}]
    paymentId: uuid("payment_id"),
    createdById: uuid("created_by_id"),
    createdAt: createdAt(),
  },
  (t) => [index("kyc_screenings_tenant_idx").on(t.tenantId), index("kyc_screenings_payment_idx").on(t.paymentId)],
);

export const kycCases = pgTable(
  "kyc_cases",
  {
    id: id(),
    tenantId: tenantId(),
    screeningId: uuid("screening_id").references(() => kycScreenings.id),
    paymentId: uuid("payment_id"),
    kind: varchar("kind", { length: 30 }).notNull(), // SANCTION_HIT|PEP_HIT|ADVERSE_HIT|DOC_REVIEW
    status: varchar("status", { length: 20 }).notNull().default("OPEN"), // OPEN|IN_REVIEW|APPROVED|REJECTED|CLOSED
    riskLevel: varchar("risk_level", { length: 20 }).notNull().default("MEDIUM"), // LOW|MEDIUM|HIGH|CRITICAL
    note: text("note"),
    decidedById: uuid("decided_by_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("kyc_cases_tenant_idx").on(t.tenantId),
    index("kyc_cases_status_idx").on(t.status),
    index("kyc_cases_payment_idx").on(t.paymentId),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    tenantId: tenantId().notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 16 }).notNull(), // visible identifier zf_live_a1B2…
    keyHash: varchar("key_hash", { length: 64 }).notNull(), // sha256 of full key — raw never stored
    status: varchar("status", { length: 20 }).notNull().default("ACTIVE"), // ACTIVE|REVOKED
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdById: uuid("created_by_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("api_keys_tenant_idx").on(t.tenantId),
    index("api_keys_hash_idx").on(t.keyHash),
  ],
);
