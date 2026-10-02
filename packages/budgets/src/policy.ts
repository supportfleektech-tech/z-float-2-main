/**
 * Budget policy evaluation — pure functions, no I/O.
 *
 * Budget rules determine spend limits and approval requirements.
 * Rules are evaluated in order; first match wins.
 */

export interface BudgetContext {
  amountMinor: bigint;
  category: string;
  subCategory?: string;
  branchId?: string;
  departmentId?: string;
  employeeId?: string;
}

export interface BudgetRule {
  /** Conditions */
  minAmountMinor?: bigint;
  maxAmountMinor?: bigint; // 0 / undefined = no upper bound
  categories?: string[]; // empty = all
  subCategories?: string[];
  branchIds?: string[];
  departmentIds?: string[];
  employeeIds?: string[];
  /** Requirements */
  budgetId?: string; // specific budget to check
  spendLimitId?: string; // specific spend limit to check
  pettyCashWalletId?: string; // specific petty cash wallet to check
  action: "WARN" | "BLOCK" | "REQUIRE_APPROVAL";
  order: number;
}

export interface BudgetRequirement {
  budgetId?: string;
  budgetItemId?: string;
  spendLimitId?: string;
  pettyCashWalletId?: string;
  action: "WARN" | "BLOCK" | "REQUIRE_APPROVAL";
}

export class BudgetPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetPolicyError";
  }
}

export function budgetRuleMatches(rule: BudgetRule, ctx: BudgetContext): boolean {
  if (rule.minAmountMinor !== undefined && ctx.amountMinor < rule.minAmountMinor) return false;
  if (rule.maxAmountMinor && rule.maxAmountMinor > 0n && ctx.amountMinor > rule.maxAmountMinor) return false;
  if (rule.categories && rule.categories.length > 0 && !rule.categories.includes(ctx.category)) return false;
  if (rule.subCategories && rule.subCategories.length > 0 && ctx.subCategory && !rule.subCategories.includes(ctx.subCategory)) return false;
  if (rule.branchIds && rule.branchIds.length > 0 && (!ctx.branchId || !rule.branchIds.includes(ctx.branchId))) return false;
  if (rule.departmentIds && rule.departmentIds.length > 0 && (!ctx.departmentId || !rule.departmentIds.includes(ctx.departmentId))) return false;
  if (rule.employeeIds && rule.employeeIds.length > 0 && (!ctx.employeeId || !rule.employeeIds.includes(ctx.employeeId))) return false;
  return true;
}

/**
 * Evaluate budget rules against a context. Returns the requirements,
 * or an empty array when no rule matches.
 * Rules are considered in `order` ascending; first match wins.
 */
export function evaluateBudgetRules(rules: BudgetRule[], ctx: BudgetContext): BudgetRequirement[] {
  const ordered = [...rules].sort((a, b) => a.order - b.order);
  for (const rule of ordered) {
    if (budgetRuleMatches(rule, ctx)) {
      return [{
        budgetId: rule.budgetId,
        spendLimitId: rule.spendLimitId,
        pettyCashWalletId: rule.pettyCashWalletId,
        action: rule.action,
      }];
    }
  }
  return [];
}

export function validateBudgetRules(rules: BudgetRule[]): void {
  for (const rule of rules) {
    if (!["WARN", "BLOCK", "REQUIRE_APPROVAL"].includes(rule.action)) {
      throw new BudgetPolicyError(`Invalid action: ${rule.action}`);
    }
  }
}