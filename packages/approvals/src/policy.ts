/**
 * Approval policy evaluation — pure functions, no I/O.
 *
 * A policy is an ordered list of rules. The FIRST rule whose conditions match
 * the context determines the approval requirement for that payment:
 *   - SEQUENTIAL : levels are satisfied in order
 *   - PARALLEL   : any approver with the roles may act at any time
 *   - ANY        : minApprovers from the roles decide
 */

export interface ApprovalContext {
  amountMinor: bigint;
  product: string;
  channel: string;
  branchId?: string;
  departmentId?: string;
  riskFlags?: string[];
  /** Accumulated spend today in minor units (velocity checks). */
  accumulatedTodayMinor?: bigint;
}

export interface ApprovalRule {
  /** condition */
  minAmountMinor?: bigint;
  /** 0 / undefined = no upper bound */
  maxAmountMinor?: bigint;
  products?: string[]; // empty = all
  channels?: string[];
  branchIds?: string[];
  departmentIds?: string[];
  riskFlags?: string[]; // any-of
  /** requirement */
  mode: "SEQUENTIAL" | "PARALLEL" | "ANY";
  requiredRoles: string[];
  minApprovers: number;
  order: number;
}

export interface ApprovalStepRequirement {
  level: number;
  mode: "SEQUENTIAL" | "PARALLEL" | "ANY";
  roles: string[];
  minApprovers: number;
}

export class ApprovalPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalPolicyError";
  }
}

export function ruleMatches(rule: ApprovalRule, ctx: ApprovalContext): boolean {
  if (rule.minAmountMinor !== undefined && ctx.amountMinor < rule.minAmountMinor) return false;
  if (rule.maxAmountMinor && rule.maxAmountMinor > 0n && ctx.amountMinor > rule.maxAmountMinor) return false;
  if (rule.products && rule.products.length > 0 && !rule.products.includes(ctx.product)) return false;
  if (rule.channels && rule.channels.length > 0 && !rule.channels.includes(ctx.channel)) return false;
  if (rule.branchIds && rule.branchIds.length > 0 && (!ctx.branchId || !rule.branchIds.includes(ctx.branchId))) return false;
  if (rule.departmentIds && rule.departmentIds.length > 0 && (!ctx.departmentId || !rule.departmentIds.includes(ctx.departmentId)))
    return false;
  if (rule.riskFlags && rule.riskFlags.length > 0) {
    const flags = ctx.riskFlags ?? [];
    if (!rule.riskFlags.some((f) => flags.includes(f))) return false;
  }
  return true;
}

/**
 * Evaluate a policy against a context. Returns the approval step requirements,
 * or an empty array when no rule matches (no approval needed).
 * Rules are considered in `order` ascending; first match wins.
 */
export function evaluatePolicy(rules: ApprovalRule[], ctx: ApprovalContext): ApprovalStepRequirement[] {
  const ordered = [...rules].sort((a, b) => a.order - b.order);
  for (const rule of ordered) {
    if (ruleMatches(rule, ctx)) {
      const steps: ApprovalStepRequirement[] = [];
      // A SEQUENTIAL rule with N role-groups produces N levels; PARALLEL/ANY produce one level.
      if (rule.mode === "SEQUENTIAL" && rule.requiredRoles.length > 1) {
        rule.requiredRoles.forEach((roles, i) => {
          steps.push({ level: i + 1, mode: "SEQUENTIAL", roles: [roles], minApprovers: 1 });
        });
      } else {
        steps.push({ level: 1, mode: rule.mode, roles: rule.requiredRoles, minApprovers: rule.minApprovers });
      }
      return steps;
    }
  }
  return [];
}

export function validateRules(rules: ApprovalRule[]): void {
  for (const rule of rules) {
    if (!Array.isArray(rule.requiredRoles) || rule.requiredRoles.length === 0) {
      throw new ApprovalPolicyError("requiredRoles must not be empty");
    }
    if (rule.minApprovers < 1) throw new ApprovalPolicyError("minApprovers must be >= 1");
    if (rule.mode === "ANY" && rule.minApprovers > rule.requiredRoles.length) {
      throw new ApprovalPolicyError("ANY mode minApprovers cannot exceed the number of eligible roles");
    }
  }
}
