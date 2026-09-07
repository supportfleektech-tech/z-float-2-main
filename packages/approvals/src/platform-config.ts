/**
 * Platform-admin maker-checker (KNOWN_LIMITATIONS #14b).
 *
 * Sensitive platform configuration — catalog billers/airtime, pricing/fee
 * rules, approval policies (create / pause / activate / versioned rule
 * edits) and feature flags — can no longer be changed by a single platform
 * admin. Every mutation is staged as an approval request
 * (tenantId = PLATFORM_TENANT_ID, resource_type = 'platform_config'); a
 * DISTINCT platform admin (maker ≠ checker, enforced by the approvals
 * engine) signs off, and only then is the change applied — under the
 * approver's authority — with the original audit trail intact.
 *
 * Staged payload semantics:
 *  - create  → full row spec (payload), applied on approval.
 *  - update  → the change is a DELTA (fields to set). The checker reviews the
 *    diff against a snapshot of the row taken at staging time; the apply
 *    re-reads the current row so a later unrelated change never gets
 *    overwritten, and the audit `before` is the row as found at apply time.
 *  - delete  → target row is removed on approval. Targets must exist at
 *    staging time (404) but are re-checked at apply time.
 *
 * Apply-time conflicts (e.g. unique code taken by a concurrent approval)
 * fail the apply: the request stays APPROVED with execution_error set and a
 * platform.config.apply_failed audit event, so it is visible in the admin
 * approvals centre instead of failing silently.
 */
import { eq } from "drizzle-orm";
import { schema, toJsonSafe, type Db } from "@zfloat/database";
import { writeAuditEvent } from "@zfloat/audit";
import { createApprovalRequest, recordApprovalAction, listApprovalRequests, ApprovalError } from "./service.js";
import { validateRules, type ApprovalRule } from "./policy.js";
import { parseMinor } from "@zfloat/money";

/** Sentinel tenant id used for platform-scoped approvals (no tenant row). */
export const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
/** Role that may approve platform configuration changes. */
export const PLATFORM_CONFIG_APPROVER_ROLE = "SUPER_ADMIN";

export type PlatformConfigKind = "biller" | "airtime" | "fee_rule" | "approval_policy" | "feature_flag";
export type PlatformConfigOp = "create" | "update" | "delete";

export interface PlatformConfigChangeInput {
  actorId: string;
  kind: PlatformConfigKind;
  op: PlatformConfigOp;
  /** Target row id — required for update/delete, absent for create. */
  targetId?: string;
  /** Fields for create, or the delta for update (validated per kind). */
  payload: Record<string, unknown>;
  /** Human label, e.g. the biller name. Auto-derived when omitted. */
  label?: string;
  summary?: string;
}

export interface PlatformConfigChangeMeta {
  kind: PlatformConfigKind;
  op: PlatformConfigOp;
  targetId?: string;
  payload: Record<string, unknown>;
  beforeSnapshot?: Record<string, unknown> | null;
  label: string;
  summary: string;
}

export class PlatformConfigError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "PlatformConfigError";
  }
}

export type PlatformConfigDecision = {
  decision: "APPROVE" | "REJECT";
  comment?: string;
  requestId: string;
  actorId: string;
  actorRoles: string[];
};

/* ------------------------------------------------------------------ */
/* Validation — mirrors the semantics of the original admin routes     */
/* (apps/web/app/api/admin/catalogs/*) so staging and direct-write     */
/* behaviour never drift.                                              */
/* ------------------------------------------------------------------ */

const CODE_RE = /^[a-z0-9_-]{2,60}$/;

function norm(v: unknown, fallback = "") {
  return v === undefined || v === null ? fallback : String(v).trim();
}
function bool(v: unknown, fallback: boolean) {
  return v === undefined ? fallback : Boolean(v);
}

function validateBiller(kind: "create" | "update" | "delete", raw: Record<string, unknown>): Record<string, unknown> {
  if (kind === "delete") return {};
  if (kind === "create") {
    const code = norm(raw.code).toLowerCase();
    const name = norm(raw.name);
    const accountNumber = norm(raw.accountNumber);
    if (!CODE_RE.test(code)) {
      throw new PlatformConfigError("Code must be 2–60 chars of a-z 0-9 _ -", "INVALID_CODE");
    }
    if (!name) throw new PlatformConfigError("Name is required", "INVALID_NAME");
    if (!accountNumber) throw new PlatformConfigError("Account number is required", "INVALID_ACCOUNT");
    return {
      code,
      name,
      category: norm(raw.category) || null,
      channel: raw.channel === "till" ? "till" : "paybill",
      accountNumber,
      enabled: bool(raw.enabled, true),
    };
  }
  // update: delta only; `code` is immutable on billers (mirrors the route).
  const changes: Record<string, unknown> = {};
  if (raw.code !== undefined) throw new PlatformConfigError("Biller code cannot be changed", "CODE_IMMUTABLE");
  if (raw.name !== undefined) {
    const name = norm(raw.name);
    if (!name) throw new PlatformConfigError("Name cannot be empty", "INVALID_NAME");
    changes.name = name;
  }
  if (raw.category !== undefined) changes.category = norm(raw.category) || null;
  if (raw.channel !== undefined) changes.channel = raw.channel === "till" ? "till" : "paybill";
  if (raw.accountNumber !== undefined) {
    const accountNumber = norm(raw.accountNumber);
    if (!accountNumber) throw new PlatformConfigError("Account number cannot be empty", "INVALID_ACCOUNT");
    changes.accountNumber = accountNumber;
  }
  if (raw.enabled !== undefined) changes.enabled = Boolean(raw.enabled);
  if (Object.keys(changes).length === 0) throw new PlatformConfigError("Nothing to change", "EMPTY_CHANGE");
  return changes;
}

function validateAirtime(kind: "create" | "update" | "delete", raw: Record<string, unknown>): Record<string, unknown> {
  if (kind === "delete") return {};
  const amount = (v: unknown) => {
    const n = Number(v ?? NaN);
    if (!Number.isFinite(n) || n <= 0) throw new PlatformConfigError("Amount must be a positive number in KES", "INVALID_AMOUNT");
    return BigInt(Math.round(n * 100));
  };
  if (kind === "create") {
    const providerCode = norm(raw.providerCode);
    const network = norm(raw.network).toUpperCase();
    const productCode = norm(raw.productCode);
    const name = norm(raw.name);
    if (!providerCode || !network || !productCode || !name) {
      throw new PlatformConfigError("providerCode, network, productCode and name are required", "MISSING_FIELDS");
    }
    return {
      providerCode,
      network,
      productCode,
      name,
      type: raw.type === "DATA" ? "DATA" : "AIRTIME",
      denominationMinor: amount(raw.amount ?? raw.denominationMinor),
      currency: "KES",
      enabled: bool(raw.enabled, true),
    };
  }
  const changes: Record<string, unknown> = {};
  if (raw.name !== undefined) {
    const name = norm(raw.name);
    if (!name) throw new PlatformConfigError("Name cannot be empty", "INVALID_NAME");
    changes.name = name;
  }
  if (raw.type !== undefined) changes.type = raw.type === "DATA" ? "DATA" : "AIRTIME";
  if (raw.amount !== undefined || raw.denominationMinor !== undefined) {
    changes.denominationMinor = amount(raw.amount ?? raw.denominationMinor);
  }
  if (raw.enabled !== undefined) changes.enabled = Boolean(raw.enabled);
  if (Object.keys(changes).length === 0) throw new PlatformConfigError("Nothing to change", "EMPTY_CHANGE");
  return changes;
}


/* Fee-rule validation — mirrors /api/admin/pricing semantics. The console
 * sends the FULL intended rule (minor-unit integer strings for money fields);
 * partial payloads are tolerated and merged with the live row at apply time,
 * exactly like the direct-write route. */
const INT_MINOR_RE = /^(0|[1-9]\d*)$/;
const FEE_STATUS = new Set(["ACTIVE", "DRAFT", "DISABLED"]);
const FEE_TXT = (v: unknown, fallback = "") => (v === undefined || v === null ? fallback : String(v).trim());

function minorOr(v: unknown, fallback: bigint): bigint {
  if (v === undefined || v === null || v === "") return fallback;
  const t = String(v).trim();
  if (!INT_MINOR_RE.test(t)) throw new PlatformConfigError("Fee amounts must be whole minor units (e.g. 500 = KES 5.00)", "INVALID_AMOUNT");
  return BigInt(t);
}

function validateFeeRule(op: PlatformConfigOp, raw: Record<string, unknown>): Record<string, unknown> {
  if (op === "delete") throw new PlatformConfigError("Fee rules cannot be deleted through maker-checker", "UNSUPPORTED_OP");
  const changes: Record<string, unknown> = {};
  if (op === "create") {
    const product = FEE_TXT(raw.product);
    const channel = FEE_TXT(raw.channel);
    const provider = FEE_TXT(raw.provider, "local-sandbox");
    if (!product) throw new PlatformConfigError("Product is required", "INVALID_PRODUCT");
    if (!channel) throw new PlatformConfigError("Channel is required", "INVALID_CHANNEL");
    return {
      product,
      channel,
      provider,
      flatFeeMinor: minorOr(raw.flatFeeMinor, 0n).toString(),
      percentBps: minorOr(raw.percentBps, 0n).toString(),
      minFeeMinor: minorOr(raw.minFeeMinor, 0n).toString(),
      maxFeeMinor: minorOr(raw.maxFeeMinor, 0n).toString(),
      status: FEE_STATUS.has(String(raw.status ?? "ACTIVE")) ? String(raw.status) : "ACTIVE",
      changeComment: FEE_TXT(raw.changeComment, "Created via admin console") || "Created via admin console",
    };
  }
  if (raw.product !== undefined) {
    const product = FEE_TXT(raw.product);
    if (!product) throw new PlatformConfigError("Product cannot be empty", "INVALID_PRODUCT");
    changes.product = product;
  }
  if (raw.channel !== undefined) {
    const channel = FEE_TXT(raw.channel);
    if (!channel) throw new PlatformConfigError("Channel cannot be empty", "INVALID_CHANNEL");
    changes.channel = channel;
  }
  if (raw.provider !== undefined) {
    const provider = FEE_TXT(raw.provider);
    if (!provider) throw new PlatformConfigError("Provider cannot be empty", "INVALID_PROVIDER");
    changes.provider = provider;
  }
  for (const k of ["flatFeeMinor", "percentBps", "minFeeMinor", "maxFeeMinor"] as const) {
    if (raw[k] !== undefined) changes[k] = minorOr(raw[k], 0n).toString();
  }
  if (raw.status !== undefined) {
    if (!FEE_STATUS.has(String(raw.status))) throw new PlatformConfigError(`Status must be one of ${[...FEE_STATUS].join(", ")}`, "INVALID_STATUS");
    changes.status = String(raw.status);
  }
  if (raw.changeComment !== undefined) changes.changeComment = FEE_TXT(raw.changeComment, "Admin change") || "Admin change";
  if (Object.keys(changes).length === 0) throw new PlatformConfigError("Nothing to change", "EMPTY_CHANGE");
  return changes;
}

/* Approval-policy validation — mirrors /api/admin/policies builder shapes:
 * rules arrive as { minAmount, maxAmount, mode, requiredRoles, minApprovers }
 * (amounts in KES major units); they are canonicalized to the stored
 * ApprovalRule shape (minor-unit strings) the same way the console routes do. */
function parseRuleAmount(v: unknown): bigint | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const minor = parseMinor(String(v));
  if (minor === null) throw new PlatformConfigError(`Invalid amount: ${String(v)}`, "INVALID_AMOUNT");
  return minor;
}

function canonicalizeRules(raw: unknown): ApprovalRule[] {
  const arr = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const rules = arr.map((r, index) => {
    const rr = (r ?? {}) as Record<string, unknown>;
    const mode = (rr.mode === "SEQUENTIAL" || rr.mode === "PARALLEL" ? rr.mode : "ANY") as ApprovalRule["mode"];
    const roles = Array.isArray(rr.requiredRoles) ? rr.requiredRoles.map(String).filter(Boolean) : [];
    const minApprovers = Math.max(1, Math.floor(Number(rr.minApprovers ?? 1)) || 1);
    return {
      minAmountMinor: parseRuleAmount(rr.minAmount ?? rr.minAmountMinor),
      maxAmountMinor: parseRuleAmount(rr.maxAmount ?? rr.maxAmountMinor),
      mode,
      requiredRoles: roles,
      minApprovers,
      order: index,
    };
  });
  validateRules(rules);
  return rules;
}

/** Stable per-rule signature used to detect rule changes (minor units as text). */
export function policyRuleSig(r: ApprovalRule): string {
  return JSON.stringify({
    minAmountMinor: r.minAmountMinor?.toString() ?? null,
    maxAmountMinor: r.maxAmountMinor?.toString() ?? null,
    mode: r.mode,
    requiredRoles: [...r.requiredRoles].sort(),
    minApprovers: r.minApprovers,
    order: r.order,
  });
}

function rulesToMinorStrings(rules: ApprovalRule[]): Record<string, unknown>[] {
  return rules.map((r) => ({
    minAmountMinor: r.minAmountMinor?.toString() ?? null,
    maxAmountMinor: r.maxAmountMinor?.toString() ?? null,
    mode: r.mode,
    requiredRoles: r.requiredRoles,
    minApprovers: r.minApprovers,
    order: r.order,
  }));
}

function validateApprovalPolicy(op: PlatformConfigOp, raw: Record<string, unknown>): Record<string, unknown> {
  if (op === "delete") throw new PlatformConfigError("Approval policies cannot be deleted through maker-checker", "UNSUPPORTED_OP");
  if (op === "create") {
    const tenantId = String(raw.tenantId ?? "").trim();
    const name = String(raw.name ?? "").trim();
    if (!tenantId) throw new PlatformConfigError("tenantId is required", "MISSING_TENANT");
    if (!name) throw new PlatformConfigError("Policy name is required", "INVALID_NAME");
    const rules = canonicalizeRules(raw.rules);
    return {
      tenantId,
      name,
      description: raw.description === undefined || raw.description === null ? null : String(raw.description).trim() || null,
      rules: rulesToMinorStrings(rules),
    };
  }
  const changes: Record<string, unknown> = {};
  if (raw.name !== undefined) {
    const name = String(raw.name ?? "").trim();
    if (!name) throw new PlatformConfigError("Policy name cannot be empty", "INVALID_NAME");
    changes.name = name;
  }
  if (raw.description !== undefined) changes.description = String(raw.description ?? "").trim() || null;
  if (raw.rules !== undefined) changes.rules = rulesToMinorStrings(canonicalizeRules(raw.rules));
  if (raw.active !== undefined) changes.active = Boolean(raw.active);
  if (raw.comment !== undefined) changes.comment = String(raw.comment ?? "").trim();
  if (Object.keys(changes).length === 0) throw new PlatformConfigError("Nothing to change", "EMPTY_CHANGE");
  return changes;
}

/* Feature-flag validation — the flags console only toggles enabled state. */
function validateFeatureFlag(op: PlatformConfigOp, raw: Record<string, unknown>): Record<string, unknown> {
  if (op === "create" || op === "delete") throw new PlatformConfigError("Only flag toggles are staged", "UNSUPPORTED_OP");
  if (typeof raw.enabled !== "boolean") throw new PlatformConfigError("enabled must be true or false", "INVALID_ENABLED");
  return { enabled: raw.enabled };
}

const VALIDATORS: Record<PlatformConfigKind, (op: PlatformConfigOp, raw: Record<string, unknown>) => Record<string, unknown>> = {
  biller: validateBiller,
  airtime: validateAirtime,
  fee_rule: validateFeeRule,
  approval_policy: validateApprovalPolicy,
  feature_flag: validateFeatureFlag,
};

/* ------------------------------------------------------------------ */
/* Apply cores — one per (kind, op). Each mirrors the exact row write  */
/* and audit event of the original direct-write route.                 */
/* ------------------------------------------------------------------ */

const KIND_META: Record<PlatformConfigKind, { resourceType: string; actions: Record<PlatformConfigOp, string> }> = {
  biller: {
    resourceType: "biller",
    actions: { create: "catalog.biller.create", update: "catalog.biller.update", delete: "catalog.biller.delete" },
  },
  airtime: {
    resourceType: "airtime_product",
    actions: { create: "catalog.airtime.create", update: "catalog.airtime.update", delete: "catalog.airtime.delete" },
  },
  fee_rule: {
    resourceType: "fee_rule",
    actions: { create: "pricing.rule.updated", update: "pricing.rule.updated", delete: "" },
  },
  approval_policy: {
    resourceType: "approval_policy",
    actions: { create: "approval.policy.create", update: "approval.policy.update", delete: "" },
  },
  feature_flag: {
    resourceType: "feature_flag",
    actions: { create: "", update: "feature_flag.updated", delete: "" },
  },
};

/** Allowed ops per kind — keeps the dispatch surface explicit. */
const KIND_OPS: Record<PlatformConfigKind, PlatformConfigOp[]> = {
  biller: ["create", "update", "delete"],
  airtime: ["create", "update", "delete"],
  fee_rule: ["create", "update"],
  approval_policy: ["create", "update"],
  feature_flag: ["update"],
};

async function applyBiller(db: Db, actor: { actorId: string; actorRole: string }, op: PlatformConfigOp, payload: Record<string, unknown>, targetId?: string): Promise<{ id: string }> {
  const audit = (rid: string | undefined, before?: unknown, after?: unknown) =>
    writeAuditEvent(db, {
      tenantId: PLATFORM_TENANT_ID,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: KIND_META.biller.actions[op],
      resourceType: KIND_META.biller.resourceType,
      resourceId: rid,
      before,
      after,
    });
  if (op === "create") {
    const [row] = await db.insert(schema.billers).values(payload as never).returning();
    if (!row) throw new PlatformConfigError("Could not create biller", "CREATE_FAILED");
    await audit(row.id, undefined, {
      code: row.code, name: row.name, category: row.category, channel: row.channel,
      accountNumber: row.accountNumber, enabled: row.enabled,
    });
    return { id: row.id };
  }
  if (!targetId) throw new PlatformConfigError("Missing target id", "TARGET_REQUIRED");
  const [existing] = await db.select().from(schema.billers).where(eq(schema.billers.id, targetId)).limit(1);
  if (!existing) throw new PlatformConfigError("Target row no longer exists (deleted after approval)", "APPLY_STALE");
  const before = { name: existing.name, category: existing.category, channel: existing.channel, accountNumber: existing.accountNumber, enabled: existing.enabled };
  if (op === "delete") {
    await db.delete(schema.billers).where(eq(schema.billers.id, existing.id));
    await audit(existing.id, { code: existing.code, name: existing.name }, undefined);
    return { id: existing.id };
  }
  const next = { ...before, ...payload };
  const [row] = await db.update(schema.billers).set({ ...next, updatedAt: new Date() } as never).where(eq(schema.billers.id, existing.id)).returning();
  if (!row) throw new PlatformConfigError("Biller update failed", "UPDATE_FAILED");
  await audit(existing.id, before, { ...next });
  return { id: row.id };
}

async function applyAirtime(db: Db, actor: { actorId: string; actorRole: string }, op: PlatformConfigOp, payload: Record<string, unknown>, targetId?: string): Promise<{ id: string }> {
  const audit = (rid: string | undefined, before?: unknown, after?: unknown) =>
    writeAuditEvent(db, {
      tenantId: PLATFORM_TENANT_ID,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: KIND_META.airtime.actions[op],
      resourceType: KIND_META.airtime.resourceType,
      resourceId: rid,
      before,
      after,
    });
  if (op === "create") {
    const [row] = await db.insert(schema.airtimeCatalog).values(payload as never).returning();
    if (!row) throw new PlatformConfigError("Could not create airtime product", "CREATE_FAILED");
    await audit(row.id, undefined, {
      providerCode: row.providerCode, network: row.network, productCode: row.productCode, name: row.name,
      type: row.type, denominationMinor: row.denominationMinor.toString(), enabled: row.enabled,
    });
    return { id: row.id };
  }
  if (!targetId) throw new PlatformConfigError("Missing target id", "TARGET_REQUIRED");
  const [existing] = await db.select().from(schema.airtimeCatalog).where(eq(schema.airtimeCatalog.id, targetId)).limit(1);
  if (!existing) throw new PlatformConfigError("Target row no longer exists (deleted after approval)", "APPLY_STALE");
  const before = { name: existing.name, type: existing.type, denominationMinor: existing.denominationMinor.toString(), enabled: existing.enabled };
  if (op === "delete") {
    await db.delete(schema.airtimeCatalog).where(eq(schema.airtimeCatalog.id, existing.id));
    await audit(existing.id, { providerCode: existing.providerCode, name: existing.name }, undefined);
    return { id: existing.id };
  }
  const next = { ...before, ...payload };
  const [row] = await db.update(schema.airtimeCatalog).set({ ...next, updatedAt: new Date() } as never).where(eq(schema.airtimeCatalog.id, existing.id)).returning();
  if (!row) throw new PlatformConfigError("Airtime update failed", "UPDATE_FAILED");
  await audit(existing.id, before, { ...next });
  return { id: row.id };
}


/* Fee-rule apply — mirrors the direct-write /api/admin/pricing POST exactly:
 * update bumps the row version and both paths append a feeVersions snapshot;
 * audit action is pricing.rule.updated (route parity). */
function toMinorText(v: unknown): bigint {
  const t = String(v ?? "0").trim();
  if (!/^(0|[1-9]\d*)$/.test(t)) throw new PlatformConfigError(`Invalid minor amount: ${t}`, "INVALID_AMOUNT");
  return BigInt(t);
}

async function applyFeeRule(db: Db, actor: { actorId: string; actorRole: string }, op: PlatformConfigOp, payload: Record<string, unknown>, targetId?: string): Promise<{ id: string }> {
  const audit = (rid: string | undefined, before?: unknown, after?: unknown) =>
    writeAuditEvent(db, {
      tenantId: PLATFORM_TENANT_ID,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: "pricing.rule.updated",
      resourceType: "fee_rule",
      resourceId: rid,
      before,
      after,
    });
  const comment = String(payload.changeComment ?? "Admin change");
  if (op === "create") {
    const [row] = await db
      .insert(schema.feeRules)
      .values({
        product: String(payload.product ?? ""),
        channel: String(payload.channel ?? ""),
        provider: String(payload.provider ?? "local-sandbox"),
        flatFeeMinor: toMinorText(payload.flatFeeMinor),
        percentBps: toMinorText(payload.percentBps),
        minFeeMinor: toMinorText(payload.minFeeMinor),
        maxFeeMinor: toMinorText(payload.maxFeeMinor),
        status: String(payload.status ?? "ACTIVE"),
        version: 1,
        changeComment: comment,
        createdById: actor.actorId,
      })
      .returning();
    if (!row) throw new PlatformConfigError("Could not create fee rule", "CREATE_FAILED");
    await db.insert(schema.feeVersions).values({
      feeRuleId: row.id,
      version: 1,
      snapshot: toJsonSafe(row) as Record<string, unknown>,
      changeComment: comment,
      createdById: actor.actorId,
    });
    await audit(row.id, undefined, toJsonSafe(payload));
    return { id: row.id };
  }
  if (!targetId) throw new PlatformConfigError("Missing target id", "TARGET_REQUIRED");
  const [existing] = await db.select().from(schema.feeRules).where(eq(schema.feeRules.id, targetId)).limit(1);
  if (!existing) throw new PlatformConfigError("Fee rule no longer exists (deleted after approval)", "APPLY_STALE");
  const version = (existing.version ?? 1) + 1;
  const next = {
    product: String(payload.product ?? existing.product),
    channel: String(payload.channel ?? existing.channel),
    provider: String(payload.provider ?? existing.provider),
    flatFeeMinor: toMinorText(payload.flatFeeMinor ?? existing.flatFeeMinor.toString()),
    percentBps: toMinorText(payload.percentBps ?? existing.percentBps.toString()),
    minFeeMinor: toMinorText(payload.minFeeMinor ?? existing.minFeeMinor.toString()),
    maxFeeMinor: toMinorText(payload.maxFeeMinor ?? existing.maxFeeMinor.toString()),
    status: String(payload.status ?? existing.status),
    version,
    changeComment: comment,
    createdById: actor.actorId,
  };
  const [row] = await db.update(schema.feeRules).set(next as never).where(eq(schema.feeRules.id, targetId)).returning();
  if (!row) throw new PlatformConfigError("Fee rule update failed", "UPDATE_FAILED");
  await db.insert(schema.feeVersions).values({
    feeRuleId: targetId,
    version,
    snapshot: toJsonSafe(row) as Record<string, unknown>,
    changeComment: comment,
    createdById: actor.actorId,
  });
  const feeBefore = {
    product: existing.product,
    channel: existing.channel,
    provider: existing.provider,
    flatFeeMinor: existing.flatFeeMinor.toString(),
    percentBps: existing.percentBps.toString(),
    minFeeMinor: existing.minFeeMinor.toString(),
    maxFeeMinor: existing.maxFeeMinor.toString(),
    status: existing.status,
    version: existing.version,
  };
  const feeAfter = {
    product: row.product,
    channel: row.channel,
    provider: row.provider,
    flatFeeMinor: row.flatFeeMinor.toString(),
    percentBps: row.percentBps.toString(),
    minFeeMinor: row.minFeeMinor.toString(),
    maxFeeMinor: row.maxFeeMinor.toString(),
    status: row.status,
    version: row.version,
  };
  await audit(targetId, feeBefore, feeAfter);
  return { id: targetId };
}

/* Approval-policy apply — mirrors the direct-write create POST and the
 * versioned PATCH: rule changes archive the CURRENT version (append-only
 * approval_policy_versions) and bump v→v+1; pause/activate only flip
 * `active`. The rulesChanged decision is made against the row AS FOUND at
 * apply time so queued changes never clobber each other. */
function storedRuleSig(r: Record<string, unknown>): string {
  const amt = (k: string) => {
    const v = r[k];
    if (v === undefined || v === null || v === "") return null;
    try {
      return BigInt(String(v)).toString();
    } catch {
      return String(v);
    }
  };
  return JSON.stringify({
    minAmountMinor: amt("minAmountMinor"),
    maxAmountMinor: amt("maxAmountMinor"),
    mode: r.mode ?? "ANY",
    requiredRoles: [...((r.requiredRoles as string[]) ?? [])].sort(),
    minApprovers: Math.max(1, Math.floor(Number(r.minApprovers ?? 1)) || 1),
  });
}

function payloadRulesChanged(dbRules: unknown, nextRules: unknown): boolean {
  const cur = (Array.isArray(dbRules) ? (dbRules as Record<string, unknown>[]) : []).map(storedRuleSig);
  const nxt = (Array.isArray(nextRules) ? (nextRules as Record<string, unknown>[]) : []).map(storedRuleSig);
  if (cur.length !== nxt.length) return true;
  return cur.some((x, i) => x !== nxt[i]);
}

async function applyApprovalPolicy(db: Db, actor: { actorId: string; actorRole: string }, op: PlatformConfigOp, payload: Record<string, unknown>, targetId?: string): Promise<{ id: string; version?: number; active?: boolean }> {
  const audit = (action: string, rid: string | undefined, before?: unknown, after?: unknown) =>
    writeAuditEvent(db, {
      tenantId: PLATFORM_TENANT_ID,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action,
      resourceType: "approval_policy",
      resourceId: rid,
      before,
      after,
    });
  const comment = String(payload.comment ?? "");
  if (op === "create") {
    const [row] = await db
      .insert(schema.approvalPolicies)
      .values({
        tenantId: String(payload.tenantId ?? ""),
        name: String(payload.name ?? ""),
        description: (payload.description as string | null) ?? null,
        rules: (payload.rules as Record<string, unknown>[]) ?? [],
        version: 1,
        active: true,
        createdById: actor.actorId,
      })
      .returning();
    if (!row) throw new PlatformConfigError("Could not create approval policy", "CREATE_FAILED");
    const rules = ((payload.rules as Record<string, unknown>[]) ?? []);
    await audit("approval.policy.create", row.id, undefined, {
      tenantId: row.tenantId,
      name: row.name,
      version: 1,
      ruleCount: rules.length,
    });
    return { id: row.id, version: 1, active: true };
  }
  if (!targetId) throw new PlatformConfigError("Missing target id", "TARGET_REQUIRED");
  const [policy] = await db.select().from(schema.approvalPolicies).where(eq(schema.approvalPolicies.id, targetId)).limit(1);
  if (!policy) throw new PlatformConfigError("Approval policy no longer exists (deleted after approval)", "APPLY_STALE");
  const currentRules = (Array.isArray(policy.rules) ? policy.rules : []) as Record<string, unknown>[];
  const rulesChanged = payload.rules !== undefined && payloadRulesChanged(policy.rules, payload.rules);
  const version = rulesChanged ? policy.version + 1 : policy.version;

  if (rulesChanged) {
    await db.insert(schema.approvalPolicyVersions).values({
      policyId: policy.id,
      version: policy.version,
      rulesSnapshot: toJsonSafe(policy.rules) as Record<string, unknown>,
      changeComment: comment || "Edited by platform admin",
      createdById: actor.actorId,
    });
  }
  const [row] = await db
    .update(schema.approvalPolicies)
    .set({
      name: payload.name !== undefined ? String(payload.name).trim() : policy.name,
      description: payload.description !== undefined ? (payload.description as string | null) : policy.description,
      ...(payload.rules !== undefined ? { rules: payload.rules as Record<string, unknown>[] } : {}),
      ...(payload.active !== undefined ? { active: Boolean(payload.active) } : {}),
      version,
      updatedAt: new Date(),
    })
    .where(eq(schema.approvalPolicies.id, policy.id))
    .returning();
  if (!row) throw new PlatformConfigError("Approval policy update failed", "UPDATE_FAILED");

  const action = rulesChanged
    ? "approval.policy.update"
    : payload.active !== undefined
      ? payload.active
        ? "approval.policy.activate"
        : "approval.policy.pause"
      : "approval.policy.update";
  const before = {
    name: policy.name,
    version: policy.version,
    ruleCount: currentRules.length,
    active: policy.active,
  };
  const afterRules = payload.rules !== undefined ? (payload.rules as Record<string, unknown>[]) : currentRules;
  await audit(action, policy.id, before, {
    name: row.name,
    version,
    ruleCount: afterRules.length,
    active: row.active,
  });
  return { id: policy.id, version, active: row.active };
}

/* Feature-flag apply — mirrors the flags console toggle. */
async function applyFeatureFlag(db: Db, actor: { actorId: string; actorRole: string }, op: PlatformConfigOp, payload: Record<string, unknown>, targetId?: string): Promise<{ id: string }> {
  if (op !== "update" || !targetId) throw new PlatformConfigError("Missing target id", "TARGET_REQUIRED");
  const [flag] = await db.select().from(schema.featureFlags).where(eq(schema.featureFlags.id, targetId)).limit(1);
  if (!flag) throw new PlatformConfigError("Feature flag no longer exists", "APPLY_STALE");
  const enabled = payload.enabled === true;
  const [row] = await db
    .update(schema.featureFlags)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(schema.featureFlags.id, flag.id))
    .returning();
  if (!row) throw new PlatformConfigError("Feature flag update failed", "UPDATE_FAILED");
  await writeAuditEvent(db, {
    tenantId: PLATFORM_TENANT_ID,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    action: "feature_flag.updated",
    resourceType: "feature_flag",
    resourceId: flag.id,
    before: { key: flag.key, enabled: flag.enabled },
    after: { key: flag.key, enabled },
  });
  return { id: flag.id };
}

const APPLY: Record<PlatformConfigKind, (db: Db, actor: { actorId: string; actorRole: string }, op: PlatformConfigOp, payload: Record<string, unknown>, targetId?: string) => Promise<{ id: string; version?: number; active?: boolean }>> = {
  biller: applyBiller,
  airtime: applyAirtime,
  fee_rule: applyFeeRule,
  approval_policy: applyApprovalPolicy,
  feature_flag: applyFeatureFlag,
};

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

const KIND_NOUN: Record<PlatformConfigKind, string> = {
  biller: "biller",
  airtime: "airtime product",
  fee_rule: "fee rule",
  approval_policy: "approval policy",
  feature_flag: "feature flag",
};

/** Human title of the affected row (used in labels when no payload name). */
function rowTitleFor(kind: PlatformConfigKind, row: Record<string, unknown> | null | undefined): string | undefined {
  if (!row) return undefined;
  if (kind === "fee_rule") {
    const p = String(row.product ?? "");
    const c = String(row.channel ?? "");
    return p || c ? `${p}${c ? ` · ${c}` : ""}` : undefined;
  }
  if (kind === "feature_flag") return String(row.key ?? "") || undefined;
  const name = row.name;
  return typeof name === "string" && name ? name : undefined;
}

const quote = (s?: string) => (s && s.trim() ? `“${s.trim()}”` : "");

function describeChange(kind: PlatformConfigKind, op: PlatformConfigOp, payload: Record<string, unknown>, rowTitle?: string): string {
  if (kind === "biller" || kind === "airtime") {
    const base = (typeof payload.name === "string" && payload.name ? payload.name : undefined)
      ?? (kind === "biller" && typeof payload.code === "string" && payload.code ? payload.code : undefined)
      ?? rowTitle;
    if (op === "create") return `create ${KIND_NOUN[kind]} ${quote(base)}`.replace(/\s+$/, "");
    if (op === "delete") return `delete ${KIND_NOUN[kind]} ${quote(base)}`.replace(/\s+$/, "");
    return `update ${KIND_NOUN[kind]} ${quote(base)}`.replace(/\s+$/, "");
  }
  if (kind === "fee_rule") {
    const p = typeof payload.product === "string" && payload.product ? payload.product : undefined;
    const c = typeof payload.channel === "string" && payload.channel ? payload.channel : undefined;
    const base = p && c ? `${p} · ${c}` : rowTitle;
    return op === "create"
      ? `create fee rule ${quote(base)}`.replace(/\s+$/, "")
      : `update fee rule ${quote(base)}`.replace(/\s+$/, "");
  }
  if (kind === "approval_policy") {
    if (op === "create") {
      const name = typeof payload.name === "string" ? payload.name : undefined;
      return `create approval policy ${quote(name)}`.replace(/\s+$/, "");
    }
    const base = rowTitle ?? (typeof payload.name === "string" ? payload.name : undefined);
    const verb =
      payload.active === false ? "pause"
      : payload.active === true ? "activate"
      : payload.rules !== undefined ? "edit rules of"
      : "update";
    return `${verb} approval policy ${quote(base)}`.replace(/\s+$/, "");
  }
  if (kind === "feature_flag") {
    const base = rowTitle ?? "";
    return `${payload.enabled ? "enable" : "disable"} feature flag ${quote(base)}`.replace(/\s+$/, "");
  }
  return `${op} ${KIND_NOUN[kind] ?? kind}`;
}

/** Per-kind target-row lookup (used for the staged snapshot + labels). */
async function fetchConfigTarget(db: Db, kind: PlatformConfigKind, targetId: string): Promise<Record<string, unknown> | null> {
  const [row] =
    kind === "biller"
      ? await db.select().from(schema.billers).where(eq(schema.billers.id, targetId)).limit(1)
      : kind === "airtime"
        ? await db.select().from(schema.airtimeCatalog).where(eq(schema.airtimeCatalog.id, targetId)).limit(1)
        : kind === "fee_rule"
          ? await db.select().from(schema.feeRules).where(eq(schema.feeRules.id, targetId)).limit(1)
          : kind === "approval_policy"
            ? await db.select().from(schema.approvalPolicies).where(eq(schema.approvalPolicies.id, targetId)).limit(1)
            : await db.select().from(schema.featureFlags).where(eq(schema.featureFlags.id, targetId)).limit(1);
  return row ? (toJsonSafe(row) as Record<string, unknown>) : null;
}

/**
 * Stage a platform configuration change for second-person approval.
 * The caller (a platform admin) is the maker; a different platform admin
 * must approve before anything is written.
 */
export async function createPlatformConfigChange(db: Db, input: PlatformConfigChangeInput): Promise<{ requestId: string; status: "PENDING"; label: string }> {
  if (!KIND_OPS[input.kind].includes(input.op)) {
    throw new PlatformConfigError(`${input.op} is not supported for ${KIND_NOUN[input.kind]} changes`, "UNSUPPORTED_OP");
  }
  // Full-form saves (the admin console reads a row back and PUTs all fields)
  // echo the immutable `code`. Tolerate an identical echo — refuse a change.
  let payload = input.payload;
  if (input.kind === "biller" && input.op === "update" && typeof payload.code === "string") {
    const [existing] = await db
      .select({ id: schema.billers.id, code: schema.billers.code })
      .from(schema.billers)
      .where(eq(schema.billers.id, input.targetId ?? ""))
      .limit(1);
    if (existing) {
      if (existing.code !== payload.code.trim().toLowerCase()) {
        throw new PlatformConfigError("Biller code cannot be changed", "CODE_IMMUTABLE");
      }
      payload = { ...payload };
      delete payload.code;
    }
  }
  const changes = VALIDATORS[input.kind](input.op, payload);
  if ((input.op === "update" || input.op === "delete") && !input.targetId) {
    throw new PlatformConfigError("Target id is required for update/delete", "TARGET_REQUIRED");
  }
  // Create pre-checks against LIVE rows only (staged duplicates resolve at
  // apply time via the same constraints the direct-write path used).
  if (input.op === "create" && input.kind === "biller") {
    const code = String(changes.code ?? "");
    const [dup] = await db.select({ id: schema.billers.id }).from(schema.billers).where(eq(schema.billers.code, code)).limit(1);
    if (dup) throw new PlatformConfigError(`Biller code "${code}" already exists`, "CODE_EXISTS");
  }
  if (input.op === "create" && input.kind === "approval_policy") {
    const tenantId = String(changes.tenantId ?? "");
    const [tenant] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    if (!tenant) throw new PlatformConfigError("Tenant not found", "TENANT_NOT_FOUND");
  }

  let beforeSnapshot: Record<string, unknown> | null = null;
  let rowTitle: string | undefined;
  if (input.targetId) {
    const row = await fetchConfigTarget(db, input.kind, input.targetId);
    if (!row) throw new PlatformConfigError("Target not found", "NOT_FOUND");
    beforeSnapshot = row;
    rowTitle = rowTitleFor(input.kind, row);
  }
  const label = input.label ?? describeChange(input.kind, input.op, changes, rowTitle);
  const summary = input.summary ?? `${label} — requires second platform-admin approval`;
  const metadata: PlatformConfigChangeMeta = {
    kind: input.kind,
    op: input.op,
    targetId: input.targetId,
    payload: changes,
    beforeSnapshot,
    label,
    summary,
  };

  // Always-match rule: platform config changes need one approval from a
  // distinct SUPER_ADMIN (maker ≠ checker enforced by the engine).
  const rules: ApprovalRule[] = [
    { minAmountMinor: 0n, mode: "ANY", requiredRoles: [PLATFORM_CONFIG_APPROVER_ROLE], minApprovers: 1, order: 0 },
  ];

  const { requestId } = await createApprovalRequest(db, {
    tenantId: PLATFORM_TENANT_ID,
    resourceType: "platform_config",
    resourceId: input.targetId,
    rules,
    context: { amountMinor: 0n, product: "platform.config", channel: "admin" },
    metadata: metadata as unknown as Record<string, unknown>,
    createdById: input.actorId,
  });
  return { requestId, status: "PENDING", label };
}

/** Read the staged change metadata back off a request row. */
export function parseConfigMeta(snapshot: unknown): PlatformConfigChangeMeta | null {
  const s = (snapshot ?? {}) as { metadata?: unknown };
  if (!s.metadata || typeof s.metadata !== "object") return null;
  const m = s.metadata as Partial<PlatformConfigChangeMeta>;
  if (!m.kind || !m.op) return null;
  return m as PlatformConfigChangeMeta;
}

/** Extract platform-config requests (any status) for the admin centre. */
export async function listPlatformConfigRequests(db: Db, status?: string, limit = 100) {
  const rows = await listApprovalRequests(db, { tenantId: PLATFORM_TENANT_ID, userId: "", status, limit });
  return rows
    .filter((r) => r.resourceType === "platform_config")
    .map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      createdById: r.createdById,
      executedAt: r.executedAt,
      executionError: r.executionError,
      change: parseConfigMeta(r.policySnapshot),
    }));
}

/**
 * Record a platform-admin decision. On APPROVE (final), the change is
 * applied here — under the approver's authority, never the maker's.
 */
export async function decidePlatformConfigChange(db: Db, input: PlatformConfigDecision) {
  const outcome = await recordApprovalAction(db, {
    requestId: input.requestId,
    actorId: input.actorId,
    actorRoles: input.actorRoles,
    decision: input.decision,
    comment: input.comment,
  });

  if (outcome.status !== "APPROVED") {
    return { ...outcome, applied: false as const };
  }

  const [request] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, input.requestId)).limit(1);
  const meta = request ? parseConfigMeta(request.policySnapshot) : null;
  if (!request || !meta) {
    throw new ApprovalError("Platform config request payload is missing", "SNAPSHOT_MISSING");
  }

  const actor = { actorId: input.actorId, actorRole: "platform_admin" };
  try {
    const applyFn = APPLY[meta.kind];
    if (!applyFn) {
      throw new PlatformConfigError(`Unsupported platform config kind: ${meta.kind}`, "UNSUPPORTED_KIND");
    }
    const result = await applyFn(db, actor, meta.op, meta.payload, meta.targetId);
    await db.update(schema.approvalRequests).set({ executedAt: new Date() }).where(eq(schema.approvalRequests.id, request.id));
    return { status: "APPROVED" as const, applied: true as const, requestId: request.id, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown apply error";
    const code = err instanceof PlatformConfigError ? err.code : "APPLY_FAILED";
    await db.update(schema.approvalRequests).set({ executionError: message }).where(eq(schema.approvalRequests.id, request.id));
    await writeAuditEvent(db, {
      tenantId: PLATFORM_TENANT_ID,
      actorId: input.actorId,
      actorRole: "platform_admin",
      action: "platform.config.apply_failed",
      resourceType: "platform_config_request",
      resourceId: request.id,
      after: { kind: meta.kind, op: meta.op, code, error: message },
    });
    return { status: "APPROVED" as const, applied: false as const, requestId: request.id, code, error: message };
  }
}
