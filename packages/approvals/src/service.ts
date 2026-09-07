/**
 * Approval request lifecycle — DB-backed with maker-checker enforcement,
 * per-actor uniqueness (idempotent actions), sequential/parallel/any modes,
 * delegation lookup and escalation metadata.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { schema, toJsonSafe, type Db, type Tx } from "@zfloat/database";
import { ApprovalContext, ApprovalPolicyError, ApprovalRule, evaluatePolicy, validateRules } from "./policy.js";

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

export type ApprovalOutcome =
  | { status: "PENDING" | "PARTIALLY_APPROVED"; requestId: string }
  | { status: "APPROVED" | "REJECTED"; requestId: string };

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

    for (const step of steps) {
      await tx.insert(schema.approvalSteps).values({
        requestId: request.id,
        level: step.level,
        mode: step.mode,
        roles: step.roles,
        minApprovers: step.minApprovers,
        status: step.level === 1 ? "IN_PROGRESS" : "PENDING",
      });
    }
    return { requestId: request.id };
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
  return stale.length;
}

/** Whether a payment needs approval: does any rule in the policy match? */
export function needsApproval(rules: ApprovalRule[], ctx: ApprovalContext): boolean {
  return evaluatePolicy(rules, ctx).length > 0;
}

export { ApprovalPolicyError };

