/**
 * Maker-checker hardening (payee book, reversals) — integration tests
 * against real PostgreSQL:
 *  1. Registering a payee only creates it PENDING + raises an approval
 *     request; the maker cannot approve their own request; an independent
 *     checker's approval activates the payee (rejection leaves it REJECTED).
 *  2. Funds movement to a non-activated payee is refused (PAYEE_NOT_APPROVED),
 *     both at the gate and through submitPayment when a payment references it.
 *  3. Requesting a reversal only raises an approval request; the funds move
 *     (provider + compensating journal) only after an independent checker's
 *     approval executes the reversal; reject leaves the payment untouched.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Db } from "@zfloat/database";
import {
  createPayment,
  submitPayment,
  executePayment,
  registerBeneficiary,
  activateBeneficiary,
  rejectBeneficiary,
  assertPayeeApproved,
  requestReversalApproval,
  executeApprovedReversal,
  BeneficiaryError,
  ReversalError,
} from "../src/index.js";
import { recordApprovalAction, ApprovalError } from "@zfloat/approvals";
import { MockProvider } from "@zfloat/providers";
import { ensureSystemChart, postFundingJournal } from "@zfloat/ledger";

let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
let TENANT = "";
let WALLET_ID = "";

const CHECKER = { id: "99999999-9999-9999-9999-999999999999", roles: ["APPROVER", "FINANCE_MANAGER", "OWNER"] };
const MAKER = { id: "11111111-1111-1111-1111-111111111111", roles: ["MAKER"] };

async function clean() {
  await pool.query(
    `TRUNCATE beneficiaries, approval_actions, approval_steps, approval_requests,
     reversals, payments, payment_status_history, payment_attempts, payment_batches,
     payment_batch_rows, fee_calculations, fee_rules, idempotency_records, outbox_events,
     wallet_reservations, journals, journal_entries, ledger_accounts, chart_of_accounts,
     balance_snapshots, wallets, funding_events, tenants CASCADE`,
  );
}

async function seedWallet() {
  const [wallet] = await db
    .insert(schema.wallets)
    .values({ tenantId: TENANT, name: "Ops Wallet", currency: "KES" })
    .returning();
  WALLET_ID = wallet!.id;
  await db.update(schema.wallets).set({ availableMinor: 100_000_00n }).where(eq(schema.wallets.id, wallet!.id));
  await postFundingJournal(db, { tenantId: TENANT, walletId: wallet!.id, amountMinor: 100_000_00n });
}

async function makeSuccessfulPayment(): Promise<{ id: string; amountMinor: bigint }> {
  const { payment } = await createPayment(db, {
    tenantId: TENANT,
    actorId: MAKER.id,
    amount: "2500.00",
    channel: "mpesa",
    product: "single_payment",
    sourceWalletId: WALLET_ID,
    recipient: { name: "Jane Wanjiku", phone: "0712345678" },
    idempotencyKey: `mc-${crypto.randomUUID()}`,
  });
  await submitPayment(db, { tenantId: TENANT, paymentId: payment.paymentId, actorId: MAKER.id, policyRules: [] });
  await executePayment(db, { tenantId: TENANT, paymentId: payment.paymentId, provider: new MockProvider("success"), attemptNumber: 1 });
  const [row] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.paymentId)).limit(1);
  expect(row!.status).toBe("SUCCESS");
  return { id: row!.id, amountMinor: BigInt(row!.amountMinor) };
}

beforeEach(async () => {
  ({ db, pool } = createDb());
  await clean();
  const [t] = await db
    .insert(schema.tenants)
    .values({ name: "Controls Co", slug: `ctl-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`, status: "ACTIVE" })
    .returning();
  TENANT = t!.id;
  await ensureSystemChart(db, TENANT);
  await seedWallet();
});

afterAll(async () => {
  await pool.end();
});

describe("payee-book maker-checker", () => {
  it("registers a payee as PENDING with an approval request; maker cannot self-approve; checker activates it", async () => {
    const { beneficiaryId, approvalRequestId } = await registerBeneficiary(db, {
      tenantId: TENANT,
      createdById: MAKER.id,
      name: "New Payee",
      phone: "0712345678",
    });

    const [ben] = await db.select().from(schema.beneficiaries).where(eq(schema.beneficiaries.id, beneficiaryId)).limit(1);
    expect(ben!.status).toBe("PENDING");

    const [req] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, approvalRequestId)).limit(1);
    expect(req!.resourceType).toBe("beneficiary");
    expect(req!.resourceId).toBe(beneficiaryId);

    // maker cannot approve their own payee
    await expect(
      recordApprovalAction(db, { requestId: approvalRequestId, actorId: MAKER.id, actorRoles: CHECKER.roles, decision: "APPROVE" }),
    ).rejects.toMatchObject({ code: "MAKER_CHECKER_VIOLATION" });

    // independent checker approves → activation is the checker step
    const outcome = await recordApprovalAction(db, {
      requestId: approvalRequestId,
      actorId: CHECKER.id,
      actorRoles: CHECKER.roles,
      decision: "APPROVE",
    });
    expect(outcome.status).toBe("APPROVED");

    // dispatch-level activation (idempotent)
    await activateBeneficiary(db, { tenantId: TENANT, beneficiaryId, actorId: CHECKER.id });
    await activateBeneficiary(db, { tenantId: TENANT, beneficiaryId, actorId: CHECKER.id });
    const [after] = await db.select().from(schema.beneficiaries).where(eq(schema.beneficiaries.id, beneficiaryId)).limit(1);
    expect(after!.status).toBe("ACTIVE");
    await expect(assertPayeeApproved(db, { tenantId: TENANT, beneficiaryId })).resolves.toBeUndefined();
  });

  it("rejection leaves the payee REJECTED and funds movement to it is refused", async () => {
    const { beneficiaryId, approvalRequestId } = await registerBeneficiary(db, {
      tenantId: TENANT,
      createdById: MAKER.id,
      name: "Suspicious Payee",
    });
    const outcome = await recordApprovalAction(db, {
      requestId: approvalRequestId,
      actorId: CHECKER.id,
      actorRoles: CHECKER.roles,
      decision: "REJECT",
    });
    expect(outcome.status).toBe("REJECTED");
    await rejectBeneficiary(db, { tenantId: TENANT, beneficiaryId, actorId: CHECKER.id });

    const [ben] = await db.select().from(schema.beneficiaries).where(eq(schema.beneficiaries.id, beneficiaryId)).limit(1);
    expect(ben!.status).toBe("REJECTED");
    await expect(assertPayeeApproved(db, { tenantId: TENANT, beneficiaryId })).rejects.toMatchObject({
      code: "PAYEE_NOT_APPROVED",
    });
  });

  it("submitPayment refuses a payment that references a non-activated payee", async () => {
    const { beneficiaryId } = await registerBeneficiary(db, {
      tenantId: TENANT,
      createdById: MAKER.id,
      name: "Pending Payee",
    });
    const { payment } = await createPayment(db, {
      tenantId: TENANT,
      actorId: MAKER.id,
      amount: "500.00",
      channel: "mpesa",
      product: "single_payment",
      sourceWalletId: WALLET_ID,
      recipient: { name: "Pending Payee", phone: "0712345678" },
      idempotencyKey: `mc-${crypto.randomUUID()}`,
    });
    await db.update(schema.payments).set({ beneficiaryId }).where(eq(schema.payments.id, payment.paymentId));

    await expect(
      submitPayment(db, { tenantId: TENANT, paymentId: payment.paymentId, actorId: MAKER.id, policyRules: [] }),
    ).rejects.toMatchObject({ code: "PAYEE_NOT_APPROVED" });

    // after an approver activates the payee, the same payment can be submitted
    const [firstReq] = await db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.resourceId, beneficiaryId))
      .limit(1);
    await recordApprovalAction(db, { requestId: firstReq!.id, actorId: CHECKER.id, actorRoles: CHECKER.roles, decision: "APPROVE" });
    await activateBeneficiary(db, { tenantId: TENANT, beneficiaryId, actorId: CHECKER.id });

    const submitted = await submitPayment(db, {
      tenantId: TENANT,
      paymentId: payment.paymentId,
      actorId: MAKER.id,
      policyRules: [],
    });
    expect(submitted.status).toBe("QUEUED");
  });
});

describe("reversal maker-checker", () => {
  it("requesting a reversal only raises an approval request; funds move only after an independent approval", async () => {
    const payment = await makeSuccessfulPayment();
    const walletBefore = (await db.select().from(schema.wallets).where(eq(schema.wallets.id, WALLET_ID)).limit(1))[0]!;

    const gate = await requestReversalApproval(db, {
      tenantId: TENANT,
      paymentId: payment.id,
      actorId: MAKER.id,
      reason: "Duplicate charge",
    });
    expect(gate.status).toBe("APPROVAL_PENDING");

    const [req] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, gate.approvalRequestId)).limit(1);
    expect(req!.resourceType).toBe("reversal");
    expect(req!.resourceId).toBe(payment.id);

    // no funds moved yet
    const [still] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id)).limit(1);
    expect(still!.status).toBe("SUCCESS");
    expect((await db.select().from(schema.wallets).where(eq(schema.wallets.id, WALLET_ID)).limit(1))[0]!.availableMinor).toBe(walletBefore.availableMinor);

    // maker cannot approve their own reversal
    await expect(
      recordApprovalAction(db, { requestId: gate.approvalRequestId, actorId: MAKER.id, actorRoles: CHECKER.roles, decision: "APPROVE" }),
    ).rejects.toMatchObject({ code: "MAKER_CHECKER_VIOLATION" });

    const outcome = await recordApprovalAction(db, {
      requestId: gate.approvalRequestId,
      actorId: CHECKER.id,
      actorRoles: CHECKER.roles,
      decision: "APPROVE",
    });
    expect(outcome.status).toBe("APPROVED");

    // dispatch-level execution (approver authority)
    const executed = await executeApprovedReversal(db, {
      tenantId: TENANT,
      paymentId: payment.id,
      actorId: CHECKER.id,
      reason: "Duplicate charge",
      provider: new MockProvider("success"),
    });
    expect(executed.status).toBe("REVERSED");

    const [reversed] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id)).limit(1);
    expect(reversed!.status).toBe("REVERSED");
    expect(reversed!.reversalReason).toBe("Duplicate charge");
    const [rev] = await db.select().from(schema.reversals).where(eq(schema.reversals.paymentId, payment.id)).limit(1);
    expect(rev!.status).toBe("PROCESSED");

    // compensating journal returned the principal to the wallet
    const walletAfter = (await db.select().from(schema.wallets).where(eq(schema.wallets.id, WALLET_ID)).limit(1))[0]!;
    expect(walletAfter.availableMinor).toBe(walletBefore.availableMinor);

    // idempotent replay
    await expect(
      executeApprovedReversal(db, {
        tenantId: TENANT,
        paymentId: payment.id,
        actorId: CHECKER.id,
        reason: "Duplicate charge",
        provider: new MockProvider("success"),
      }),
    ).resolves.toMatchObject({ status: "REVERSED" });
  });

  it("rejecting a reversal request leaves the payment untouched", async () => {
    const payment = await makeSuccessfulPayment();
    const gate = await requestReversalApproval(db, {
      tenantId: TENANT,
      paymentId: payment.id,
      actorId: MAKER.id,
      reason: "Customer changed mind",
    });
    const outcome = await recordApprovalAction(db, {
      requestId: gate.approvalRequestId,
      actorId: CHECKER.id,
      actorRoles: CHECKER.roles,
      decision: "REJECT",
    });
    expect(outcome.status).toBe("REJECTED");

    const [paymentRow] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id)).limit(1);
    expect(paymentRow!.status).toBe("SUCCESS");
    const [rev] = await db.select().from(schema.reversals).where(eq(schema.reversals.paymentId, payment.id)).limit(1);
    expect(rev).toBeUndefined();
  });

  it("maker-time validation rejects payments that cannot be reversed", async () => {
    const { payment } = await createPayment(db, {
      tenantId: TENANT,
      actorId: MAKER.id,
      amount: "1000.00",
      channel: "mpesa",
      product: "single_payment",
      sourceWalletId: WALLET_ID,
      recipient: { name: "Draft", phone: "0712345678" },
      idempotencyKey: `mc-${crypto.randomUUID()}`,
    });
    await expect(
      requestReversalApproval(db, { tenantId: TENANT, paymentId: payment.paymentId, actorId: MAKER.id, reason: "nope" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("error surface", () => {
  it("exposes typed errors for gate consumers", () => {
    expect(new BeneficiaryError("x", "PAYEE_NOT_APPROVED").code).toBe("PAYEE_NOT_APPROVED");
    expect(new ReversalError("x", "INVALID_STATE").code).toBe("INVALID_STATE");
    expect(new ApprovalError("x", "MAKER_CHECKER_VIOLATION").code).toBe("MAKER_CHECKER_VIOLATION");
  });
});
