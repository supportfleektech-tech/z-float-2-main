import { describe, it, expect } from "vitest";
import { evaluatePolicy, needsApproval, validateRules, ApprovalPolicyError } from "../src/index.js";

const tieredRules = [
  {
    minAmountMinor: 0n,
    maxAmountMinor: 10_000n, // 100.00 KES
    mode: "ANY" as const,
    requiredRoles: ["APPROVER"],
    minApprovers: 1,
    order: 0,
  },
  {
    minAmountMinor: 10_001n,
    maxAmountMinor: 1_000_000n, // 10,000.00 KES
    mode: "SEQUENTIAL" as const,
    requiredRoles: ["APPROVER", "FINANCE_MANAGER"],
    minApprovers: 1,
    order: 1,
  },
  {
    minAmountMinor: 1_000_001n,
    mode: "SEQUENTIAL" as const,
    requiredRoles: ["APPROVER", "FINANCE_MANAGER", "OWNER"],
    minApprovers: 1,
    order: 2,
  },
];

const baseCtx = { amountMinor: 500n, product: "single_payment", channel: "mpesa" };

describe("evaluatePolicy", () => {
  it("returns no steps when no rule matches", () => {
    expect(evaluatePolicy([], baseCtx)).toEqual([]);
  });

  it("applies the ANY rule for small amounts", () => {
    const steps = evaluatePolicy(tieredRules, baseCtx);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ mode: "ANY", roles: ["APPROVER"], minApprovers: 1 });
  });

  it("applies the sequential two-level rule for medium amounts", () => {
    const steps = evaluatePolicy(tieredRules, { ...baseCtx, amountMinor: 500_000n });
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ level: 1, roles: ["APPROVER"] });
    expect(steps[1]).toMatchObject({ level: 2, roles: ["FINANCE_MANAGER"] });
  });

  it("applies the highest tier for large amounts", () => {
    const steps = evaluatePolicy(tieredRules, { ...baseCtx, amountMinor: 5_000_000n });
    expect(steps).toHaveLength(3);
    expect(steps[2]).toMatchObject({ level: 3, roles: ["OWNER"] });
  });

  it("honours channel and branch conditions", () => {
    const rules = [
      {
        minAmountMinor: 0n,
        channels: ["bank"] as string[],
        mode: "ANY" as const,
        requiredRoles: ["FINANCE_MANAGER"],
        minApprovers: 1,
        order: 0,
      },
    ];
    expect(needsApproval(rules, { ...baseCtx, channel: "mpesa" })).toBe(false);
    expect(needsApproval(rules, { ...baseCtx, channel: "bank" })).toBe(true);
  });

  it("honours risk flags", () => {
    const rules = [
      {
        minAmountMinor: 0n,
        riskFlags: ["NEW_BENEFICIARY"] as string[],
        mode: "ANY" as const,
        requiredRoles: ["APPROVER"],
        minApprovers: 1,
        order: 0,
      },
    ];
    expect(needsApproval(rules, baseCtx)).toBe(false);
    expect(needsApproval(rules, { ...baseCtx, riskFlags: ["NEW_BENEFICIARY"] })).toBe(true);
  });

  it("first matching rule wins regardless of order value", () => {
    const rules = [
      { minAmountMinor: 100n, mode: "ANY" as const, requiredRoles: ["APPROVER"], minApprovers: 1, order: 5 },
      { minAmountMinor: 0n, mode: "ANY" as const, requiredRoles: ["OWNER"], minApprovers: 1, order: 1 },
    ];
    const steps = evaluatePolicy(rules, { amountMinor: 500n, product: "x", channel: "mpesa" });
    expect(steps[0]!.roles).toEqual(["OWNER"]);
  });

  it("rejects invalid rules", () => {
    expect(() =>
      validateRules([{ minAmountMinor: 0n, mode: "ANY", requiredRoles: [], minApprovers: 1, order: 0 }]),
    ).toThrow(ApprovalPolicyError);
    expect(() =>
      validateRules([{ minAmountMinor: 0n, mode: "ANY", requiredRoles: ["A"], minApprovers: 2, order: 0 }]),
    ).toThrow(ApprovalPolicyError);
  });
});
