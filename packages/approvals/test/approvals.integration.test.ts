/**
 * Approval lifecycle integration tests against real PostgreSQL:
 * maker-checker, sequential levels, parallel/any modes, duplicate actions,
 * role mismatch, rejection short-circuit.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Db } from "@zfloat/database";
import {
  createApprovalRequest,
  recordApprovalAction,
  ApprovalError,
} from "../src/index.js";
import type { ApprovalRule } from "../src/index.js";

let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
let TENANT = "";

const sequentialRules: ApprovalRule[] = [
  {
    minAmountMinor: 0n,
    mode: "SEQUENTIAL",
    requiredRoles: ["APPROVER", "FINANCE_MANAGER"],
    minApprovers: 1,
    order: 0,
  },
];

const anyRule: ApprovalRule[] = [
  { minAmountMinor: 0n, mode: "ANY", requiredRoles: ["APPROVER", "FINANCE_MANAGER"], minApprovers: 1, order: 0 },
];

async function clean() {
  await pool.query(
    `TRUNCATE approval_actions, approval_steps, approval_requests, approval_delegations, users, tenants CASCADE`,
  );
}

async function makeUser(name: string) {
  const [u] = await db
    .insert(schema.users)
    .values({ tenantId: TENANT, email: `${name.toLowerCase()}@test.co.ke`, fullName: name, status: "ACTIVE" })
    .returning();
  return u!;
}

async function makePayment() {
  const [p] = await db
    .insert(schema.payments)
    .values({
      tenantId: TENANT,
      paymentNumber: `ZF-APR-${crypto.randomUUID().slice(0, 8)}`,
      channel: "mpesa",
      amountMinor: 500_000n,
      totalMinor: 500_000n,
      beneficiarySnapshot: { name: "Test" },
    })
    .returning();
  return p!;
}

beforeEach(async () => {
  ({ db, pool } = createDb());
  await clean();
  const [t] = await db
    .insert(schema.tenants)
    .values({ name: "Approvals Co", slug: `apr-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`, status: "ACTIVE" })
    .returning();
  TENANT = t!.id;
});

afterAll(async () => {
  await pool.end();
});

describe("approval request lifecycle", () => {
  it("sequential: needs APPROVER then FINANCE_MANAGER; FINANCE_MANAGER cannot jump the queue", async () => {
    const maker = await makeUser("Maker");
    const approver = await makeUser("Approver");
    const finMgr = await makeUser("FinMgr");

    const { requestId } = await createApprovalRequest(db, {
      tenantId: TENANT,
      paymentId: (await makePayment()).id,
      rules: sequentialRules,
      context: { amountMinor: 500_000n, product: "single_payment", channel: "mpesa" },
      createdById: maker.id,
    });

    // FINANCE_MANAGER tries to approve first — must fail (sequential)
    await expect(
      recordApprovalAction(db, {
        requestId,
        actorId: finMgr.id,
        actorRoles: ["FINANCE_MANAGER"],
        decision: "APPROVE",
      }),
    ).rejects.toThrow(/no approval step is currently actionable|role/i);

    // maker cannot approve own payment
    await expect(
      recordApprovalAction(db, {
        requestId,
        actorId: maker.id,
        actorRoles: ["APPROVER"],
        decision: "APPROVE",
      }),
    ).rejects.toThrow(ApprovalError);

    // approver approves level 1
    const r1 = await recordApprovalAction(db, {
      requestId,
      actorId: approver.id,
      actorRoles: ["APPROVER"],
      decision: "APPROVE",
    });
    expect(r1.status).toBe("PARTIALLY_APPROVED");

    // approver cannot approve twice
    await expect(
      recordApprovalAction(db, {
        requestId,
        actorId: approver.id,
        actorRoles: ["APPROVER"],
        decision: "APPROVE",
      }),
    ).rejects.toThrow(/already acted/i);

    // role mismatch: another approver acting as FINANCE_MANAGER level is fine here
    const r2 = await recordApprovalAction(db, {
      requestId,
      actorId: finMgr.id,
      actorRoles: ["FINANCE_MANAGER"],
      decision: "APPROVE",
    });
    expect(r2.status).toBe("APPROVED");
  });

  it("ANY: one approval from either role resolves the request", async () => {
    const maker = await makeUser("Maker2");
    const approver = await makeUser("Approver2");
    const { requestId } = await createApprovalRequest(db, {
      tenantId: TENANT,
      paymentId: (await makePayment()).id,
      rules: anyRule,
      context: { amountMinor: 5_000n, product: "single_payment", channel: "mpesa" },
      createdById: maker.id,
    });
    const res = await recordApprovalAction(db, {
      requestId,
      actorId: approver.id,
      actorRoles: ["APPROVER"],
      decision: "APPROVE",
    });
    expect(res.status).toBe("APPROVED");
  });

  it("rejection short-circuits the whole request", async () => {
    const maker = await makeUser("Maker3");
    const approver = await makeUser("Approver3");
    const { requestId } = await createApprovalRequest(db, {
      tenantId: TENANT,
      paymentId: (await makePayment()).id,
      rules: sequentialRules,
      context: { amountMinor: 500_000n, product: "single_payment", channel: "mpesa" },
      createdById: maker.id,
    });
    const res = await recordApprovalAction(db, {
      requestId,
      actorId: approver.id,
      actorRoles: ["APPROVER"],
      decision: "REJECT",
      comment: "beneficiary details suspect",
    });
    expect(res.status).toBe("REJECTED");
    const [req] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, requestId));
    expect(req!.status).toBe("REJECTED");
  });

  it("role mismatch is rejected", async () => {
    const maker = await makeUser("Maker4");
    const viewer = await makeUser("Viewer4");
    const { requestId } = await createApprovalRequest(db, {
      tenantId: TENANT,
      paymentId: (await makePayment()).id,
      rules: anyRule,
      context: { amountMinor: 5_000n, product: "single_payment", channel: "mpesa" },
      createdById: maker.id,
    });
    await expect(
      recordApprovalAction(db, {
        requestId,
        actorId: viewer.id,
        actorRoles: ["VIEWER"],
        decision: "APPROVE",
      }),
    ).rejects.toThrow(/role/i);
  });
});
