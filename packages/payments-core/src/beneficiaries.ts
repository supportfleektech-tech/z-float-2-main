/**
 * Beneficiary (payee book) maker-checker (hardening batch).
 *
 * Adding a payee to the book no longer activates it for payments: the maker
 * registers the payee → the payee is PENDING → an independent approver
 * (APPROVER / FINANCE_MANAGER / OWNER) approves it in the Approval center →
 * ACTIVE. Payments may only reference ACTIVE payees, so a single rogue actor
 * can neither add their own payee nor move funds to an unchecked one.
 * (Ad-hoc payments typed inline on the payment form carry only a snapshot and
 * remain governed by the amount/risk approval policy as before.)
 */
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";
import { createApprovalRequest } from "@zfloat/approvals";
import { enqueueOutbox } from "./outbox.js";

export class BeneficiaryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "BeneficiaryError";
  }
}

/** Business roles allowed to sign off a new payee (mirror payment.approve). */
export const BENEFICIARY_APPROVER_ROLES = ["APPROVER", "FINANCE_MANAGER", "OWNER"];

export interface RegisterBeneficiaryInput {
  tenantId: string;
  createdById: string;
  type?: string;
  name: string;
  phone?: string;
  email?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankCode?: string;
  tillNumber?: string;
  paybillNumber?: string;
  paybillAccount?: string;
  notes?: string;
}

/** Maker step: create the payee as PENDING and raise an approval request.
 * Returns the payee id + the approval request id (shown to the maker). */
export async function registerBeneficiary(
  db: Db,
  input: RegisterBeneficiaryInput,
): Promise<{ beneficiaryId: string; approvalRequestId: string }> {
  return db.transaction(async (tx) => {
    const [beneficiary] = await tx
      .insert(schema.beneficiaries)
      .values({
        tenantId: input.tenantId,
        type: input.type ?? "person",
        name: input.name,
        phone: input.phone,
        email: input.email,
        bankAccountName: input.bankAccountName,
        bankAccountNumber: input.bankAccountNumber,
        bankCode: input.bankCode,
        tillNumber: input.tillNumber,
        paybillNumber: input.paybillNumber,
        paybillAccount: input.paybillAccount,
        notes: input.notes,
        status: "PENDING",
        createdById: input.createdById,
      })
      .returning({ id: schema.beneficiaries.id });
    if (!beneficiary) throw new BeneficiaryError("failed to create payee", "CREATE_FAILED");

    const { requestId } = await createApprovalRequest(tx, {
      tenantId: input.tenantId,
      resourceType: "beneficiary",
      resourceId: beneficiary.id,
      rules: [{ mode: "ANY", requiredRoles: BENEFICIARY_APPROVER_ROLES, minApprovers: 1, order: 1 }],
      context: { amountMinor: 0n, product: "control", channel: "internal" },
      createdById: input.createdById,
    });

    await enqueueOutbox(tx, {
      eventType: "beneficiary.registration_requested",
      aggregateType: "beneficiary",
      aggregateId: beneficiary.id,
      tenantId: input.tenantId,
      payload: { beneficiaryId: beneficiary.id, approvalRequestId: requestId },
    });

    return { beneficiaryId: beneficiary.id, approvalRequestId: requestId };
  });
}

/** Checker step: approve a pending payee → ACTIVE. Idempotent.
 * Called from the approvals dispatch when the request resolves APPROVED. */
export async function activateBeneficiary(
  db: Db,
  input: { tenantId: string; beneficiaryId: string; actorId: string },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [beneficiary] = await tx
      .select()
      .from(schema.beneficiaries)
      .where(
        and(eq(schema.beneficiaries.id, input.beneficiaryId), eq(schema.beneficiaries.tenantId, input.tenantId)),
      )
      .for("update");
    if (!beneficiary) throw new BeneficiaryError("Payee not found", "NOT_FOUND");
    if (beneficiary.status === "ACTIVE") return;
    await tx
      .update(schema.beneficiaries)
      .set({ status: "ACTIVE", updatedAt: new Date() })
      .where(eq(schema.beneficiaries.id, input.beneficiaryId));
    await enqueueOutbox(tx, {
      eventType: "beneficiary.activated",
      aggregateType: "beneficiary",
      aggregateId: input.beneficiaryId,
      tenantId: input.tenantId,
      payload: { beneficiaryId: input.beneficiaryId, actorId: input.actorId },
    });
  });
}

/** Checker step (reject path): PENDING → REJECTED. Idempotent. */
export async function rejectBeneficiary(
  db: Db,
  input: { tenantId: string; beneficiaryId: string; actorId: string },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [beneficiary] = await tx
      .select()
      .from(schema.beneficiaries)
      .where(
        and(eq(schema.beneficiaries.id, input.beneficiaryId), eq(schema.beneficiaries.tenantId, input.tenantId)),
      )
      .for("update");
    if (!beneficiary) throw new BeneficiaryError("Payee not found", "NOT_FOUND");
    if (beneficiary.status !== "PENDING") return;
    await tx
      .update(schema.beneficiaries)
      .set({ status: "REJECTED", updatedAt: new Date() })
      .where(eq(schema.beneficiaries.id, input.beneficiaryId));
    await enqueueOutbox(tx, {
      eventType: "beneficiary.rejected",
      aggregateType: "beneficiary",
      aggregateId: input.beneficiaryId,
      tenantId: input.tenantId,
      payload: { beneficiaryId: input.beneficiaryId, actorId: input.actorId },
    });
  });
}

/**
 * Funds-movement gate: a payment referencing the payee book may only be
 * submitted when the referenced payee is ACTIVE (approved by a checker).
 * Throws BeneficiaryError(code PAYEE_NOT_APPROVED) otherwise.
 */
export async function assertPayeeApproved(
  db: Db,
  input: { tenantId: string; beneficiaryId: string | null },
): Promise<void> {
  if (!input.beneficiaryId) return; // inline snapshot payee — policy engine governs
  const [beneficiary] = await db
    .select({ id: schema.beneficiaries.id, status: schema.beneficiaries.status, name: schema.beneficiaries.name })
    .from(schema.beneficiaries)
    .where(
      and(eq(schema.beneficiaries.id, input.beneficiaryId), eq(schema.beneficiaries.tenantId, input.tenantId)),
    )
    .limit(1);
  if (!beneficiary) throw new BeneficiaryError("Payee not found in your workspace", "NOT_FOUND");
  if (beneficiary.status === "REJECTED") {
    throw new BeneficiaryError(`Payee "${beneficiary.name}" was rejected — choose another payee`, "PAYEE_NOT_APPROVED");
  }
  if (beneficiary.status !== "ACTIVE") {
    throw new BeneficiaryError(
      `Payee "${beneficiary.name}" is pending approval — an approver must activate it in the Approval center first`,
      "PAYEE_NOT_APPROVED",
    );
  }
}

/** Approvals-center hydration helper. */
export async function getBeneficiarySummary(db: Db, tenantId: string, id: string) {
  const [row] = await db
    .select({ id: schema.beneficiaries.id, name: schema.beneficiaries.name, status: schema.beneficiaries.status, phone: schema.beneficiaries.phone })
    .from(schema.beneficiaries)
    .where(and(eq(schema.beneficiaries.id, id), eq(schema.beneficiaries.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

