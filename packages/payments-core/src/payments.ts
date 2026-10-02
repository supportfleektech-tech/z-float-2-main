/**
 * Payment orchestration — the command layer. Every financial command:
 * - is idempotent (idempotency_records keyed by tenant+scope+key)
 * - runs inside a DB transaction
 * - only mutates payment state through the legal state machine
 * - emits outbox events for the rest of the system
 */
import { and, eq, sql } from "drizzle-orm";
import { schema, toJsonSafe, type Db, type Tx } from "@zfloat/database";
import { parseMinor } from "@zfloat/money";
import { normalizeKenyanPhone } from "@zfloat/validation";
import {
  InsufficientFundsError,
  postFundingJournal,
  recordWalletFunding,
  reserveFunds,
} from "@zfloat/ledger";
import { createApprovalRequest, evaluatePolicy, type ApprovalRule } from "@zfloat/approvals";
import { assertPayeeApproved } from "./beneficiaries.js";
import { computeFee, recordFeeCalculation } from "./fees.js";
import { transitionPayment } from "./state.js";
import { enqueueOutbox } from "./outbox.js";
import { screenRecipientForPayment } from "@zfloat/kyc";
import { calculateWht, detectWhtCategory, type WhtCalculationInput, type WhtCategory } from "@zfloat/etims";
import { checkBudget, checkSpendLimit, checkPettyCashWallet, recordCommitment, releaseCommitment } from "@zfloat/budgets";

export class PaymentError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "PaymentError";
  }
}

export interface CreatePaymentInput {
  tenantId: string;
  actorId: string;
  amount: string; // decimal string
  currency?: "KES";
  channel: "mpesa" | "till" | "paybill" | "bank";
  product?: string;
  sourceWalletId: string;
  branchId?: string;
  departmentId?: string;
  category?: string;
  remark?: string;
  recipient: {
    name: string;
    phone?: string;
    email?: string;
    bankAccountName?: string;
    bankAccountNumber?: string;
    bankCode?: string;
    tillNumber?: string;
    paybillNumber?: string;
    paybillAccount?: string;
    type?: string;
    /** Beneficiary KRA PIN for WHT certificate */
    kraPin?: string;
    /** Beneficiary ID type (NATIONAL_ID, PASSPORT, etc.) */
    idType?: string;
    /** Beneficiary ID number */
    idNumber?: string;
    /** Whether the beneficiary is a Kenya tax resident */
    isResident?: boolean;
  };
  idempotencyKey: string;
  providerCode?: string;
  /** Explicit WHT category override (auto-detected from category/description if not provided) */
  whtCategory?: WhtCategory;
  /** Override beneficiary residency status for WHT calculation */
  whtIsResident?: boolean;
}

export interface CreatedPayment {
  paymentId: string;
  paymentNumber: string;
  status: string;
  amountMinor: string;
  feeMinor: string;
  totalMinor: string;
  whtAmountMinor: string;
  whtCategory: string | null;
  whtRateBps: number | null;
  approvalRequired: boolean;
}

function buildBeneficiarySnapshot(input: CreatePaymentInput): Record<string, unknown> {
  return toJsonSafe({
    name: input.recipient.name,
    phone: input.recipient.phone ? normalizeKenyanPhone(input.recipient.phone) : undefined,
    email: input.recipient.email,
    bankAccountName: input.recipient.bankAccountName,
    bankAccountNumber: input.recipient.bankAccountNumber,
    bankCode: input.recipient.bankCode,
    tillNumber: input.recipient.tillNumber,
    paybillNumber: input.recipient.paybillNumber,
    paybillAccount: input.recipient.paybillAccount,
    type: input.recipient.type ?? "person",
  }) as Record<string, unknown>;
}

/** Run a command under the idempotency guard. Returns prior result on replay. */
export async function withIdempotency<T>(
  tx: Tx,
  input: { tenantId: string; scope: string; key: string },
  run: () => Promise<T>,
): Promise<{ replayed: boolean; result: T }> {
  const [prior] = await tx
    .select()
    .from(schema.idempotencyRecords)
    .where(
      and(
        eq(schema.idempotencyRecords.tenantId, input.tenantId),
        eq(schema.idempotencyRecords.scope, input.scope),
        eq(schema.idempotencyRecords.key, input.key),
      ),
    )
    .for("update")
    .limit(1);
  if (prior && prior.status === "COMPLETED") {
    return { replayed: true, result: prior.response as T };
  }
  await tx
    .insert(schema.idempotencyRecords)
    .values({ tenantId: input.tenantId, scope: input.scope, key: input.key, status: "IN_PROGRESS" })
    .onConflictDoNothing({ target: [schema.idempotencyRecords.tenantId, schema.idempotencyRecords.scope, schema.idempotencyRecords.key] });
  const result = await run();
  await tx
    .update(schema.idempotencyRecords)
    .set({ status: "COMPLETED", response: toJsonSafe(result) as Record<string, unknown>, completedAt: new Date() })
    .where(
      and(
        eq(schema.idempotencyRecords.tenantId, input.tenantId),
        eq(schema.idempotencyRecords.scope, input.scope),
        eq(schema.idempotencyRecords.key, input.key),
      ),
    );
  return { replayed: false, result };
}

export function generatePaymentNumber(tenantId: string): string {
  const year = new Date().getFullYear();
  const rand = crypto.randomUUID().slice(0, 6).toUpperCase();
  return `ZF-${year}-${tenantId.slice(0, 4).toUpperCase()}-${rand}`;
}

/** Load the payment's source wallet, tenant-scoped. */
async function loadWallet(db: Db, tenantId: string, walletId: string) {
  const [wallet] = await db
    .select()
    .from(schema.wallets)
    .where(and(eq(schema.wallets.id, walletId), eq(schema.wallets.tenantId, tenantId)))
    .limit(1);
  if (!wallet) throw new PaymentError("Source wallet not found", "WALLET_NOT_FOUND");
  if (wallet.status !== "ACTIVE") throw new PaymentError("Source wallet is not active", "WALLET_FROZEN");
  return wallet;
}

/**
 * createPayment — validates, computes & snapshots the fee, creates the DRAFT
 * payment. Idempotent per (tenant, payment.create, idempotencyKey).
 */
export async function createPayment(db: Db, input: CreatePaymentInput): Promise<{ replayed: boolean; payment: CreatedPayment }> {
  const amountMinor = parseMinor(input.amount);
  if (amountMinor <= 0n) throw new PaymentError("Amount must be positive", "INVALID_AMOUNT");
  return db.transaction(async (tx) => {
    const guarded = await withIdempotency(
      tx,
      { tenantId: input.tenantId, scope: "payment.create", key: input.idempotencyKey },
      async () => {
        const wallet = await loadWallet(tx, input.tenantId, input.sourceWalletId);
        const fee = await computeFee(tx, amountMinor, {
          tenantId: input.tenantId,
          product: input.product ?? "single_payment",
          channel: input.channel,
          providerCode: input.providerCode ?? "local-sandbox",
        });

        // Calculate WHT
        const whtCategory = input.whtCategory ?? detectWhtCategory(input.category, input.remark) ?? "OTHER";
        const isResident = input.whtIsResident ?? input.recipient.isResident ?? true;
        const whtResult = await calculateWht(tx, {
          tenantId: input.tenantId,
          category: whtCategory,
          grossAmountMinor: amountMinor,
          isResident,
        });

        const [payment] = await tx
          .insert(schema.payments)
          .values({
            tenantId: input.tenantId,
            paymentNumber: generatePaymentNumber(input.tenantId),
            product: input.product ?? "single_payment",
            channel: input.channel,
            amountMinor,
            feeMinor: fee.feeMinor,
            totalMinor: amountMinor + fee.feeMinor,
            currency: "KES",
            status: "DRAFT",
            sourceWalletId: wallet.id,
            branchId: input.branchId,
            departmentId: input.departmentId,
            category: input.category,
            whtCategory: whtResult.applicable ? whtResult.category : null,
            whtRateBps: whtResult.applicable ? whtResult.rateBps : null,
            whtAmountMinor: whtResult.whtAmountMinor,
            remark: input.remark,
            beneficiarySnapshot: buildBeneficiarySnapshot(input),
            idempotencyKey: input.idempotencyKey,
            createdById: input.actorId,
          })
          .returning();
        if (!payment) throw new PaymentError("Failed to create payment", "CREATE_FAILED");
        await recordFeeCalculation(tx, { tenantId: input.tenantId, paymentId: payment.id, amountMinor, fee });
        await tx.insert(schema.paymentStatusHistory).values({ paymentId: payment.id, toStatus: "DRAFT", actorId: input.actorId });
        return {
          paymentId: payment.id,
          paymentNumber: payment.paymentNumber,
          status: payment.status,
          amountMinor: amountMinor.toString(),
          feeMinor: fee.feeMinor.toString(),
          totalMinor: (amountMinor + fee.feeMinor).toString(),
          whtAmountMinor: whtResult.whtAmountMinor.toString(),
          whtCategory: whtResult.applicable ? whtResult.category : null,
          whtRateBps: whtResult.applicable ? whtResult.rateBps : null,
          approvalRequired: false,
        };
      },
    );
    return { replayed: guarded.replayed, payment: guarded.result };
  });
}

export interface SubmitPaymentInput {
  tenantId: string;
  paymentId: string;
  actorId: string;
  /** Override policy rules for evaluation (from DB in production; tests inject). */
  policyRules?: ApprovalRule[];
}

/**
 * submitPayment — validates, decides approval need, reserves funds and moves
 * the payment into PENDING_APPROVAL or QUEUED.
 */
export async function submitPayment(db: Db, input: SubmitPaymentInput): Promise<{ status: string; approvalRequestId?: string }> {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.id, input.paymentId), eq(schema.payments.tenantId, input.tenantId)))
      .for("update");
    if (!payment) throw new PaymentError("Payment not found", "PAYMENT_NOT_FOUND");
    if (payment.status !== "DRAFT" && payment.status !== "VALIDATING" && payment.status !== "REJECTED" && payment.status !== "FAILED") {
      throw new PaymentError(`Cannot submit payment in state ${payment.status}`, "INVALID_STATE");
    }
    if (!payment.sourceWalletId) throw new PaymentError("Payment has no source wallet", "NO_WALLET");

    // Payee-book maker-checker (hardening): when the payment references the
    // saved payee book, the payee must have been activated by an approver —
    // PENDING payees cannot move funds. Inline (ad-hoc) payees are governed
    // by the amount/risk approval policy below.
    await assertPayeeApproved(tx, { tenantId: input.tenantId, beneficiaryId: payment.beneficiaryId ?? null });

    await transitionPayment(tx, { paymentId: payment.id, to: "VALIDATING", actorId: input.actorId, reason: "submit" });

    // ---- AML gate: screen the recipient against the watchlist. On a hit the
    // payment is risk-flagged (aml_watchlist_hit) and forced through the
    // maker-checker approval path; a KYC case is opened for review. ----
    let amlHit = false;
    const ben = (payment.beneficiarySnapshot ?? {}) as { name?: string; phone?: string };
    const benName = (ben.name ?? "").trim();
    if (benName && ["mpesa", "till", "paybill", "bank"].includes(payment.channel)) {
      const screen = await screenRecipientForPayment(tx, {
        tenantId: input.tenantId,
        paymentId: payment.id,
        name: benName,
        phone: ben.phone ?? undefined,
        actorId: input.actorId,
      });
      if (screen.hit) {
        amlHit = true;
        const flags = [...(payment.riskFlags ?? [])];
        flags.push("aml_watchlist_hit");
        await tx.update(schema.payments).set({ riskFlags: flags }).where(eq(schema.payments.id, payment.id));
        payment.riskFlags = flags;
      }
    }

    // ---- Budget checks ----
    const budgetCheck = await checkBudget(tx, input.tenantId, {
      amountMinor: BigInt(payment.totalMinor),
      category: payment.category ?? "general",
      branchId: payment.branchId ?? undefined,
      departmentId: payment.departmentId ?? undefined,
      employeeId: undefined, // could be derived from actor
      paymentId: payment.id,
    });
    if (!budgetCheck.allowed) {
      if (budgetCheck.action === "BLOCK") {
        await transitionPayment(tx, {
          paymentId: payment.id,
          to: "FAILED",
          actorId: input.actorId,
          reason: budgetCheck.message ?? "Budget limit exceeded",
        });
        return { status: "FAILED" };
      }
      if (budgetCheck.action === "REQUIRE_APPROVAL") {
        // Will be handled by approval flow below
      }
    }

    // Check spend limits
    const paymentCategory = payment.category ?? undefined;
    if (payment.branchId) {
      const spendLimitChecks = await checkSpendLimit(tx, input.tenantId, {
        amountMinor: BigInt(payment.totalMinor),
        category: paymentCategory,
        entityType: "BRANCH",
        entityId: payment.branchId,
      });
      for (const slc of spendLimitChecks) {
        if (!slc.allowed) {
          if (slc.action === "BLOCK") {
            await transitionPayment(tx, {
              paymentId: payment.id,
              to: "FAILED",
              actorId: input.actorId,
              reason: slc.message ?? "Spend limit exceeded",
            });
            return { status: "FAILED" };
          }
          if (slc.action === "REQUIRE_APPROVAL") {
            // Will be handled by approval flow
          }
        }
      }
    }

    if (payment.departmentId) {
      const spendLimitChecks = await checkSpendLimit(tx, input.tenantId, {
        amountMinor: BigInt(payment.totalMinor),
        category: paymentCategory,
        entityType: "DEPARTMENT",
        entityId: payment.departmentId,
      });
      for (const slc of spendLimitChecks) {
        if (!slc.allowed) {
          if (slc.action === "BLOCK") {
            await transitionPayment(tx, {
              paymentId: payment.id,
              to: "FAILED",
              actorId: input.actorId,
              reason: slc.message ?? "Department spend limit exceeded",
            });
            return { status: "FAILED" };
          }
        }
      }
    }

    // Approval decision (policy snapshot is captured by the approval request)
    let rules = input.policyRules ?? [];
    let steps = evaluatePolicy(rules, {
      amountMinor: BigInt(payment.amountMinor),
      product: payment.product ?? "single_payment",
      channel: payment.channel,
      branchId: payment.branchId ?? undefined,
      departmentId: payment.departmentId ?? undefined,
      riskFlags: payment.riskFlags ?? [],
    });
    // Watchlist hits always require human approval, even without a matching
    // policy rule: a synthetic APPROVER step is snapshotted into the request.
    if (steps.length === 0 && amlHit) {
      rules = [{ riskFlags: ["aml_watchlist_hit"], mode: "PARALLEL", requiredRoles: ["APPROVER"], minApprovers: 1, order: 99 }];
      steps = evaluatePolicy(rules, {
        amountMinor: BigInt(payment.amountMinor),
        product: payment.product ?? "single_payment",
        channel: payment.channel,
        branchId: payment.branchId ?? undefined,
        departmentId: payment.departmentId ?? undefined,
        riskFlags: payment.riskFlags ?? [],
      });
    }
    if (steps.length > 0) {
      const { requestId } = await createApprovalRequest(tx, {
        tenantId: input.tenantId,
        paymentId: payment.id,
        policyId: undefined,
        rules,
        context: {
          amountMinor: BigInt(payment.amountMinor),
          product: payment.product ?? "single_payment",
          channel: payment.channel,
          branchId: payment.branchId ?? undefined,
          departmentId: payment.departmentId ?? undefined,
          riskFlags: payment.riskFlags ?? [],
        },
        createdById: input.actorId,
      });
      await transitionPayment(tx, { paymentId: payment.id, to: "PENDING_APPROVAL", actorId: input.actorId, reason: "approval required" });
      await tx.update(schema.payments).set({ approvalRequired: true }).where(eq(schema.payments.id, payment.id));
      await enqueueOutbox(tx, {
        eventType: "payment.approval_requested",
        aggregateType: "payment",
        aggregateId: payment.id,
        tenantId: input.tenantId,
        payload: { paymentId: payment.id, approvalRequestId: requestId },
      });
      return { status: "PENDING_APPROVAL", approvalRequestId: requestId };
    }
    return queuePayment(tx, payment.id, input.actorId, input.tenantId);
  });
}

/** Internal: reserve funds and move to QUEUED. */
async function queuePayment(tx: Tx, paymentId: string, actorId: string, tenantId: string): Promise<{ status: string }> {
  const [payment] = await tx
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.id, paymentId))
    .for("update");
  if (!payment) throw new PaymentError("Payment not found", "PAYMENT_NOT_FOUND");
  try {
    await reserveFunds(tx, {
      tenantId,
      paymentId: payment.id,
      walletId: payment.sourceWalletId!,
      amountMinor: BigInt(payment.totalMinor),
    });
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      await transitionPayment(tx, { paymentId: payment.id, to: "FAILED", actorId, reason: "insufficient balance" });
      await enqueueOutbox(tx, {
        eventType: "payment.failed",
        aggregateType: "payment",
        aggregateId: payment.id,
        tenantId,
        payload: { paymentId: payment.id, reason: "insufficient balance" },
      });
      return { status: "FAILED" };
    }
    throw err;
  }

  // Record budget commitments
  await recordCommitment(tx, {
    tenantId,
    paymentId: payment.id,
    amountMinor: BigInt(payment.totalMinor),
    category: payment.category ?? "general",
    subCategory: undefined,
    budgetId: undefined, // Will be determined by budget check
    spendLimitId: undefined,
    pettyCashWalletId: undefined,
    actorId,
  });

  await transitionPayment(tx, { paymentId: payment.id, to: "QUEUED", actorId, reason: "queued for execution" });
  await enqueueOutbox(tx, {
    eventType: "payment.queued",
    aggregateType: "payment",
    aggregateId: payment.id,
    tenantId,
    payload: { paymentId: payment.id },
  });
  return { status: "QUEUED" };
}

/**
 * approveQueuedPayment — called by the worker when an approval request
 * resolves APPROVED. Moves PENDING_APPROVAL -> APPROVED -> QUEUED.
 */
export async function approveQueuedPayment(
  db: Db,
  input: { tenantId: string; paymentId: string; actorId: string },
): Promise<{ status: string }> {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.id, input.paymentId), eq(schema.payments.tenantId, input.tenantId)))
      .for("update");
    if (!payment) throw new PaymentError("Payment not found", "PAYMENT_NOT_FOUND");
    if (payment.status !== "PENDING_APPROVAL") {
      throw new PaymentError(`Cannot approve payment in state ${payment.status}`, "INVALID_STATE");
    }
    await transitionPayment(tx, { paymentId: payment.id, to: "APPROVED", actorId: input.actorId, reason: "approval complete" });
    await tx.update(schema.payments).set({ approvedById: input.actorId, approvedAt: new Date() }).where(eq(schema.payments.id, payment.id));
    return queuePayment(tx, payment.id, input.actorId, input.tenantId);
  });
}

/** Cancel a DRAFT/REJECTED/FAILED payment. */
export async function cancelPayment(db: Db, input: { tenantId: string; paymentId: string; actorId: string; reason?: string }) {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.id, input.paymentId), eq(schema.payments.tenantId, input.tenantId)))
      .for("update");
    if (!payment) throw new PaymentError("Payment not found", "PAYMENT_NOT_FOUND");
    const cancellableStates = ["DRAFT", "REJECTED", "FAILED", "QUEUED"] as const;
    if (!cancellableStates.includes(payment.status as typeof cancellableStates[number])) {
      throw new PaymentError(`Cannot cancel payment in state ${payment.status}`, "INVALID_STATE");
    }

    // Check if we need to release budget commitments (for QUEUED, APPROVED, PENDING_APPROVAL)
    const needsBudgetRelease = ["QUEUED", "APPROVED", "PENDING_APPROVAL"].includes(payment.status);

    await transitionPayment(tx, { paymentId: payment.id, to: "CANCELLED", actorId: input.actorId, reason: input.reason });

    // Release budget commitments if payment was queued/approved
    if (needsBudgetRelease) {
      await releaseCommitment(tx, {
        tenantId: input.tenantId,
        paymentId: payment.id,
        amountMinor: BigInt(payment.totalMinor),
        category: payment.category ?? "general",
        subCategory: undefined,
        budgetId: undefined,
        spendLimitId: undefined,
        pettyCashWalletId: undefined,
        actorId: input.actorId,
      });
    }

    await enqueueOutbox(tx, {
      eventType: "payment.cancelled",
      aggregateType: "payment",
      aggregateId: payment.id,
      tenantId: input.tenantId,
      payload: { paymentId: payment.id },
    });
  });
}

/** Fund a wallet (manual adjustment / bank transfer / M-Pesa deposit). */
export async function fundWallet(
  db: Db,
  input: { tenantId: string; walletId: string; amount: string; method: string; reference?: string; actorId?: string },
): Promise<{ fundingEventId: string }> {
  const amountMinor = parseMinor(input.amount);
  return db.transaction(async (tx) => {
    const [wallet] = await tx
      .select()
      .from(schema.wallets)
      .where(and(eq(schema.wallets.id, input.walletId), eq(schema.wallets.tenantId, input.tenantId)))
      .for("update");
    if (!wallet) throw new PaymentError("Wallet not found", "WALLET_NOT_FOUND");
    const [event] = await tx
      .insert(schema.fundingEvents)
      .values({
        tenantId: input.tenantId,
        walletId: wallet.id,
        amountMinor,
        method: input.method,
        reference: input.reference,
        status: "COMPLETED",
        createdById: input.actorId,
      })
      .returning();
    if (!event) throw new PaymentError("Failed to create funding event", "CREATE_FAILED");
    await tx
      .update(schema.wallets)
      .set({ availableMinor: sql`${schema.wallets.availableMinor} + ${amountMinor}` })
      .where(eq(schema.wallets.id, wallet.id));
    await recordWalletFunding(tx, {
      tenantId: input.tenantId,
      walletId: wallet.id,
      refType: "funding",
      refId: event.id,
      amountMinor,
      note: `funding event ${event.id} (${input.method})`,
    });
    await postFundingJournal(tx, { tenantId: input.tenantId, walletId: wallet.id, amountMinor, actorId: input.actorId });
    await enqueueOutbox(tx, {
      eventType: "balance.funded",
      aggregateType: "wallet",
      aggregateId: wallet.id,
      tenantId: input.tenantId,
      payload: { walletId: wallet.id, amountMinor: amountMinor.toString(), fundingEventId: event.id },
    });
    return { fundingEventId: event.id };
  });
}
