/**
 * Payment state machine — the ONLY legal transitions table.
 * No provider response is trusted to jump states: every transition is a
 * server-side guarded command (instructions.md §5).
 *
 * DRAFT -> VALIDATING -> PENDING_APPROVAL -> APPROVED -> QUEUED
 *       -> PROCESSING -> PROVIDER_PENDING -> SUCCESS | FAILED | REVERSED | CANCELLED
 */
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@zfloat/database";

export const PAYMENT_STATES = [
  "DRAFT",
  "VALIDATING",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "QUEUED",
  "PROCESSING",
  "PROVIDER_PENDING",
  "SUCCESS",
  "FAILED",
  "REVERSED",
  "CANCELLED",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** Legal transition map. Any pair not listed here is rejected. */
const TRANSITIONS: Record<PaymentState, PaymentState[]> = {
  DRAFT: ["VALIDATING", "CANCELLED"],
  VALIDATING: ["PENDING_APPROVAL", "QUEUED", "FAILED", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  // FAILED from APPROVED = balance reservation failed at queue time (worker must
  // never silently skip an approved payment that cannot be funded).
  APPROVED: ["QUEUED", "FAILED", "CANCELLED"],
  REJECTED: [],
  QUEUED: ["PROCESSING", "CANCELLED", "FAILED"],
  PROCESSING: ["PROVIDER_PENDING", "SUCCESS", "FAILED"],
  PROVIDER_PENDING: ["SUCCESS", "FAILED", "REVERSED"],
  SUCCESS: ["REVERSED"],
  FAILED: ["QUEUED", "CANCELLED"],
  REVERSED: [],
  CANCELLED: [],
};

export function canTransition(from: PaymentState, to: PaymentState): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(from: PaymentState, to: PaymentState) {
    super(`Illegal payment state transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export interface TransitionInput {
  paymentId: string;
  to: PaymentState;
  actorId?: string;
  reason?: string;
}

/**
 * Guarded state transition: locks the payment row (FOR UPDATE), validates the
 * transition against the legal map, appends to the immutable status history,
 * and bumps the optimistic-concurrency version. Throws on illegal transitions
 * or when the row changed underneath us (version mismatch).
 */
export async function transitionPayment(tx: Tx, input: TransitionInput, expectedVersion?: number): Promise<void> {
  const [payment] = await tx
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.id, input.paymentId))
    .for("update");
  if (!payment) throw new Error(`Payment not found: ${input.paymentId}`);

  if (expectedVersion !== undefined && payment.version !== expectedVersion) {
    throw new Error(`Payment ${input.paymentId} was modified concurrently (version ${payment.version} != ${expectedVersion})`);
  }
  const from = payment.status as PaymentState;
  if (!canTransition(from, input.to)) {
    throw new IllegalTransitionError(from, input.to);
  }

  if (from !== input.to) {
    await tx.insert(schema.paymentStatusHistory).values({
      paymentId: payment.id,
      fromStatus: from,
      toStatus: input.to,
      reason: input.reason,
      actorId: input.actorId,
    });
    await tx
      .update(schema.payments)
      .set({ status: input.to, version: payment.version + 1 })
      .where(eq(schema.payments.id, payment.id));
  }
}

/** Convenience for statuses with a timestamp side-effect. */
export const SUCCESS_TIMESTAMPS = { SUCCESS: "successAt", QUEUED: "executedAt" } as const;
