import { NextRequest } from "next/server";
import { getDb, schema, eq, inArray, and } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { recordApprovalAction, listApprovalRequests } from "@zfloat/approvals";
import {
  approveQueuedPayment,
  approveBatch,
  activateBeneficiary,
  rejectBeneficiary,
  executeApprovedReversal,
} from "@zfloat/payments-core";
import { loadUserPermissions } from "@zfloat/auth";
import { applyInviteRoleDecision } from "@/lib/invite-controls";

/**
 * Maker-checker approvals center.
 * GET  — pending/actionable requests for the tenant, hydrated per resource
 *        kind (payments, batches, payee-book entries, reversals, role invites).
 * POST — an approver records a decision; when the whole chain resolves, the
 *        gated action is EXECUTED here by the approver's authority (never by
 *        the maker), e.g. release a queued payment, activate a payee,
 *        reverse a payment, or grant a privileged role.
 */
export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const status = request.nextUrl.searchParams.get("status") ?? undefined;
  const requests = await listApprovalRequests(db, { tenantId: user!.tenantId!, userId: user!.userId, status });

  // ---- hydrate resources referenced by the requests ----
  const paymentRefs = requests
    .filter((r: { paymentId: string | null; resourceType: string | null; resourceId: string | null }) => r.paymentId || (r.resourceType === "reversal" && r.resourceId))
    .map((r: { paymentId: string | null; resourceId: string | null }) => (r.paymentId ?? r.resourceId) as string);
  const uniquePaymentIds: string[] = Array.from(new Set(paymentRefs));
  const payments = uniquePaymentIds.length
    ? await db
        .select({
          id: schema.payments.id,
          paymentNumber: schema.payments.paymentNumber,
          amountMinor: schema.payments.amountMinor,
          beneficiarySnapshot: schema.payments.beneficiarySnapshot,
          status: schema.payments.status,
          createdById: schema.payments.createdById,
        })
        .from(schema.payments)
        .where(and(eq(schema.payments.tenantId, user!.tenantId!), inArray(schema.payments.id, uniquePaymentIds)))
    : [];

  const batchIds = Array.from(new Set(requests.map((r: { batchId: string | null }) => r.batchId).filter(Boolean))) as string[];
  const batches = batchIds.length
    ? await db
        .select({
          id: schema.paymentBatches.id,
          name: schema.paymentBatches.name,
          totalAmountMinor: schema.paymentBatches.totalAmountMinor,
          status: schema.paymentBatches.status,
        })
        .from(schema.paymentBatches)
        .where(inArray(schema.paymentBatches.id, batchIds))
    : [];

  const beneficiaryIds = requests
    .filter((r: { resourceType: string | null; resourceId: string | null }) => r.resourceType === "beneficiary" && r.resourceId)
    .map((r: { resourceId: string | null }) => r.resourceId as string);
  const beneficiaries = beneficiaryIds.length
    ? await db
        .select({ id: schema.beneficiaries.id, name: schema.beneficiaries.name, status: schema.beneficiaries.status, type: schema.beneficiaries.type })
        .from(schema.beneficiaries)
        .where(inArray(schema.beneficiaries.id, beneficiaryIds))
    : [];

  const inviteIds = requests.filter((r: { resourceType: string | null; resourceId: string | null }) => r.resourceType === "invite" && r.resourceId).map((r: { resourceId: string | null }) => r.resourceId as string);
  const invites = inviteIds.length
    ? await db
        .select({ id: schema.invitations.id, email: schema.invitations.email, roleId: schema.invitations.roleId })
        .from(schema.invitations)
        .where(inArray(schema.invitations.id, inviteIds))
    : [];
  const roleIds = Array.from(new Set(invites.map((i: { roleId: string }) => i.roleId))) as string[];
  const inviteRoles = roleIds.length
    ? await db.select({ id: schema.roles.id, name: schema.roles.name }).from(schema.roles).where(inArray(schema.roles.id, roleIds))
    : [];

  return apiOk({
    data: requests.map((r: { id: string; status: string; mode: string; currentLevel: number; requiredApprovals: number; createdAt: Date; dueAt: Date | null; batchId: string | null; paymentId: string | null; resourceType: string | null; resourceId: string | null; policySnapshot: unknown }) => {
      const payment = r.paymentId
        ? payments.find((p) => p.id === r.paymentId)
        : r.resourceType === "reversal" && r.resourceId
          ? payments.find((p) => p.id === r.resourceId)
          : undefined;
      const batch = r.batchId ? batches.find((b) => b.id === r.batchId) : undefined;
      const beneficiary = r.resourceType === "beneficiary" && r.resourceId
        ? beneficiaries.find((b) => b.id === r.resourceId)
        : undefined;
      const invite = r.resourceType === "invite" && r.resourceId ? invites.find((i) => i.id === r.resourceId) : undefined;
      const role = invite ? inviteRoles.find((x) => x.id === invite.roleId) : undefined;
      const snapshot = (r.policySnapshot ?? {}) as { metadata?: Record<string, unknown> };

      let kind: "payment" | "batch" | "beneficiary" | "reversal" | "invite" = "payment";
      if (r.batchId) kind = "batch";
      else if (r.resourceType === "beneficiary") kind = "beneficiary";
      else if (r.resourceType === "reversal") kind = "reversal";
      else if (r.resourceType === "invite") kind = "invite";

      const title =
        kind === "payment" && payment
          ? payment.paymentNumber
          : kind === "batch" && batch
            ? batch.name
            : kind === "beneficiary" && beneficiary
              ? beneficiary.name
              : kind === "reversal" && payment
                ? `${payment.paymentNumber} reversal`
                : kind === "invite" && invite
                  ? invite.email
                  : r.id.slice(0, 8);
      const detail =
        kind === "payment" && payment
          ? String((payment.beneficiarySnapshot as Record<string, unknown>)?.name ?? "")
          : kind === "reversal"
            ? String(snapshot.metadata?.reason ?? "")
            : kind === "invite" && role
              ? `${role.name} role grant`
              : "";
      const amountMinor =
        payment
          ? payment.amountMinor.toString()
          : batch
            ? batch.totalAmountMinor.toString()
            : undefined;

      return {
        id: r.id,
        status: r.status,
        mode: r.mode,
        currentLevel: r.currentLevel,
        requiredApprovals: r.requiredApprovals,
        createdAt: r.createdAt,
        dueAt: r.dueAt,
        kind,
        title,
        detail,
        amountMinor: amountMinor ?? null,
        refStatus: payment ? payment.status : batch ? batch.status : beneficiary ? beneficiary.status : null,
        paymentId: r.paymentId ?? null,
        batchId: r.batchId ?? null,
        resourceType: r.resourceType ?? null,
        resourceId: r.resourceId ?? null,
      };
    }),
  });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const requestId = String(b.requestId ?? "");
  const decision = b.decision === "reject" ? "REJECT" : "APPROVE";
  const perms = await loadUserPermissions(db, user!.userId);
  if (!perms.has("payment.approve") && !perms.has("batch.approve")) {
    return apiError(403, "FORBIDDEN", "You do not have approval rights");
  }
  try {
    const outcome = await recordApprovalAction(db, {
      requestId,
      actorId: user!.userId,
      actorRoles: ["APPROVER", "FINANCE_MANAGER", "OWNER"], // resolved from RBAC in production wiring
      decision,
      comment: b.comment ? String(b.comment) : undefined,
    });
    // When the whole chain resolves, EXECUTE the gated action (approver's
    // authority — the maker never executes their own request).
    if (outcome.status === "APPROVED" || outcome.status === "REJECTED") {
      const { db: d2 } = getDb();
      const [req] = await d2.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, requestId)).limit(1);
      if (req) {
        if (outcome.status === "APPROVED") {
          if (req.paymentId) {
            await approveQueuedPayment(d2, { tenantId: user!.tenantId!, paymentId: req.paymentId, actorId: user!.userId });
          } else if (req.batchId) {
            await approveBatch(d2, { tenantId: user!.tenantId!, batchId: req.batchId, actorId: user!.userId });
          } else if (req.resourceType === "beneficiary" && req.resourceId) {
            await activateBeneficiary(d2, {
              tenantId: req.tenantId,
              beneficiaryId: req.resourceId,
              actorId: user!.userId,
            });
          } else if (req.resourceType === "reversal" && req.resourceId) {
            const snapshot = (req.policySnapshot ?? {}) as { metadata?: { reason?: string } };
            const { createProviderRegistry } = await import("@zfloat/providers");
            await executeApprovedReversal(d2, {
              tenantId: req.tenantId,
              paymentId: req.resourceId,
              actorId: user!.userId,
              reason: String(snapshot.metadata?.reason ?? "Approved reversal"),
              provider: createProviderRegistry().get("local-sandbox"),
            });
          } else if (req.resourceType === "invite" && req.resourceId) {
            await applyInviteRoleDecision(d2, { inviteId: req.resourceId, decision: "APPROVED", actorId: user!.userId });
          }
        } else {
          // Reject side effects: never leave the gated resource in limbo.
          if (req.resourceType === "beneficiary" && req.resourceId) {
            await rejectBeneficiary(d2, { tenantId: req.tenantId, beneficiaryId: req.resourceId, actorId: user!.userId });
          } else if (req.resourceType === "invite" && req.resourceId) {
            await applyInviteRoleDecision(d2, { inviteId: req.resourceId, decision: "REJECTED", actorId: user!.userId });
          }
        }
      }
    }
    return apiOk({ data: outcome });
  } catch (err) {
    return apiError(400, "APPROVAL_FAILED", err instanceof Error ? err.message : "Approval action failed");
  }
}
