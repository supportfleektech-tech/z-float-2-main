import { NextRequest, NextResponse } from "next/server";
import { getDb, schema, eq, and } from "@zfloat/database";
import { processTokenApproval, generateApprovalToken } from "@zfloat/approvals";
import { getConfig } from "@zfloat/config";

/**
 * USSD endpoint for approval via USSD menu.
 * POST /api/ussd
 * 
 * Expected payload from Africa's Talking USSD gateway:
 * {
 *   sessionId: string,
 *   serviceCode: string,
 *   phoneNumber: string,
 *   text: string,  // User input (e.g., "1*1" for menu navigation)
 * }
 * 
 * Returns USSD response text.
 */
export async function POST(_request: NextRequest) {
  const { db } = getDb();
  const _config = getConfig();

  try {
    const body = await _request.json();
    const { sessionId: _sessionId, serviceCode: _serviceCode, phoneNumber, text } = body;

    if (!_sessionId || !phoneNumber) {
      return ussdResponse("END Invalid request. Please try again.");
    }

    // Normalize phone number
    const normalizedPhone = normalizeKenyanPhone(phoneNumber);
    if (!normalizedPhone) {
      return ussdResponse("END Invalid phone number format.");
    }

    // Find user by phone
    const [user] = await db
      .select({ id: schema.users.id, fullName: schema.users.fullName })
      .from(schema.users)
      .where(eq(schema.users.phone, normalizedPhone))
      .limit(1);

    if (!user) {
      return ussdResponse("END You are not registered on Z-float. Please contact your administrator.");
    }

    // Parse USSD input (text is like "1" or "1*2" for menu navigation)
    const input = text?.trim() ?? "";
    const parts = input.split("*").filter(Boolean);

    // Get pending approvals for this user
    const pendingApprovals = await getPendingApprovals(db, user.id);

    if (pendingApprovals.length === 0) {
      return ussdResponse("END You have no pending approvals.");
    }

    // Handle menu navigation
    if (input === "" || parts.length === 0) {
      // Main menu
      return renderMainMenu(pendingApprovals);
    }

    if (parts.length === 1) {
      // Selected an approval request
      const index = parseInt(parts[0], 10) - 1;
      if (isNaN(index) || index < 0 || index >= pendingApprovals.length) {
        return ussdResponse("END Invalid selection. Please try again.");
      }
      return renderApprovalDetail(pendingApprovals[index]!, _sessionId);
    }

    if (parts.length === 2) {
      // Selected action (approve/reject)
      const index = parseInt(parts[0], 10) - 1;
      const action = parts[1];
      if (isNaN(index) || index < 0 || index >= pendingApprovals.length) {
        return ussdResponse("END Invalid selection. Please try again.");
      }
      if (action !== "1" && action !== "2") {
        return ussdResponse("END Invalid action. Please try again.");
      }

      const approval = pendingApprovals[index];
      if (!approval) {
        return ussdResponse("END Invalid selection. Please try again.");
      }
      const decision = action === "1" ? "APPROVE" : "REJECT";

      // Generate token for this action
      const { token } = generateApprovalToken();

      // Store token in DB (we need to pre-store it for USSD)
      // For USSD, we'll create the token record directly
      await createUssdToken(db, approval.requestId, approval.stepId, user.id, decision, token);

      // Process the approval via token
      try {
        const outcome = await processTokenApproval(db, token, decision);

        const actionText = decision === "APPROVE" ? "approved" : "rejected";
        const statusText = outcome.status === "APPROVED" ? "fully approved" :
          outcome.status === "REJECTED" ? "rejected" :
          outcome.status === "PARTIALLY_APPROVED" ? "partially approved (awaiting next approver)" :
          "pending";

        return ussdResponse(
          `END You have ${actionText} the request. Status: ${statusText}.\nThank you for using Z-float.`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to process approval";
        return ussdResponse(`END Error: ${message}`);
      }
    }

    return ussdResponse("END Invalid input. Please try again.");
  } catch (err) {
    console.error("[ussd] Error:", err);
    return ussdResponse("END An error occurred. Please try again later.");
  }
}

async function getPendingApprovals(db: ReturnType<typeof getDb>["db"], userId: string) {
  // Get approval steps where user has the required role and step is IN_PROGRESS
  const userRoles = await db
    .select({ name: schema.roles.name })
    .from(schema.roles)
    .innerJoin(schema.userRoles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(eq(schema.userRoles.userId, userId));

  const roleNames = userRoles.map((r) => r.name);

  // Find steps where user's roles match and step is IN_PROGRESS
  const steps = await db
    .select({
      stepId: schema.approvalSteps.id,
      requestId: schema.approvalSteps.requestId,
      level: schema.approvalSteps.level,
      roles: schema.approvalSteps.roles,
      minApprovers: schema.approvalSteps.minApprovers,
      request: {
        id: schema.approvalRequests.id,
        paymentId: schema.approvalRequests.paymentId,
        batchId: schema.approvalRequests.batchId,
        resourceType: schema.approvalRequests.resourceType,
        resourceId: schema.approvalRequests.resourceId,
        status: schema.approvalRequests.status,
        dueAt: schema.approvalRequests.dueAt,
        createdAt: schema.approvalRequests.createdAt,
      },
    })
    .from(schema.approvalSteps)
    .innerJoin(schema.approvalRequests, eq(schema.approvalSteps.requestId, schema.approvalRequests.id))
    .where(
      and(
        eq(schema.approvalRequests.status, "PENDING"),
        eq(schema.approvalSteps.status, "IN_PROGRESS"),
      ),
    );

  // Filter steps where user has a matching role
  const matchingSteps = steps.filter((step) =>
    step.roles.some((role: string) => roleNames.includes(role))
  );

  // Get resource details for each step
  const approvals: Array<{ requestId: string; stepId: string; description: string; amount: string; dueAt: Date | null; level: number }> = [];
  for (const step of matchingSteps) {
    let description = "Approval request";
    let amount = "";

    if (step.request.paymentId) {
      const [payment] = await db
        .select({ paymentNumber: schema.payments.paymentNumber, amountMinor: schema.payments.amountMinor })
        .from(schema.payments)
        .where(eq(schema.payments.id, step.request.paymentId))
        .limit(1);
      if (payment) {
        description = `Payment ${payment.paymentNumber}`;
        amount = `KES ${(Number(payment.amountMinor) / 100).toLocaleString()}`;
      }
    } else if (step.request.batchId) {
      const [batch] = await db
        .select({ name: schema.paymentBatches.name })
        .from(schema.paymentBatches)
        .where(eq(schema.paymentBatches.id, step.request.batchId))
        .limit(1);
      if (batch) description = `Batch: ${batch.name}`;
    } else if (step.request.resourceType === "beneficiary" && step.request.resourceId) {
      const [beneficiary] = await db
        .select({ name: schema.beneficiaries.name })
        .from(schema.beneficiaries)
        .where(eq(schema.beneficiaries.id, step.request.resourceId))
        .limit(1);
      if (beneficiary) description = `Beneficiary: ${beneficiary.name}`;
    } else if (step.request.resourceType === "reversal" && step.request.resourceId) {
      const [payment] = await db
        .select({ paymentNumber: schema.payments.paymentNumber })
        .from(schema.payments)
        .where(eq(schema.payments.id, step.request.resourceId))
        .limit(1);
      if (payment) description = `Reversal: ${payment.paymentNumber}`;
    } else if (step.request.resourceType === "invite" && step.request.resourceId) {
      const [invite] = await db
        .select({ email: schema.invitations.email })
        .from(schema.invitations)
        .where(eq(schema.invitations.id, step.request.resourceId))
        .limit(1);
      if (invite) description = `Invite: ${invite.email}`;
    }

    approvals.push({
      requestId: step.requestId,
      stepId: step.stepId,
      description,
      amount,
      dueAt: step.request.dueAt,
      level: step.level,
    });
  }

  return approvals;
}

function renderMainMenu(approvals: Array<{ description: string; amount: string; dueAt: Date | null }>): NextResponse {
  let menu = "CON You have pending approvals:\n";
  approvals.forEach((approval, index) => {
    const dueText = approval.dueAt ? ` (Due: ${approval.dueAt.toLocaleString()})` : "";
    menu += `${index + 1}. ${approval.description} ${approval.amount}${dueText}\n`;
  });
  menu += "\nSelect a request (1-${approvals.length}):";
  return ussdResponse(menu);
}

function renderApprovalDetail(
  approval: { requestId: string; stepId: string; description: string; amount: string; dueAt: Date | null; level: number },
  _sessionId: string
): NextResponse {
  const dueText = approval.dueAt ? `Due: ${approval.dueAt.toLocaleString()}` : "No deadline";
  let menu = `CON ${approval.description}\n${approval.amount}\n${dueText}\n\n`;
  menu += "1. Approve\n";
  menu += "2. Reject\n";
  menu += "0. Back\n\n";
  menu += "Select action:";
  return ussdResponse(menu);
}

async function createUssdToken(
  db: ReturnType<typeof getDb>["db"],
  requestId: string,
  stepId: string | undefined,
  actorId: string,
  decision: "APPROVE" | "REJECT",
  token: string,
): Promise<void> {
  const { createHash } = await import("node:crypto");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const config = getConfig();
  const ttlMinutes = config.APPROVAL_TOKEN_TTL_MINUTES ?? 60;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  await db.insert(schema.approvalTokens).values({
    requestId,
    stepId,
    actorId,
    tokenHash,
    decision,
    status: "PENDING",
    channel: "USSD",
    expiresAt,
  });
}

function normalizeKenyanPhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+254")) return digits;
  if (digits.startsWith("254")) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+254${digits.slice(1)}`;
  if (digits.length === 9) return `+254${digits}`;
  return null;
}

function ussdResponse(text: string): NextResponse {
  // Africa's Talking expects plain text with specific format
  return new NextResponse(text, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "no-cache",
    },
  });
}