import { describe, it, expect } from "vitest";
import {
  BudgetContext,
  BudgetRule,
  BudgetPolicyError,
  budgetRuleMatches,
  evaluateBudgetRules,
  validateBudgetRules,
} from "./policy";

describe("Budget Policy Evaluation", () => {
  describe("budgetRuleMatches", () => {
    it("should return true for matching rule with no conditions", () => {
      const rule: BudgetRule = { action: "WARN", order: 1 };
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel" };
      expect(budgetRuleMatches(rule, ctx)).toBe(true);
    });

    it("should match when amount is within range", () => {
      const rule: BudgetRule = { action: "WARN", order: 1, minAmountMinor: 500n, maxAmountMinor: 2000n };
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel" };
      expect(budgetRuleMatches(rule, ctx)).toBe(true);
    });

    it("should not match when amount is below minimum", () => {
      const rule: BudgetRule = { action: "WARN", order: 1, minAmountMinor: 500n };
      const ctx: BudgetContext = { amountMinor: 100n, category: "travel" };
      expect(budgetRuleMatches(rule, ctx)).toBe(false);
    });

    it("should not match when amount is above maximum", () => {
      const rule: BudgetRule = { action: "WARN", order: 1, maxAmountMinor: 500n };
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel" };
      expect(budgetRuleMatches(rule, ctx)).toBe(false);
    });

    it("should match when category is in allowed list", () => {
      const rule: BudgetRule = { action: "WARN", order: 1, categories: ["travel", "meals"] };
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel" };
      expect(budgetRuleMatches(rule, ctx)).toBe(true);
    });

    it("should not match when category is not in allowed list", () => {
      const rule: BudgetRule = { action: "WARN", order: 1, categories: ["travel"] };
      const ctx: BudgetContext = { amountMinor: 1000n, category: "office" };
      expect(budgetRuleMatches(rule, ctx)).toBe(false);
    });

    it("should match when subCategory is in allowed list", () => {
      const rule: BudgetRule = { action: "WARN", order: 1, subCategories: ["flight", "hotel"] };
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel", subCategory: "flight" };
      expect(budgetRuleMatches(rule, ctx)).toBe(true);
    });

    it("should not match when subCategory is not in allowed list", () => {
      const rule: BudgetRule = { action: "WARN", order: 1, subCategories: ["flight"] };
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel", subCategory: "hotel" };
      expect(budgetRuleMatches(rule, ctx)).toBe(false);
    });

    it("should match when branchId is in allowed list", () => {
      const rule: BudgetRule = { action: "WARN", order: 1, branchIds: ["branch-1", "branch-2"] };
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel", branchId: "branch-1" };
      expect(budgetRuleMatches(rule, ctx)).toBe(true);
    });

    it("should not match when branchId is not in allowed list", () => {
      const rule: BudgetRule = { action: "WARN", order: 1, branchIds: ["branch-1"] };
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel", branchId: "branch-2" };
      expect(budgetRuleMatches(rule, ctx)).toBe(false);
    });

    it("should not match when branchId is required but not provided", () => {
      const rule: BudgetRule = { action: "WARN", order: 1, branchIds: ["branch-1"] };
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel" };
      expect(budgetRuleMatches(rule, ctx)).toBe(false);
    });

    it("should match when departmentId is in allowed list", () => {
      const rule: BudgetRule = { action: "WARN", order: 1, departmentIds: ["dept-1"] };
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel", departmentId: "dept-1" };
      expect(budgetRuleMatches(rule, ctx)).toBe(true);
    });

    it("should match when employeeId is in allowed list", () => {
      const rule: BudgetRule = { action: "WARN", order: 1, employeeIds: ["emp-1"] };
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel", employeeId: "emp-1" };
      expect(budgetRuleMatches(rule, ctx)).toBe(true);
    });

    it("should require all conditions to match", () => {
      const rule: BudgetRule = {
        action: "WARN",
        order: 1,
        minAmountMinor: 500n,
        categories: ["travel"],
        branchIds: ["branch-1"],
      };
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel", branchId: "branch-1" };
      expect(budgetRuleMatches(rule, ctx)).toBe(true);
    });

    it("should fail if any condition fails", () => {
      const rule: BudgetRule = {
        action: "WARN",
        order: 1,
        minAmountMinor: 500n,
        categories: ["travel"],
        branchIds: ["branch-1"],
      };
      const ctx: BudgetContext = { amountMinor: 1000n, category: "meals", branchId: "branch-1" };
      expect(budgetRuleMatches(rule, ctx)).toBe(false);
    });
  });

  describe("evaluateBudgetRules", () => {
    it("should return empty array when no rules", () => {
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel" };
      expect(evaluateBudgetRules([], ctx)).toEqual([]);
    });

    it("should return first matching rule by order", () => {
      const rules: BudgetRule[] = [
        { action: "BLOCK", order: 2, categories: ["travel"] },
        { action: "WARN", order: 1, categories: ["travel"] },
      ];
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel" };
      const result = evaluateBudgetRules(rules, ctx);
      expect(result).toHaveLength(1);
      expect(result[0].action).toBe("WARN");
    });

    it("should skip non-matching rules", () => {
      const rules: BudgetRule[] = [
        { action: "BLOCK", order: 1, categories: ["office"] },
        { action: "WARN", order: 2, categories: ["travel"] },
      ];
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel" };
      const result = evaluateBudgetRules(rules, ctx);
      expect(result).toHaveLength(1);
      expect(result[0].action).toBe("WARN");
    });

    it("should return budget requirement with all fields", () => {
      const rules: BudgetRule[] = [
        {
          action: "REQUIRE_APPROVAL",
          order: 1,
          categories: ["travel"],
          budgetId: "budget-123",
          spendLimitId: "limit-456",
          pettyCashWalletId: "wallet-789",
        },
      ];
      const ctx: BudgetContext = { amountMinor: 1000n, category: "travel" };
      const result = evaluateBudgetRules(rules, ctx);
      expect(result[0]).toEqual({
        budgetId: "budget-123",
        spendLimitId: "limit-456",
        pettyCashWalletId: "wallet-789",
        action: "REQUIRE_APPROVAL",
      });
    });
  });

  describe("validateBudgetRules", () => {
    it("should not throw for valid actions", () => {
      const rules: BudgetRule[] = [
        { action: "WARN", order: 1 },
        { action: "BLOCK", order: 2 },
        { action: "REQUIRE_APPROVAL", order: 3 },
      ];
      expect(() => validateBudgetRules(rules)).not.toThrow();
    });

    it("should throw for invalid action", () => {
      const rules: BudgetRule[] = [{ action: "INVALID" as any, order: 1 }];
      expect(() => validateBudgetRules(rules)).toThrow("Invalid action: INVALID");
    });

    it("should throw for first invalid action in list", () => {
      const rules: BudgetRule[] = [
        { action: "WARN", order: 1 },
        { action: "INVALID" as any, order: 2 },
      ];
      expect(() => validateBudgetRules(rules)).toThrow("Invalid action: INVALID");
    });
  });

  describe("BudgetPolicyError", () => {
    it("should create error with message", () => {
      const error = new BudgetPolicyError("Test error");
      expect(error.message).toBe("Test error");
      expect(error.name).toBe("BudgetPolicyError");
    });
  });
});