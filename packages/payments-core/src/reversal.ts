/**
 * Reversal flow — compensating entries, never mutation of history.
 *   SUCCESS -> (provider reversal request) -> REVERSED (verified)
 * Compensating ledger journal returns principal to the wallet (fee retained —
 * configurable finance policy, documented in docs/LEDGER.md).
 */
import { and, eq } from "drizzle-orm";
import { schema, type Db, type Tx } from "@zfloat/database";
import { createApprovalRequest } from "@zfloat/approvals";
import { postReversalJournal } from "@zfloat/ledger";
import { enqueueOutbox } from "./outbox.js";
import { transitionPayment } from "./state.js";
import type { PaymentProvider } from "@zfloat/providers";

/** Roles allowed to sign off a reversal request (independent of the requester). */
export const REVERSAL_APPROVER_ROLES = ["APPROVER", "FINANCE_MANAGER", "OWNER"];

export class ReversalError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ReversalError";
  }
}

export interface RequestReversalInput {
  tenantId: string;
  paymentId: string;
  actorId: string;
  reason: string;
  provider: PaymentProvider;
}

export interface ReversalRequestApprovalInput {
  tenantId: string;
  paymentId: string;
  actorId: string;
  reason: string;
}

/**
 * Maker-checker pre-gate for reversals (hardening batch). Reversing a payment
 * returns principal to the wallet, so it is every bit as sensitive as making
 * the payment. This maker step validates reversibility and raises an approval
 * request (resource type "reversal"); the funds only move when an independent
 * checker approves it in the Approval center, which then calls
 * executeApprovedReversal → requestReversal.
 */
export async function requestReversalApproval(
  db: Db,
  input: ReversalRequestApprovalInput,
): Promise<{ status: "APPROVAL_PENDING"; approvalRequestId: string }> {
  return db.transaction(async (tx) => {
    const payment = await loadReversiblePayment(tx, input.tenantId, input.paymentId);
    const { requestId } = await createApprovalRequest(tx, {
      tenantId: input.tenantId,
      resourceType: "reversal",
      resourceId: payment.id,
      rules: [{ mode: "ANY", requiredRoles: REVERSAL_APPROVER_ROLES, minApprovers: 1, order: 0 }],
      context: { amountMinor: BigInt(payment.amountMinor), product: "reversal", channel: "internal" },
      metadata: { reason: input.reason, requestedBy: input.actorId },
      createdById: input.actorId,
    });
    return { status: "APPROVAL_PENDING", approvalRequestId: requestId };
  });
}

/**
 * Checker step — executes an approved reversal. Idempotent: if the payment is
 * already REVERSED the outcome is considered achieved (dispatch replays and
 * duplicate approvals must never double-execute a reversal).
 */
export async function executeApprovedReversal(db: Db, input: RequestReversalInput): Promise<{ status: string }> {
  const [payment] = await db
    .select({ id: schema.payments.id, status: schema.payments.status })
    .from(schema.payments)
    .where(and(eq(schema.payments.id, input.paymentId), eq(schema.payments.tenantId, input.tenantId)))
    .limit(1);
  if (!payment) throw new ReversalError("Payment not found", "PAYMENT_NOT_FOUND");
  if (payment.status === "REVERSED") return { status: "REVERSED" };
  return requestReversal(db, input);
}

/** Shared maker-time validation (mirrors the checks inside requestReversal). */
async function loadReversiblePayment(tx: Tx, tenantId: string, paymentId: string) {
  const [payment] = await tx
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.tenantId, tenantId)))
    .for("update");
  if (!payment) throw new ReversalError("Payment not found", "PAYMENT_NOT_FOUND");
  if (payment.status !== "SUCCESS" && payment.status !== "PROVIDER_PENDING") {
    throw new ReversalError(`Cannot reverse payment in state ${payment.status}`, "INVALID_STATE");
  }
  if (!payment.providerReference) {
    throw new ReversalError("Payment has no provider reference to reverse", "NO_PROVIDER_REF");
  }
  return payment;
}

/** Request a reversal for a successful (or stuck-pending) payment. */
export async function requestReversal(db: Db, input: RequestReversalInput): Promise<{ status: string }> {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.id, input.paymentId), eq(schema.payments.tenantId, input.tenantId)))
      .for("update");
    if (!payment) throw new ReversalError("Payment not found", "PAYMENT_NOT_FOUND");
    if (payment.status !== "SUCCESS" && payment.status !== "PROVIDER_PENDING") {
      throw new ReversalError(`Cannot reverse payment in state ${payment.status}`, "INVALID_STATE");
    }
    if (!payment.providerReference) {
      throw new ReversalError("Payment has no provider reference to reverse", "NO_PROVIDER_REF");
    }

    // Create the reversal record first (idempotency: unique payment id).
    const [existing] = await tx
      .select()
      .from(schema.reversals)
      .where(eq(schema.reversals.paymentId, payment.id))
      .limit(1);
    if (existing && existing.status === "PROCESSED") {
      return { status: "REVERSED" };
    }

    let result;
    try {
      result = await input.provider.reversePayment({
        providerReference: payment.providerReference,
        amountMinor: BigInt(payment.amountMinor),
        currency: "KES",
        reason: input.reason,
        paymentId: payment.id,
      });
    } catch (err) {
      throw new ReversalError(
        `Reversal request failed: ${err instanceof Error ? err.message : "provider error"}`,
        "PROVIDER_ERROR",
      );
    }

    await tx.insert(schema.reversals).values({
      tenantId: input.tenantId,
      paymentId: payment.id,
      amountMinor: BigInt(payment.amountMinor),
      reason: input.reason,
      status: result.status === "SUCCESS" ? "PROCESSED" : "REQUESTED",
      createdById: input.actorId,
    });

    if (result.status === "SUCCESS") {
      await transitionPayment(tx, { paymentId: payment.id, to: "REVERSED", actorId: input.actorId, reason: input.reason });
      await tx
        .update(schema.payments)
        .set({ reversalReason: input.reason, providerStatus: "REVERSED" })
        .where(eq(schema.payments.id, payment.id));
      // Compensating journal: principal returns to the wallet.
      await postReversalJournal(tx, {
        tenantId: input.tenantId,
        paymentId: payment.id,
        walletId: payment.sourceWalletId ?? undefined,
        amountMinor: BigInt(payment.amountMinor),
        actorId: input.actorId,
      });
      await enqueueOutbox(tx, {
        eventType: "payment.reversed",
        aggregateType: "payment",
        aggregateId: payment.id,
        tenantId: input.tenantId,
        payload: { paymentId: payment.id, reason: input.reason },
      });
      return { status: "REVERSED" };
    }

    // Async reversal — outcome arrives via webhook; stay PROVIDER_PENDING.
    await transitionPayment(tx, { paymentId: payment.id, to: "PROVIDER_PENDING", actorId: input.actorId, reason: "reversal in progress" });
    return { status: "REVERSAL_IN_PROGRESS" };
  });
}
