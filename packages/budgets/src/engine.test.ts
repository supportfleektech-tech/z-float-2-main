import { describe, it, expect, vi } from "vitest";
import {
  BudgetError,
  InsufficientBudgetError,
  BudgetLimitExceededError,
} from "./engine";

// Mock the database module
vi.mock("@zfloat/database", () => ({
  schema: {
    budgets: {},
    budgetItems: {},
    spendLimits: {},
    pettyCashWallets: {},
    users: {},
    wallets: {},
    budgetSpendEvents: {},
  },
  and: vi.fn((...args) => args),
  eq: vi.fn((col, val) => ({ col, val })),
  gte: vi.fn((col, val) => ({ col, val })),
  lte: vi.fn((col, val) => ({ col, val })),
  desc: vi.fn((col) => ({ col })),
  inArray: vi.fn((col, vals) => ({ col, vals })),
  sql: vi.fn((strings, ...vals) => ({ strings, vals })),
}));

vi.mock("@zfloat/money", () => ({
  parseMinor: vi.fn((val) => BigInt(val)),
}));

vi.mock("@zfloat/approvals", () => ({
  createApprovalRequest: vi.fn(),
}));

vi.mock("@zfloat/notifications", () => ({
  queueNotification: vi.fn(),
}));

vi.mock("@zfloat/queue", () => ({
  enqueue: vi.fn(),
}));

describe("Budget Errors", () => {
  it("should create BudgetError with code", () => {
    const error = new BudgetError("Test error", "TEST_CODE");
    expect(error.message).toBe("Test error");
    expect(error.code).toBe("TEST_CODE");
    expect(error.name).toBe("BudgetError");
  });

  it("should create InsufficientBudgetError with details", () => {
    const error = new InsufficientBudgetError("Insufficient budget", "budget-123", 5000n);
    expect(error.message).toBe("Insufficient budget");
    expect(error.code).toBe("INSUFFICIENT_BUDGET");
    expect(error.budgetId).toBe("budget-123");
    expect(error.availableMinor).toBe(5000n);
    expect(error.name).toBe("InsufficientBudgetError");
  });

  it("should create BudgetLimitExceededError with details", () => {
    const error = new BudgetLimitExceededError("Limit exceeded", "budget-123", 10000n, 12000n);
    expect(error.message).toBe("Limit exceeded");
    expect(error.code).toBe("BUDGET_LIMIT_EXCEEDED");
    expect(error.budgetId).toBe("budget-123");
    expect(error.limitMinor).toBe(10000n);
    expect(error.spentMinor).toBe(12000n);
    expect(error.name).toBe("BudgetLimitExceededError");
  });
});