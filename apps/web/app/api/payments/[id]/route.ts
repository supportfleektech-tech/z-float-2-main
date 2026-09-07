
import { NextRequest } from "next/server";
import { getDb, schema, and, eq, desc } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { submitPayment, cancelPayment, approveQueuedPayment, requestReversalApproval } from "@zfloat/payments-core";
import { recordApprovalAction } from "@zfloat/approvals";
import { loadUserPermissions } from "@zfloat/auth";
import { resolveApprovalRulesForSubmit } from "@/lib/approval-gate";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  const [payment] = await db
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.id, params.id), eq(schema.payments.tenantId, user!.tenantId!)))
    .limit(1);
  if (!payment) return apiError(404, "NOT_FOUND", "Payment not found");

  const history = await db
    .select()
    .from(schema.paymentStatusHistory)
    .where(eq(schema.paymentStatusHistory.paymentId, payment.id))
    .orderBy(desc(schema.paymentStatusHistory.createdAt));

  const attempts = await db
    .select()
    .from(schema.paymentAttempts)
    .where(eq(schema.paymentAttempts.paymentId, payment.id))
    .orderBy(desc(schema.paymentAttempts.createdAt));

  const feeCalc = await db
    .select()
    .from(schema.feeCalculations)
    .where(eq(schema.feeCalculations.paymentId, payment.id))
    .limit(1);

  return apiOk({
    data: {
      ...payment,
      amountMinor: payment.amountMinor.toString(),
      feeMinor: payment.feeMinor.toString(),
      totalMinor: payment.totalMinor.toString(),
      beneficiary: payment.beneficiarySnapshot,
      history,
      attempts,
      fee: feeCalc[0] ? { feeMinor: feeCalc[0].feeMinor.toString(), ruleSnapshot: feeCalc[0].ruleSnapshot } : null,
    },
  });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }
  const action = String((body as Record<string, unknown>).action ?? "");

  try {
    switch (action) {
      case "submit": {
        // Maker-checker: resolve the tenant's approval policy at submit time.
        const policy = await resolveApprovalRulesForSubmit(db, user!.tenantId!);
        if (!policy.ok) return apiError(409, policy.code, policy.message);
        await submitPayment(db, {
          tenantId: user!.tenantId!,
          paymentId: params.id,
          actorId: user!.userId,
          policyRules: policy.rules,
        });
        return apiOk({ data: { action: "submit", ok: true } });
      }
      case "cancel":
        await cancelPayment(db, { tenantId: user!.tenantId!, paymentId: params.id, actorId: user!.userId, reason: String((body as Record<string, unknown>).reason ?? "cancelled") });
        return apiOk({ data: { action: "cancel", ok: true } });
      case "reverse": {
        // Maker-checker: requesting a reversal is the maker step — the funds
        // only move once an independent checker approves the request in the
        // Approval center (execution then calls executeApprovedReversal).
        const perms = await loadUserPermissions(db, user!.userId);
        if (!perms.has("payment.reverse")) return apiError(403, "FORBIDDEN", "You do not have reversal rights");
        const gate = await requestReversalApproval(db, {
          tenantId: user!.tenantId!,
          paymentId: params.id,
          actorId: user!.userId,
          reason: String((body as Record<string, unknown>).reason ?? "Requested by customer"),
        });
        return apiOk(
          {
            data: {
              action: "reverse",
              ok: true,
              status: gate.status,
              approvalRequestId: gate.approvalRequestId,
              message: "Reversal request submitted — an approver must sign off before funds move.",
            },
          },
          { status: 202 },
        );
      }
      case "approve": {
        const perms = await loadUserPermissions(db, user!.userId);
        if (!perms.has("payment.approve")) return apiError(403, "FORBIDDEN", "You do not have approval rights");
        // Find the approval request for this payment and act on it
        const [req] = await db
          .select()
          .from(schema.approvalRequests)
          .where(and(eq(schema.approvalRequests.paymentId, params.id), eq(schema.approvalRequests.status, "PENDING")))
          .limit(1);
        if (!req) {
          // No approval required — direct approve for admin flows
          await approveQueuedPayment(db, { tenantId: user!.tenantId!, paymentId: params.id, actorId: user!.userId });
          return apiOk({ data: { action: "approve", ok: true } });
        }
        const decision = String((body as Record<string, unknown>).decision ?? "approve") === "approve" ? "APPROVE" : "REJECT";
        const outcome = await recordApprovalAction(db, {
          requestId: req.id,
          actorId: user!.userId,
          actorRoles: [...perms].filter((p) => p.startsWith("payment.")).map(() => "APPROVER"),
          decision,
          comment: (body as Record<string, unknown>).comment ? String((body as Record<string, unknown>).comment) : undefined,
        });
        if (outcome.status === "APPROVED") {
          await approveQueuedPayment(db, { tenantId: user!.tenantId!, paymentId: params.id, actorId: user!.userId });
        }
        return apiOk({ data: { action, ok: true, outcome: outcome.status } });
      }
      default:
        return apiError(400, "UNKNOWN_ACTION", `Unknown action: ${action}`);
    }
  } catch (err) {
    return apiError(400, "ACTION_FAILED", err instanceof Error ? err.message : "Action failed");
  }
}
