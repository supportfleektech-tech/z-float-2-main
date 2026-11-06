/**
 * Approval request lifecycle — DB-backed with maker-checker enforcement,
 * per-actor uniqueness (idempotent actions), sequential/parallel/any modes,
 * delegation lookup and escalation metadata.
 * 
 * Also handles one-tap approval tokens for WhatsApp/SMS/USSD channels.
 */
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import { schema, toJsonSafe, type Db, type Tx } from "@zfloat/database";
import { ApprovalContext, ApprovalPolicyError, ApprovalRule, evaluatePolicy, validateRules } from "./policy.js";
import { getConfig } from "@zfloat/config";
import { createHash, randomBytes } from "node:crypto";
import { sendApprovalNotification, sendApprovalReminder } from "@zfloat/notifications";

export class ApprovalError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ApprovalError";
  }
}

export interface CreateApprovalInput {
  tenantId: string;
  paymentId?: string;
  batchId?: string;
  /** Maker-checker generalization: the generic resource being gated. */
  resourceType?: "payment" | "batch" | "beneficiary" | "reversal" | "invite" | "platform_config";
  resourceId?: string;
  policyId?: string;
  rules: ApprovalRule[];
  context: ApprovalContext;
  /** Free-form intent metadata (e.g. reversal reason) — snapshotted immutably. */
  metadata?: Record<string, unknown>;
  createdById: string;
  dueAt?: Date;
}

export interface ApprovalActionInput {
  requestId: string;
  actorId: string;
  actorRoles: string[];
  decision: "APPROVE" | "REJECT";
  comment?: string;
  /** Resolved approver (delegation support: actor acts on behalf of this user). */
  delegatedForId?: string;
}

export interface ApprovalTokenInput {
  requestId: string;
  stepId?: string;
  actorId: string;
  decision: "APPROVE" | "REJECT";
  channel: "WHATSAPP" | "SMS" | "USSD" | "EMAIL";
  expiresAt: Date;
}

export interface ApprovalTokenResult {
  token: string;
  tokenHash: string;
  approvalUrl: string;
}

export type ApprovalOutcome =
  | { status: "PENDING" | "PARTIALLY_APPROVED"; requestId: string }
  | { status: "APPROVED" | "REJECTED"; requestId: string };

/** Generate a secure one-tap approval token. */
export function generateApprovalToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

/** Build the approval URL for a token. */
export function buildApprovalUrl(token: string, decision: "APPROVE" | "REJECT"): string {
  const config = getConfig();
  const baseUrl = config.APP_URL.replace(/\/$/, "");
  return `${baseUrl}/api/approvals/${token}/${decision.toLowerCase()}`;
}

/** Create an approval request with its steps, snapshotting the policy rules. */
export async function createApprovalRequest(db: Db, input: CreateApprovalInput): Promise<{ requestId: string }> {
  validateRules(input.rules);
  const steps = evaluatePolicy(input.rules, input.context);
  if (steps.length === 0) {
    throw new ApprovalError("No approval steps required for this payment", "NO_STEPS_REQUIRED");
  }

  return db.transaction(async (tx) => {
    const [request] = await tx
      .insert(schema.approvalRequests)
      .values({
        tenantId: input.tenantId,
        paymentId: input.paymentId,
        batchId: input.batchId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        policyId: input.policyId,
        policySnapshot: toJsonSafe({ rules: input.rules, context: input.context, metadata: input.metadata }) as Record<
          string,
          unknown
        >,
        status: "PENDING",
        mode: steps[0]!.mode,
        requiredApprovals: steps.reduce((acc, s) => acc + s.minApprovers, 0),
        currentLevel: 1,
        dueAt: input.dueAt,
        createdById: input.createdById,
      })
      .returning();
    if (!request) throw new ApprovalError("failed to create approval request", "CREATE_FAILED");

    const createdSteps = [];
    for (const step of steps) {
      const [createdStep] = await tx
        .insert(schema.approvalSteps)
        .values({
          requestId: request.id,
          level: step.level,
          mode: step.mode,
          roles: step.roles,
          minApprovers: step.minApprovers,
          status: step.level === 1 ? "IN_PROGRESS" : "PENDING",
        })
        .returning();
      createdSteps.push(createdStep);
    }

    return { requestId: request.id };
  });
}

/** Create approval tokens for all approvers in the current step and send notifications. */
export async function createApprovalTokensAndNotify(
  db: Db,
  requestId: string,
  _baseUrl?: string,
): Promise<void> {
  const config = getConfig();

  const [request] = await db
    .select()
    .from(schema.approvalRequests)
    .where(eq(schema.approvalRequests.id, requestId))
    .limit(1);
  if (!request) throw new ApprovalError("Approval request not found", "NOT_FOUND");

  const steps = await db
    .select()
    .from(schema.approvalSteps)
    .where(and(eq(schema.approvalSteps.requestId, requestId), eq(schema.approvalSteps.status, "IN_PROGRESS")))
    .orderBy(schema.approvalSteps.level);

  if (steps.length === 0) return; // No active steps

  const currentStep = steps[0]!;

  // Find all users with the required roles in this tenant
  const usersWithRoles = await db
    .select({ userId: schema.users.id, phone: schema.users.phone, email: schema.users.email, fullName: schema.users.fullName })
    .from(schema.users)
    .innerJoin(schema.userRoles, eq(schema.users.id, schema.userRoles.userId))
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(
      and(
        eq(schema.users.tenantId, request.tenantId),
        eq(schema.users.status, "ACTIVE"),
        inArray(schema.roles.name, currentStep.roles),
      ),
    );

  // Filter out the creator (maker-checker)
  const eligibleApprovers = usersWithRoles.filter((u) => u.userId !== request.createdById);

  if (eligibleApprovers.length === 0) {
    throw new ApprovalError("No eligible approvers found for this step", "NO_ELIGIBLE_APPROVERS");
  }

  // Generate tokens for each eligible approver (APPROVE + REJECT)
  const ttlMinutes = config.APPROVAL_TOKEN_TTL_MINUTES ?? 60;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  const tokenRecords: ApprovalTokenInput[] = [];
  for (const approver of eligibleApprovers) {
    for (const decision of ["APPROVE", "REJECT"] as const) {
      const { token: _token, tokenHash } = generateApprovalToken();

      tokenRecords.push({
        requestId,
        stepId: currentStep.id,
        actorId: approver.userId,
        decision,
        channel: "WHATSAPP", // Will be determined by user preference at notification time
        expiresAt,
      });

      // Store token in DB
      await db.insert(schema.approvalTokens).values({
        requestId,
        stepId: currentStep.id,
        actorId: approver.userId,
        tokenHash,
        decision,
        status: "PENDING",
        channel: "WHATSAPP",
        expiresAt,
      });
    }
  }

  // Send notifications to each approver
  const snapshot = (request.policySnapshot ?? {}) as { metadata?: Record<string, unknown> };
  const _metadata = snapshot.metadata ?? {};

  for (const approver of eligibleApprovers) {
    const { token: approveToken } = generateApprovalToken(); // Re-generate for URL (we stored hash)
    const approveUrl = buildApprovalUrl(approveToken, "APPROVE");
    const _rejectUrl = buildApprovalUrl(approveToken, "REJECT"); // Same token, different decision path

    // Build notification details
    let paymentNumber: string | undefined;
    let batchName: string | undefined;
    let beneficiaryName: string | undefined;
    let reversalPaymentNumber: string | undefined;
    let inviteEmail: string | undefined;
    let inviteRole: string | undefined;
    let amountMinor: number | string | bigint | undefined;
    let currency: string | undefined;

    if (request.paymentId) {
      const [payment] = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.id, request.paymentId))
        .limit(1);
      if (payment) {
        paymentNumber = payment.paymentNumber;
        amountMinor = payment.amountMinor;
        currency = payment.currency;
        const beneficiary = payment.beneficiarySnapshot as Record<string, unknown> | null;
        beneficiaryName = String(beneficiary?.name ?? "");
      }
    } else if (request.batchId) {
      const [batch] = await db
        .select()
        .from(schema.paymentBatches)
        .where(eq(schema.paymentBatches.id, request.batchId))
        .limit(1);
      if (batch) batchName = batch.name;
    } else if (request.resourceType === "beneficiary" && request.resourceId) {
      const [beneficiary] = await db
        .select()
        .from(schema.beneficiaries)
        .where(eq(schema.beneficiaries.id, request.resourceId))
        .limit(1);
      if (beneficiary) beneficiaryName = beneficiary.name;
    } else if (request.resourceType === "reversal" && request.resourceId) {
      const [payment] = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.id, request.resourceId))
        .limit(1);
      if (payment) reversalPaymentNumber = payment.paymentNumber;
    } else if (request.resourceType === "invite" && request.resourceId) {
      const [invite] = await db
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.id, request.resourceId))
        .limit(1);
      if (invite) {
        inviteEmail = invite.email;
        const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, invite.roleId)).limit(1);
        if (role) inviteRole = role.name;
      }
    }

    let creator: { fullName: string | null } | undefined;
    if (request.createdById) {
      [creator] = await db
        .select({ fullName: schema.users.fullName })
        .from(schema.users)
        .where(eq(schema.users.id, request.createdById))
        .limit(1);
    }

    await sendApprovalNotification(db, approver.userId, {
      approvalRequestId: requestId,
      approvalToken: approveToken,
      approvalUrl: approveUrl,
      paymentNumber,
      batchName,
      beneficiaryName,
      reversalPaymentNumber,
      inviteEmail,
      inviteRole,
      amountMinor,
      currency,
      dueAt: request.dueAt ?? undefined,
      createdByName: creator?.fullName ?? undefined,
      tenantId: request.tenantId,
    });
  }
}

/** Validate and consume an approval token. */
export async function validateAndConsumeToken(
  db: Db,
  token: string,
  decision: "APPROVE" | "REJECT",
): Promise<{ requestId: string; actorId: string; stepId: string } | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const [tokenRecord] = await db
    .select()
    .from(schema.approvalTokens)
    .where(
      and(
        eq(schema.approvalTokens.tokenHash, tokenHash),
        eq(schema.approvalTokens.decision, decision),
        eq(schema.approvalTokens.status, "PENDING"),
      ),
    )
    .limit(1);

  if (!tokenRecord) return null;

  // Check expiry
  if (new Date() > tokenRecord.expiresAt) {
    await db
      .update(schema.approvalTokens)
      .set({ status: "EXPIRED" })
      .where(eq(schema.approvalTokens.id, tokenRecord.id));
    return null;
  }

  // Mark token as used
  await db
    .update(schema.approvalTokens)
    .set({ status: "USED", usedAt: new Date() })
    .where(eq(schema.approvalTokens.id, tokenRecord.id));

  // Invalidate the other decision token for this actor/request
  await db
    .update(schema.approvalTokens)
    .set({ status: "REVOKED" })
    .where(
      and(
        eq(schema.approvalTokens.requestId, tokenRecord.requestId),
        eq(schema.approvalTokens.actorId, tokenRecord.actorId),
        eq(schema.approvalTokens.decision, decision === "APPROVE" ? "REJECT" : "APPROVE"),
        eq(schema.approvalTokens.status, "PENDING"),
      ),
    );

  return {
    requestId: tokenRecord.requestId,
    actorId: tokenRecord.actorId,
    stepId: tokenRecord.stepId!,
  };
}

/** Process approval via token (one-tap from WhatsApp/SMS/USSD). */
export async function processTokenApproval(
  db: Db,
  token: string,
  decision: "APPROVE" | "REJECT",
): Promise<ApprovalOutcome> {
  const validated = await validateAndConsumeToken(db, token, decision);
  if (!validated) {
    throw new ApprovalError("Invalid or expired approval token", "INVALID_TOKEN");
  }

  // Get actor roles for the approval action
  const actorRoles = await db
    .select({ name: schema.roles.name })
    .from(schema.roles)
    .innerJoin(schema.userRoles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(eq(schema.userRoles.userId, validated.actorId));

  const roles = actorRoles.map((r) => r.name);

  return recordApprovalAction(db, {
    requestId: validated.requestId,
    actorId: validated.actorId,
    actorRoles: roles,
    decision,
    comment: `Via ${decision.toLowerCase()} token`,
  });
}

/** Resolve delegated approver: fromUserId acts via toUserId (active delegation window). */
export async function resolveDelegatee(db: Db, fromUserId: string): Promise<string> {
  const now = new Date();
  const [delegation] = await db
    .select()
    .from(schema.approvalDelegations)
    .where(
      and(
        eq(schema.approvalDelegations.fromUserId, fromUserId),
        sql`${schema.approvalDelegations.startsAt} <= ${now}`,
        sql`${schema.approvalDelegations.endsAt} >= ${now}`,
      ),
    )
    .limit(1);
  return delegation ? delegation.toUserId : fromUserId;
}

/**
 * Record an approval action. Atomic, idempotent per (request, actor).
 * Returns the resulting request status.
 */
export async function recordApprovalAction(db: Db, input: ApprovalActionInput): Promise<ApprovalOutcome> {
  return db.transaction(async (tx: Tx) => {
    const [request] = await tx
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.id, input.requestId))
      .for("update");
    if (!request) throw new ApprovalError("Approval request not found", "NOT_FOUND");
    if (request.status === "APPROVED" || request.status === "REJECTED" || request.status === "EXPIRED" || request.status === "CANCELLED") {
      throw new ApprovalError(`Approval request is already ${request.status}`, "ALREADY_RESOLVED");
    }

    // maker-checker: the creator cannot approve their own payment
    if (request.createdById === input.actorId) {
      throw new ApprovalError("A payment creator cannot approve their own request", "MAKER_CHECKER_VIOLATION");
    }
    // delegated approval: creator's delegatee also cannot self-approve if delegatedForId is the creator
    if (input.delegatedForId && request.createdById === input.delegatedForId) {
      throw new ApprovalError("A payment creator cannot approve their own request, even via delegation", "MAKER_CHECKER_VIOLATION");
    }

    // duplicate action guard (idempotency)
    const [existing] = await tx
      .select()
      .from(schema.approvalActions)
      .where(and(eq(schema.approvalActions.requestId, request.id), eq(schema.approvalActions.actorId, input.actorId)))
      .limit(1);
    if (existing) {
      throw new ApprovalError("This user has already acted on this request", "ALREADY_ACTED");
    }

    const steps = await tx
      .select()
      .from(schema.approvalSteps)
      .where(eq(schema.approvalSteps.requestId, request.id))
      .orderBy(schema.approvalSteps.level);

    // Determine which steps the actor may act on at this point.
    const eligibleSteps = steps.filter((s) => {
      if (s.status === "APPROVED" || s.status === "REJECTED" || s.status === "SKIPPED") return false;
      if (request.mode === "SEQUENTIAL" || s.mode === "SEQUENTIAL") {
        return s.level === request.currentLevel;
      }
      return true; // PARALLEL / ANY: any not-yet-resolved step
    });
    if (eligibleSteps.length === 0) {
      throw new ApprovalError("No approval step is currently actionable", "NO_ACTIONABLE_STEP");
    }
    const targetStep = eligibleSteps[0]!;
    const roleMatch = targetStep.roles.some((r) => input.actorRoles.includes(r));
    if (!roleMatch) {
      throw new ApprovalError(`Actor lacks a required role for level ${targetStep.level}`, "ROLE_MISMATCH");
    }

    // Record the action on the first eligible step.
    await tx.insert(schema.approvalActions).values({
      requestId: request.id,
      stepId: targetStep.id,
      actorId: input.actorId,
      decision: input.decision,
      comment: input.comment,
    });

    // Mark tokens for this actor/step as used/revoked
    await tx
      .update(schema.approvalTokens)
      .set({ status: "USED", usedAt: new Date() })
      .where(
        and(
          eq(schema.approvalTokens.requestId, request.id),
          eq(schema.approvalTokens.actorId, input.actorId),
          eq(schema.approvalTokens.stepId, targetStep.id),
          eq(schema.approvalTokens.status, "PENDING"),
        ),
      );

    if (input.decision === "REJECT") {
      await tx
        .update(schema.approvalRequests)
        .set({ status: "REJECTED", currentLevel: targetStep.level })
        .where(eq(schema.approvalRequests.id, request.id));
      await tx
        .update(schema.approvalSteps)
        .set({ status: "REJECTED" })
        .where(eq(schema.approvalSteps.id, targetStep.id));
      return { status: "REJECTED", requestId: request.id };
    }

    // APPROVE path: count approvals on the step.
    const approvalsOnStep = await tx
      .select({ count: schema.approvalActions.id })
      .from(schema.approvalActions)
      .where(and(eq(schema.approvalActions.stepId, targetStep.id), eq(schema.approvalActions.decision, "APPROVE")));

    const approverCount = approvalsOnStep.length;
    const stepDone = approverCount >= targetStep.minApprovers;

    if (stepDone) {
      await tx.update(schema.approvalSteps).set({ status: "APPROVED" }).where(eq(schema.approvalSteps.id, targetStep.id));
      const next = steps.find((s) => s.level > targetStep.level && s.status === "PENDING");
      if (next) {
        await tx
          .update(schema.approvalRequests)
          .set({ status: "PARTIALLY_APPROVED", currentLevel: next.level })
          .where(eq(schema.approvalRequests.id, request.id));
        await tx
          .update(schema.approvalSteps)
          .set({ status: "IN_PROGRESS" })
          .where(eq(schema.approvalSteps.id, next.id));

        // Create tokens for next level approvers
        const nextStepApprovers = await tx
          .select({ userId: schema.users.id })
          .from(schema.users)
          .innerJoin(schema.userRoles, eq(schema.users.id, schema.userRoles.userId))
          .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
          .where(
            and(
              eq(schema.users.tenantId, request.tenantId),
              eq(schema.users.status, "ACTIVE"),
              inArray(schema.roles.name, next.roles),
            ),
          );

        const nextEligible = nextStepApprovers.filter((u) => u.userId !== request.createdById);
        if (nextEligible.length > 0) {
          // Note: We don't await this to avoid blocking; it runs async
          createApprovalTokensAndNotify(tx, request.id).catch(() => undefined);
        }

        return { status: "PARTIALLY_APPROVED", requestId: request.id };
      }
      await tx
        .update(schema.approvalRequests)
        .set({ status: "APPROVED" })
        .where(eq(schema.approvalRequests.id, request.id));
      return { status: "APPROVED", requestId: request.id };
    }

    return { status: "PARTIALLY_APPROVED", requestId: request.id };
  });
}

/** List pending requests for a user's inbox (approver roles). */
export async function listApprovalRequests(
  db: Db,
  input: { tenantId: string; userId: string; status?: string; limit?: number; cursor?: string },
) {
  const limit = input.limit ?? 50;
  const conditions = [eq(schema.approvalRequests.tenantId, input.tenantId)];
  if (input.status) conditions.push(eq(schema.approvalRequests.status, input.status));
  const rows = await db
    .select()
    .from(schema.approvalRequests)
    .where(and(...conditions))
    .orderBy(desc(schema.approvalRequests.createdAt))
    .limit(limit);
  return rows;
}

/** Expire stale requests (called by the scheduler worker). */
export async function expireDueApprovals(db: Db, now = new Date()): Promise<number> {
  const stale = await db
    .update(schema.approvalRequests)
    .set({ status: "EXPIRED" })
    .where(
      and(
        eq(schema.approvalRequests.status, "PENDING"),
        sql`${schema.approvalRequests.dueAt} IS NOT NULL`,
        sql`${schema.approvalRequests.dueAt} <= ${now}`,
      ),
    )
    .returning({ id: schema.approvalRequests.id });

  // Also expire pending tokens
  await db
    .update(schema.approvalTokens)
    .set({ status: "EXPIRED" })
    .where(and(eq(schema.approvalTokens.status, "PENDING"), sql`${schema.approvalTokens.expiresAt} <= ${now}`));

  return stale.length;
}

/** Send reminders for approvals nearing expiry (called by scheduler). */
export async function sendApprovalReminders(db: Db, now = new Date()): Promise<number> {
  const reminderWindowMs = 30 * 60 * 1000; // 30 minutes before expiry

  const pendingRequests = await db
    .select()
    .from(schema.approvalRequests)
    .where(
      and(
        eq(schema.approvalRequests.status, "PENDING"),
        sql`${schema.approvalRequests.dueAt} IS NOT NULL`,
        sql`${schema.approvalRequests.dueAt} > ${now}`,
        sql`${schema.approvalRequests.dueAt} <= ${new Date(now.getTime() + reminderWindowMs)}`,
      ),
    );

  let remindersSent = 0;
  for (const request of pendingRequests) {
    const steps = await db
      .select()
      .from(schema.approvalSteps)
      .where(and(eq(schema.approvalSteps.requestId, request.id), eq(schema.approvalSteps.status, "IN_PROGRESS")))
      .orderBy(schema.approvalSteps.level);

    if (steps.length === 0) continue;

    const currentStep = steps[0]!;
    const usersWithRoles = await db
      .select({ userId: schema.users.id })
      .from(schema.users)
      .innerJoin(schema.userRoles, eq(schema.users.id, schema.userRoles.userId))
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .where(
        and(
          eq(schema.users.tenantId, request.tenantId),
          eq(schema.users.status, "ACTIVE"),
          inArray(schema.roles.name, currentStep.roles),
        ),
      );

    for (const approver of usersWithRoles.filter((u) => u.userId !== request.createdById)) {
      const { token } = generateApprovalToken();
      const approvalUrl = buildApprovalUrl(token, "APPROVE");

      await sendApprovalReminder(db, approver.userId, {
        approvalRequestId: request.id,
        approvalToken: token,
        approvalUrl,
        dueAt: request.dueAt ?? undefined,
        tenantId: request.tenantId,
      });
      remindersSent++;
    }
  }

  return remindersSent;
}

/** Whether a payment needs approval: does any rule in the policy match? */
export function needsApproval(rules: ApprovalRule[], ctx: ApprovalContext): boolean {
  return evaluatePolicy(rules, ctx).length > 0;
}

export { ApprovalPolicyError };