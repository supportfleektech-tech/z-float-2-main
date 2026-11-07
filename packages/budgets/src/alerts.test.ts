import { describe, it, expect, vi } from "vitest";
import { formatAmount } from "./alerts";
import type {
  BudgetAlertResult,
  SpendLimitAlertResult,
  PettyCashAlertResult,
} from "./alerts";

describe("Budget Alerts", () => {
  describe("formatAmount", () => {
    it("should format zero amount", () => {
      expect(formatAmount(0n)).toBe("Ksh\u00A00.00");
    });

    it("should format amount in minor units (cents) - truncates to major", () => {
      expect(formatAmount(100n)).toBe("Ksh\u00A01.00");
      expect(formatAmount(12345n)).toBe("Ksh\u00A0123.00"); // integer division truncates
      expect(formatAmount(1000000n)).toBe("Ksh\u00A010,000.00");
    });

    it("should handle large amounts", () => {
      expect(formatAmount(1234567890123n)).toBe("Ksh\u00A012,345,678,901.00");
    });

    it("should use Kenyan locale formatting", () => {
      expect(formatAmount(1234567n)).toBe("Ksh\u00A012,345.00");
    });
  });

  describe("BudgetAlertResult type", () => {
    it("should allow valid budget alert result", () => {
      const result: BudgetAlertResult = {
        budgetId: "budget-123",
        budgetName: "Monthly Budget",
        budgetItemId: "item-456",
        category: "travel",
        usagePct: 85.5,
        threshold: 80,
        alertSent: true,
      };
      expect(result.budgetId).toBe("budget-123");
      expect(result.usagePct).toBe(85.5);
      expect(result.threshold).toBe(80);
      expect(result.alertSent).toBe(true);
    });

    it("should allow budget alert without budgetItemId", () => {
      const result: BudgetAlertResult = {
        budgetId: "budget-123",
        budgetName: "Monthly Budget",
        category: "travel",
        usagePct: 95.0,
        threshold: 90,
        alertSent: false,
      };
      expect(result.budgetItemId).toBeUndefined();
      expect(result.alertSent).toBe(false);
    });
  });

  describe("SpendLimitAlertResult type", () => {
    it("should allow valid spend limit alert result", () => {
      const result: SpendLimitAlertResult = {
        spendLimitId: "limit-123",
        entityType: "BRANCH",
        entityId: "branch-456",
        category: "travel",
        usagePct: 88.0,
        threshold: 80,
        alertSent: true,
      };
      expect(result.spendLimitId).toBe("limit-123");
      expect(result.entityType).toBe("BRANCH");
      expect(result.category).toBe("travel");
      expect(result.alertSent).toBe(true);
    });

    it("should allow spend limit alert with null category", () => {
      const result: SpendLimitAlertResult = {
        spendLimitId: "limit-123",
        entityType: "DEPARTMENT",
        entityId: "dept-456",
        category: null,
        usagePct: 92.0,
        threshold: 90,
        alertSent: false,
      };
      expect(result.category).toBeNull();
    });
  });

  describe("PettyCashAlertResult type", () => {
    it("should allow valid petty cash alert result", () => {
      const result: PettyCashAlertResult = {
        pettyCashWalletId: "pcw-123",
        employeeId: "emp-456",
        period: "daily",
        usagePct: 87.5,
        threshold: 80,
        alertSent: true,
      };
      expect(result.pettyCashWalletId).toBe("pcw-123");
      expect(result.period).toBe("daily");
      expect(result.alertSent).toBe(true);
    });

    it("should allow monthly period", () => {
      const result: PettyCashAlertResult = {
        pettyCashWalletId: "pcw-123",
        employeeId: "emp-456",
        period: "monthly",
        usagePct: 95.0,
        threshold: 90,
        alertSent: false,
      };
      expect(result.period).toBe("monthly");
    });
  });
});