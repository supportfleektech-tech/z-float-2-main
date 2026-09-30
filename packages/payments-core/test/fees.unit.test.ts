import { describe, it, expect, vi } from "vitest";
import { computeFee } from "../src/fees.js";

// Mock database that returns fee rules
function mockDbWithRules(rules: any[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(rules),
          }),
        }),
      }),
    }),
  } as any;
}

const mockCtx = { tenantId: "test-tenant" };

describe("computeFee — banded flat fees", () => {
  it("charges KES 10 for M-PESA payment ≤ KES 1,000", async () => {
    const rules = [{
      product: "single_payment",
      channel: "mpesa",
      provider: "mpesa-safaricom",
      amountMinorMin: null,
      amountMinorMax: 100000n,
      flatFeeMinor: 1000n,
      percentBps: 0,
      minFeeMinor: 0n,
      maxFeeMinor: 0n,
      status: "ACTIVE",
      tenantId: null,
    }];
    const db = mockDbWithRules(rules);
    const result = await computeFee(db, 100000n, mockCtx);
    expect(result.feeMinor).toBe(1000n);
  });

  it("charges KES 25 for M-PESA payment > KES 1,000", async () => {
    const rules = [
      {
        product: "single_payment",
        channel: "mpesa",
        provider: "mpesa-safaricom",
        amountMinorMin: null,
        amountMinorMax: 100000n,
        flatFeeMinor: 1000n,
        percentBps: 0,
        minFeeMinor: 0n,
        maxFeeMinor: 0n,
        status: "ACTIVE",
        tenantId: null,
      },
      {
        product: "single_payment",
        channel: "mpesa",
        provider: "mpesa-safaricom",
        amountMinorMin: 100001n,
        amountMinorMax: null,
        flatFeeMinor: 2500n,
        percentBps: 0,
        minFeeMinor: 0n,
        maxFeeMinor: 0n,
        status: "ACTIVE",
        tenantId: null,
      },
    ];
    const db = mockDbWithRules(rules);
    const result = await computeFee(db, 100100n, mockCtx);
    expect(result.feeMinor).toBe(2500n);
  });

  it("charges KES 30 for paybill/till payment (any amount)", async () => {
    const rules = [{
      product: "single_payment",
      channel: "till",
      provider: "local-sandbox",
      amountMinorMin: null,
      amountMinorMax: null,
      flatFeeMinor: 3000n,
      percentBps: 0,
      minFeeMinor: 0n,
      maxFeeMinor: 0n,
      status: "ACTIVE",
      tenantId: null,
    }];
    const db = mockDbWithRules(rules);
    const result = await computeFee(db, 500000n, mockCtx);
    expect(result.feeMinor).toBe(3000n);
  });

  it("charges KES 35 for bank transfer (any amount)", async () => {
    const rules = [{
      product: "single_payment",
      channel: "bank",
      provider: "local-sandbox",
      amountMinorMin: null,
      amountMinorMax: null,
      flatFeeMinor: 3500n,
      percentBps: 0,
      minFeeMinor: 0n,
      maxFeeMinor: 0n,
      status: "ACTIVE",
      tenantId: null,
    }];
    const db = mockDbWithRules(rules);
    const result = await computeFee(db, 500000n, mockCtx);
    expect(result.feeMinor).toBe(3500n);
  });

  it("charges KES 20 for payroll (any amount)", async () => {
    const rules = [{
      product: "payroll",
      channel: "mpesa",
      provider: "local-sandbox",
      amountMinorMin: null,
      amountMinorMax: null,
      flatFeeMinor: 2000n,
      percentBps: 0,
      minFeeMinor: 0n,
      maxFeeMinor: 0n,
      status: "ACTIVE",
      tenantId: null,
    }];
    const db = mockDbWithRules(rules);
    const result = await computeFee(db, 2000000n, mockCtx);
    expect(result.feeMinor).toBe(2000n);
  });

  it("charges KES 0 for airtime (any amount)", async () => {
    const rules = [{
      product: "airtime",
      channel: "airtime",
      provider: "local-sandbox",
      amountMinorMin: null,
      amountMinorMax: null,
      flatFeeMinor: 0n,
      percentBps: 0,
      minFeeMinor: 0n,
      maxFeeMinor: 0n,
      status: "ACTIVE",
      tenantId: null,
    }];
    const db = mockDbWithRules(rules);
    const result = await computeFee(db, 50000n, mockCtx);
    expect(result.feeMinor).toBe(0n);
  });
});
