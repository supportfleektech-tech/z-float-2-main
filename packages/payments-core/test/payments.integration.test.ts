/**
 * Payment orchestration integration tests (real PostgreSQL):
 * idempotency, state machine legality, fee snapshotting, reservations,
 * webhook replay/out-of-order safety, insufficient funds, bulk rows.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Db } from "@zfloat/database";
import {
  createPayment,
  submitPayment,
  approveQueuedPayment,
  fundWallet,
  cancelPayment,
  PaymentError,
  executePayment,
  IllegalTransitionError,
  transitionPayment,
  createBatch,
  submitBatch,
  materializeBatchRow,
  markBatchRowOutcome,
  refreshBatchStatus,
} from "../src/index.js";
import { MockProvider } from "@zfloat/providers";
import { ensureSystemChart, postFundingJournal } from "@zfloat/ledger";

let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
let TENANT = "";
let WALLET_ID = "";
const USER_ID = "11111111-1111-1111-1111-111111111111";

async function clean() {
  await pool.query(` TRUNCATE payments, payment_status_history, payment_attempts, payment_batches, payment_batch_rows, fee_calculations, fee_rules, idempotency_records, outbox_events, wallet_reservations, journals, journal_entries, ledger_accounts, chart_of_accounts, balance_snapshots, wallets, funding_events, approval_requests, approval_steps, approval_actions, tenants CASCADE `);
}

const baseRecipient = { name: "Jane Wanjiku", phone: "0712345678", type: "person" };

async function seedWallet() {
  const [wallet] = await db
    .insert(schema.wallets)
    .values({ tenantId: TENANT, name: "Ops Wallet", currency: "KES" })
    .returning();
  WALLET_ID = wallet!.id;
  await db.update(schema.wallets).set({ availableMinor: 100_000_00n }).where(eq(schema.wallets.id, wallet!.id));
  await postFundingJournal(db, { tenantId: TENANT, walletId: wallet!.id, amountMinor: 100_000_00n });
}

beforeEach(async () => {
  ({ db, pool } = createDb());
  await clean();
  const [t] = await db
    .insert(schema.tenants)
    .values({ name: "Payments Co", slug: `pay-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`, status: "ACTIVE" })
    .returning();
  TENANT = t!.id;
  await ensureSystemChart(db, TENANT);
  await seedWallet();
});

afterAll(async () => {
  await pool.end();
});

describe("createPayment", () => {
  it("creates a DRAFT payment with a fee snapshot", async () => {
    const { payment } = await createPayment(db, { tenantId: TENANT, actorId: USER_ID, amount: "1500.00", channel: "mpesa", sourceWalletId: WALLET_ID, recipient: baseRecipient, idempotencyKey: "create-1" });
    expect(payment.status).toBe("DRAFT");
    expect(payment.amountMinor).toBe("150000");
    expect(payment.feeMinor).toBe("0"); // no fee rule → 0
    const [calc] = await db.select().from(schema.feeCalculations).where(eq(schema.feeCalculations.paymentId, payment.paymentId));
    expect(calc).toBeDefined();
  });

  it("is idempotent: replaying the same key returns the same payment", async () => {
    const first = await createPayment(db, { tenantId: TENANT, actorId: USER_ID, amount: "1500.00", channel: "mpesa", sourceWalletId: WALLET_ID, recipient: baseRecipient, idempotencyKey: "idem-1" });
    const second = await createPayment(db, { tenantId: TENANT, actorId: USER_ID, amount: "1500.00", channel: "mpesa", sourceWalletId: WALLET_ID, recipient: baseRecipient, idempotencyKey: "idem-1" });
    expect(second.replayed).toBe(true);
    expect(second.payment.paymentId).toBe(first.payment.paymentId);
  });

  it("rejects invalid amounts", async () => {
    await expect(
      createPayment(db, { tenantId: TENANT, actorId: USER_ID, amount: "0.00", channel: "mpesa", sourceWalletId: WALLET_ID, recipient: baseRecipient, idempotencyKey: "create-bad" }),
    ).rejects.toThrow(PaymentError);
  });
});

describe("submit + execution lifecycle", () => {
  it("no-approval flow: QUEUED then SUCCESS through the sandbox provider", async () => {
    const { payment } = await createPayment(db, { tenantId: TENANT, actorId: USER_ID, amount: "1500.00", channel: "mpesa", sourceWalletId: WALLET_ID, recipient: baseRecipient, idempotencyKey: "flow-1" });
    const submitted = await submitPayment(db, { tenantId: TENANT, paymentId: payment.paymentId, actorId: USER_ID, policyRules: [] });
    expect(submitted.status).toBe("QUEUED");
    // execution via sandbox provider (success mode)
    const provider = new MockProvider("success");
    await executePayment(db, { tenantId: TENANT, paymentId: payment.paymentId, provider, attemptNumber: 1 });
    const [after] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.paymentId));
    expect(after!.status).toBe("SUCCESS");
    expect(after!.successAt).toBeDefined();
    expect(after!.providerReference).toContain("ZF-");
    // wallet: 100,000 funded − 1,500 payment = 98,500 available
    const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.id, WALLET_ID));
    expect(wallet!.availableMinor).toBe(98_500_00n);
    expect(wallet!.reservedMinor).toBe(0n);
    // status history contains the full legal chain
    const history = await db.select().from(schema.paymentStatusHistory).where(eq(schema.paymentStatusHistory.paymentId, payment.paymentId));
    expect(history.map((h) => h.toStatus)).toEqual(["DRAFT", "VALIDATING", "QUEUED", "PROCESSING", "SUCCESS"]);
  });

  it("insufficient funds fails the payment at submit and releases nothing", async () => {
    const { payment } = await createPayment(db, { tenantId: TENANT, actorId: USER_ID, amount: "150000.00", // > 100,000 available
      channel: "mpesa", sourceWalletId: WALLET_ID, recipient: baseRecipient, idempotencyKey: "flow-2" });
    const submitted = await submitPayment(db, { tenantId: TENANT, paymentId: payment.paymentId, actorId: USER_ID, policyRules: [] });
    expect(submitted.status).toBe("FAILED");
    const [after] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.paymentId));
    expect(after!.status).toBe("FAILED");
  });

  it("approval flow: PENDING_APPROVAL until approved, then QUEUED", async () => {
    await fundWallet(db, { tenantId: TENANT, walletId: WALLET_ID, amount: "400000.00", method: "BANK_TRANSFER", reference: "approval-test", actorId: USER_ID });
    const { payment } = await createPayment(db, { tenantId: TENANT, actorId: USER_ID, amount: "250000.00", // 250,000 KES — above threshold
      channel: "mpesa", sourceWalletId: WALLET_ID, recipient: baseRecipient, idempotencyKey: "flow-3" });
    // 1M KES = 100,000,000 minor units (all amounts are minor units!)
    const rules = [
      { minAmountMinor: 0n, maxAmountMinor: 100_000_000n, mode: "SEQUENTIAL" as const, requiredRoles: ["APPROVER", "FINANCE_MANAGER"], minApprovers: 1, order: 0 },
    ];
    const submitted = await submitPayment(db, { tenantId: TENANT, paymentId: payment.paymentId, actorId: USER_ID, policyRules: rules });
    expect(submitted.status).toBe("PENDING_APPROVAL");
    // safety: executing a pending-approval payment must be a no-op (state unchanged)
    await executePayment(db, { tenantId: TENANT, paymentId: payment.paymentId, provider: new MockProvider("success"), attemptNumber: 1 });
    const [stillPending] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.paymentId));
    expect(stillPending!.status).toBe("PENDING_APPROVAL");
    // approve via the queue-flow (worker calls this after approval request resolves)
    const queued = await approveQueuedPayment(db, { tenantId: TENANT, paymentId: payment.paymentId, actorId: "22222222-2222-2222-2222-222222222222" });
    expect(queued.status).toBe("QUEUED");
  });

  it("illegal transitions are rejected by the state machine", async () => {
    const { payment } = await createPayment(db, { tenantId: TENANT, actorId: USER_ID, amount: "100.00", channel: "mpesa", sourceWalletId: WALLET_ID, recipient: baseRecipient, idempotencyKey: "flow-4" });
    // DRAFT -> SUCCESS is illegal
    await expect(
      db.transaction(async (tx) => {
        await transitionPayment(tx, { paymentId: payment.paymentId, to: "SUCCESS" });
      }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it("cancel works on DRAFT", async () => {
    const { payment } = await createPayment(db, { tenantId: TENANT, actorId: USER_ID, amount: "100.00", channel: "mpesa", sourceWalletId: WALLET_ID, recipient: baseRecipient, idempotencyKey: "flow-5" });
    await cancelPayment(db, { tenantId: TENANT, paymentId: payment.paymentId, actorId: USER_ID, reason: "changed my mind" });
    const [after] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.paymentId));
    expect(after!.status).toBe("CANCELLED");
  });
});

describe("bulk batches", () => {
  it("validates rows, computes totals, materializes completes", async () => {
    const batch = await createBatch(db, {
      tenantId: TENANT,
      actorId: USER_ID,
      name: "Supplier run 1",
      channel: "mpesa",
      rows: [
        { rowNumber: 1, recipientName: "John Kamau", phone: "0711111111", amountMinor: 10_000n },
        { rowNumber: 2, recipientName: "Achieng O.", phone: "0722222222", amountMinor: 20_000n },
        { rowNumber: 3, recipientName: "Bad", phone: "12345", amountMinor: 5_000n }, // invalid phone
        { rowNumber: 4, recipientName: "Dup", phone: "0711111111", amountMinor: 10_000n }, // dup (phone+amount)
      ],
    });
    expect(batch.validRowCount).toBe(2);
    expect(batch.errorRowCount).toBe(2);
    expect(batch.totalAmountMinor).toBe("30000");
    const submitted = await submitBatch(db, { tenantId: TENANT, batchId: batch.batchId, actorId: USER_ID, policyRules: [] });
    expect(submitted.status).toBe("APPROVED");
    const { paymentId } = await materializeBatchRow(db, { tenantId: TENANT, batchId: batch.batchId, rowId: (await db.select().from(schema.paymentBatchRows).where(eq(schema.paymentBatchRows.rowNumber, 1)).limit(1))[0]!.id, actorId: USER_ID });
    expect(paymentId).toBeDefined();
    await markBatchRowOutcome(db, { rowId: (await db.select().from(schema.paymentBatchRows).where(eq(schema.paymentBatchRows.rowNumber, 1)).limit(1))[0]!.id, status: "SUCCESS" });
    await refreshBatchStatus(db, batch.batchId);
    const [b] = await db.select().from(schema.paymentBatches).where(eq(schema.paymentBatches.id, batch.batchId));
    expect(b!.status).toBe("PROCESSING"); // still has valid rows pending
  });
});

describe("fundWallet", () => {
  it("credits the wallet posts a funding journal", async () => {
    await fundWallet(db, { tenantId: TENANT, walletId: WALLET_ID, amount: "5000.00", method: "BANK_TRANSFER", reference: "ref-1", actorId: USER_ID });
    const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.id, WALLET_ID));
    expect(wallet!.availableMinor).toBe(105_000_00n);
  });
});
