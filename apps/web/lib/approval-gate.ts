/**
 * Route-level approval-policy resolution for every money-movement submit.
 *
 * Fixes the maker-checker config hole where submit paths passed an empty rule
 * set (`policyRules: []`), silently bypassing the approval gate. Rules are
 * resolved here per tenant at submit time:
 *  - demo mode            → built-in demo policy (above KES 10,000 → APPROVER)
 *  - production (no demo) → the tenant's ACTIVE published policy; a tenant
 *    with no published policy is refused money movement (fail closed).
 */
import type { Db } from "@zfloat/database";
import { demoDefaultRules, loadTenantActivePolicyRules } from "@zfloat/approvals";
import type { ApprovalRule } from "@zfloat/approvals";
import { getConfig } from "@zfloat/config";

export type ResolvedSubmitPolicy =
  | { ok: true; rules: ApprovalRule[]; source: "demo-default" | "tenant-policy" }
  | { ok: false; code: string; message: string };

export const APPROVAL_POLICY_REQUIRED_CODE = "APPROVAL_POLICY_REQUIRED";

export async function resolveApprovalRulesForSubmit(db: Db, tenantId: string): Promise<ResolvedSubmitPolicy> {
  if (getConfig().DEMO_MODE) {
    return { ok: true, rules: demoDefaultRules(), source: "demo-default" };
  }
  const rules = await loadTenantActivePolicyRules(db, tenantId);
  if (!rules || rules.length === 0) {
    return {
      ok: false,
      code: APPROVAL_POLICY_REQUIRED_CODE,
      message:
        "No active approval policy is published for this workspace — money movement is blocked until an owner publishes one in the Approval policies console.",
    };
  }
  return { ok: true, rules, source: "tenant-policy" };
}
