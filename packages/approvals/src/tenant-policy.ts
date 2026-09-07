/**
 * Runtime approval-policy resolution for money movement.
 *
 * Config-bug fix (maker-checker hardening): every submit path used to call
 * submitPayment/submitBatch with a hard-wired `policyRules: []`, which
 * silently disabled the approval gate even when a tenant had published a
 * policy. Rules are now resolved here, per tenant, at submit time:
 *
 *   - DEMO_MODE   → the built-in demo policy: payments above
 *                   DEMO_APPROVAL_THRESHOLD_MINOR (KES 10,000) require one
 *                   APPROVER sign-off; below it a single maker may proceed
 *                   (keeps the demo walkthrough one-person for ordinary
 *                   payments and shows maker-checker above the threshold).
 *   - PRODUCTION  → the tenant's ACTIVE published policy (admin Approval
 *                   policies console) is loaded and enforced. A tenant with
 *                   no active policy is refused money movement (fail closed)
 *                   until an owner publishes one.
 *
 * Stored rule shapes accepted (normalized): builder shape
 * `{ minAmount, maxAmount, mode, requiredRoles, minApprovers, order }`
 * (amounts in minor units, JSON string/number) and the legacy seed shape
 * `{ minAmountMinor, maxAmountMinor, ... }`.
 */
import { and, desc, eq } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";
import { validateRules, type ApprovalRule } from "./policy.js";

/** Demo maker-checker threshold: payments at/above KES 10,000 need sign-off. */
export const DEMO_APPROVAL_THRESHOLD_MINOR = 1_000_000n; // KES 10,000

/** Built-in demo policy (not tenant-configurable; demo mode only). */
export const DEMO_DEFAULT_RULES: ApprovalRule[] = [
  {
    minAmountMinor: DEMO_APPROVAL_THRESHOLD_MINOR,
    mode: "ANY",
    requiredRoles: ["APPROVER"],
    minApprovers: 1,
    order: 0,
  },
];

export function demoDefaultRules(): ApprovalRule[] {
  return DEMO_DEFAULT_RULES.map((r) => ({ ...r }));
}

function toMinorAmount(raw: unknown): bigint | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number") return BigInt(Math.round(raw));
  try {
    const s = String(raw).trim();
    return s ? BigInt(s) : undefined;
  } catch {
    return undefined;
  }
}

/** Normalize a stored policy rule (builder or legacy seed shape). */
export function normalizeStoredRule(raw: unknown, index: number): ApprovalRule {
  const r = (raw ?? {}) as Record<string, unknown>;
  const mode = r.mode === "SEQUENTIAL" || r.mode === "PARALLEL" ? r.mode : "ANY";
  const roles = Array.isArray(r.requiredRoles) ? r.requiredRoles.map(String).filter(Boolean) : [];
  const minApprovers = Math.max(1, Math.floor(Number(r.minApprovers ?? 1)) || 1);
  return {
    minAmountMinor: toMinorAmount(r.minAmountMinor ?? r.minAmount),
    maxAmountMinor: toMinorAmount(r.maxAmountMinor ?? r.maxAmount),
    mode,
    requiredRoles: roles,
    minApprovers,
    order: index,
  };
}

/** Load the tenant's currently active published policy rules (newest version). */
export async function loadTenantActivePolicyRules(db: Db, tenantId: string): Promise<ApprovalRule[] | null> {
  const [policy] = await db
    .select({ rules: schema.approvalPolicies.rules })
    .from(schema.approvalPolicies)
    .where(and(eq(schema.approvalPolicies.tenantId, tenantId), eq(schema.approvalPolicies.active, true)))
    .orderBy(desc(schema.approvalPolicies.version))
    .limit(1);
  if (!policy) return null;
  const arr = Array.isArray(policy.rules) ? (policy.rules as unknown[]) : [];
  if (arr.length === 0) return null;
  const rules = arr.map((r, i) => normalizeStoredRule(r, i));
  try {
    validateRules(rules);
  } catch {
    // A published-but-invalid policy must not silently disable the gate:
    // treat it as no policy so callers fail closed.
    return null;
  }
  return rules;
}
