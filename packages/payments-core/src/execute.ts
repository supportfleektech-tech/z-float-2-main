/**
 * Payment execution & provider outcome handling.
 *
 * Rules enforced here (agent-prompt.md "Financial correctness rules"):
 *  - A payment must never execute twice because a job or webhook was retried.
 *  - A provider timeout does NOT automatically mean failure → UNKNOWN handling.
 *  - Only final states are SUCCESS / FAILED / REVERSED, driven by verified
 *    provider outcomes (webhook, status poll) or explicit sync success.
 *  - Every outcome updates: payment state → status history → reservation →
 *    ledger journal → outbox events → notifications.
 */
import { and, eq } from "drizzle-orm";
import { schema, type Db, type Tx } from "@zfloat/database";
import { applyReservation, postPaymentSuccessJournal, releaseReservation } from "@zfloat/ledger";
import { enqueueOutbox } from "./outbox.js";
import { transitionPayment } from "./state.js";
import type { PaymentProvider, ProviderPaymentResult } from "@zfloat/providers";

export class ExecutionError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ExecutionError";
  }
}

export interface ExecutePaymentInput {
  tenantId: string;
  paymentId: string;
  provider: PaymentProvider;
  attemptNumber: number;
}

/**
 * Execute a single payment through a provider adapter.
 * Called by the worker (payments.execution queue) with a specific attempt.
 */
export async function executePayment(db: Db, input: ExecutePaymentInput): Promise<void> {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.id, input.paymentId), eq(schema.payments.tenantId, input.tenantId)))
      .for("update");
    if (!payment) throw new ExecutionError("Payment not found", "PAYMENT_NOT_FOUND");
    if (payment.status !== "QUEUED") {
      // Only QUEUED payments may be executed. FAILED is terminal until an
      // explicit requeue command (FAILED -> QUEUED) re-enters the pipeline —
      // a stale execution job must never force an illegal FAILED -> PROCESSING
      // transition (state machine in state.ts is authoritative).
      return;
    }

    await transitionPayment(tx, { paymentId: payment.id, to: "PROCESSING", reason: `attempt ${input.attemptNumber}` });

    // Build the provider request from the immutable beneficiary snapshot.
    const b = (payment.beneficiarySnapshot ?? {}) as Record<string, unknown>;
    const destination = {
      channel: payment.channel as "mpesa" | "till" | "paybill" | "bank" | "airtime",
      phone: (b.phone as string) || undefined,
      bankAccountName: (b.bankAccountName as string) || undefined,
      bankAccountNumber: (b.bankAccountNumber as string) || undefined,
      bankCode: (b.bankCode as string) || undefined,
      tillNumber: (b.tillNumber as string) || undefined,
      paybillNumber: (b.paybillNumber as string) || undefined,
      paybillAccount: (b.paybillAccount as string) || undefined,
    };

    const providerReference = `ZF-${payment.paymentNumber}`;
    let result: ProviderPaymentResult;
    let latencyMs = 0;
    const startedAt = Date.now();
    try {
      result = await input.provider.createPayment({
        paymentId: payment.id,
        reference: payment.paymentNumber,
        amountMinor: BigInt(payment.amountMinor),
        currency: "KES",
        destination,
        providerReference,
      });
      latencyMs = Date.now() - startedAt;
    } catch (err) {
      latencyMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : "unknown provider error";
      // Provider timeout/unavailability is NOT failure — mark UNKNOWN and monitor.
      await recordAttempt(tx, {
        paymentId: payment.id,
        attemptNumber: input.attemptNumber,
        status: "UNKNOWN",
        errorCode: "PROVIDER_ERROR",
        errorMessage: message.slice(0, 500),
        latencyMs,
        providerCode: input.provider.code,
        providerReference,
      });
      await transitionPayment(tx, { paymentId: payment.id, to: "PROVIDER_PENDING", reason: `provider error: ${message.slice(0, 200)} — monitoring` });
      return;
    }

    await recordAttempt(tx, {
      paymentId: payment.id,
      attemptNumber: input.attemptNumber,
      status: result.status,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      latencyMs,
      providerCode: input.provider.code,
      providerReference: result.providerReference ?? providerReference,
    });

    switch (result.status) {
      case "SUCCESS":
        await applyProviderSuccess(tx, payment.id, result.providerReference ?? providerReference);
        return;
      case "FAILED":
        await applyProviderFailure(tx, payment.id, result.errorCode ?? "PROVIDER_REJECTED", result.errorMessage ?? "provider rejected");
        return;
      case "REVERSED":
        await transitionPayment(tx, { paymentId: payment.id, to: "REVERSED", reason: result.errorMessage ?? "provider reversed" });
        return;
      case "PENDING":
      case "UNKNOWN":
        // Provider will callback (webhook) or we must poll — monitor job covers this.
        await transitionPayment(tx, { paymentId: payment.id, to: "PROVIDER_PENDING", reason: result.status === "UNKNOWN" ? "unknown provider state — monitoring" : "awaiting provider callback" });
        return;
    }
  });
}

async function recordAttempt(
  tx: Tx,
  input: {
    paymentId: string;
    attemptNumber: number;
    status: string;
    errorCode?: string;
    errorMessage?: string;
    latencyMs: number;
    providerCode: string;
    providerReference?: string;
  },
): Promise<void> {
  await tx.insert(schema.paymentAttempts).values({
    paymentId: input.paymentId,
    attemptNumber: input.attemptNumber,
    providerId: undefined,
    providerReference: input.providerReference,
    status: input.status,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage?.slice(0, 1000),
    latencyMs: input.latencyMs,
  });
}

/** Apply a verified provider SUCCESS outcome (sync response or webhook). */
export async function applyProviderSuccess(
  tx: Tx,
  paymentId: string,
  providerReference: string,
  providerEventId?: string,
): Promise<void> {
  const [payment] = await tx
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.id, paymentId))
    .for("update");
  if (!payment) throw new ExecutionError("Payment not found", "PAYMENT_NOT_FOUND");
  if (payment.status === "SUCCESS") return; // idempotent — duplicate callback safe
  if (payment.status !== "PROCESSING" && payment.status !== "PROVIDER_PENDING" && payment.status !== "QUEUED") {
    throw new ExecutionError(`Cannot mark SUCCESS from state ${payment.status}`, "INVALID_STATE");
  }

  // Release the reservation: funds committed (ledger journals are posted below).
  const [reservation] = await tx
    .select()
    .from(schema.walletReservations)
    .where(eq(schema.walletReservations.paymentId, payment.id))
    .limit(1);
  if (reservation && reservation.status === "HELD") {
    await applyReservation(tx, reservation.id);
  }

  await transitionPayment(tx, {
    paymentId: payment.id,
    to: "SUCCESS",
    reason: providerEventId ? `verified callback ${providerEventId}` : "provider sync success",
  });
  await tx
    .update(schema.payments)
    .set({
      providerReference,
      providerStatus: "SUCCESS",
      successAt: new Date(),
    })
    .where(eq(schema.payments.id, payment.id));

  await postPaymentSuccessJournal(tx, {
    tenantId: payment.tenantId,
    paymentId: payment.id,
    walletId: payment.sourceWalletId ?? undefined,
    amountMinor: BigInt(payment.amountMinor),
    feeMinor: BigInt(payment.feeMinor),
  });

  await enqueueOutbox(tx, {
    eventType: "payment.succeeded",
    aggregateType: "payment",
    aggregateId: payment.id,
    tenantId: payment.tenantId,
    payload: { paymentId: payment.id, providerReference },
  });
}

/** Apply a verified provider FAILED outcome. */
export async function applyProviderFailure(
  tx: Tx,
  paymentId: string,
  errorCode: string,
  errorMessage: string,
  providerEventId?: string,
): Promise<void> {
  const [payment] = await tx
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.id, paymentId))
    .for("update");
  if (!payment) throw new ExecutionError("Payment not found", "PAYMENT_NOT_FOUND");
  if (payment.status === "FAILED" || payment.status === "CANCELLED" || payment.status === "REVERSED") return;

  const [reservation] = await tx
    .select()
    .from(schema.walletReservations)
    .where(eq(schema.walletReservations.paymentId, payment.id))
    .limit(1);
  if (reservation && reservation.status === "HELD") {
    await releaseReservation(tx, reservation.id);
  }

  await transitionPayment(tx, {
    paymentId: payment.id,
    to: "FAILED",
    reason: providerEventId ? `verified callback ${providerEventId}` : errorMessage.slice(0, 300),
  });
  await tx
    .update(schema.payments)
    .set({ providerStatus: "FAILED", failureReason: errorMessage.slice(0, 500) })
    .where(eq(schema.payments.id, payment.id));

  await enqueueOutbox(tx, {
    eventType: "payment.failed",
    aggregateType: "payment",
    aggregateId: payment.id,
    tenantId: payment.tenantId,
    payload: { paymentId: payment.id, errorCode, errorMessage },
  });
}
