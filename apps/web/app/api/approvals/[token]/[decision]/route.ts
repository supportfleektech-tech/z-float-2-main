import { NextRequest } from "next/server";
import { getDb, schema, eq } from "@zfloat/database";
import { processTokenApproval, validateAndConsumeToken } from "@zfloat/approvals";
import { getConfig } from "@zfloat/config";

/**
 * One-tap approval endpoint for WhatsApp/SMS/USSD channels.
 * GET /api/approvals/:token/approve|reject
 * 
 * This endpoint validates the token and processes the approval/rejection.
 * It renders a simple HTML page showing the result (for browser clicks from WhatsApp/SMS).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; decision: string }> }
) {
  const { token, decision } = await params;
  const { db } = getDb();
  const config = getConfig();

  const decisionUpper = decision.toUpperCase();
  if (decisionUpper !== "APPROVE" && decisionUpper !== "REJECT") {
    return renderResultPage(config.APP_URL, "Invalid Decision", "The approval link is invalid.", "error");
  }

  try {
    // Validate and consume the token
    const validated = await validateAndConsumeToken(db, token, decisionUpper as "APPROVE" | "REJECT");
    if (!validated) {
      return renderResultPage(
        config.APP_URL,
        "Invalid or Expired Link",
        "This approval link has expired, already been used, or is invalid. Please check your notifications for a new request.",
        "error"
      );
    }

    // Get actor roles for the approval action
    const _actorRoles = await db
      .select({ name: schema.roles.name })
      .from(schema.roles)
      .innerJoin(schema.userRoles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(eq(schema.userRoles.userId, validated.actorId));

    // Process the approval
    const outcome = await processTokenApproval(db, token, decisionUpper as "APPROVE" | "REJECT");

    // Get request details for display
    const [req] = await db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.id, validated.requestId))
      .limit(1);

    let resourceDescription = "request";
    if (req?.paymentId) resourceDescription = `payment ${req.paymentId.slice(0, 8)}`;
    else if (req?.batchId) resourceDescription = `batch ${req.batchId.slice(0, 8)}`;
    else if (req?.resourceType === "beneficiary") resourceDescription = "beneficiary registration";
    else if (req?.resourceType === "reversal") resourceDescription = "payment reversal";
    else if (req?.resourceType === "invite") resourceDescription = "role invitation";

    const action = decisionUpper === "APPROVE" ? "approved" : "rejected";
    const statusText = outcome.status === "APPROVED" ? "fully approved" :
      outcome.status === "REJECTED" ? "rejected" :
      outcome.status === "PARTIALLY_APPROVED" ? "partially approved (awaiting next approver)" :
      "pending";

    return renderResultPage(
      config.APP_URL,
      decisionUpper === "APPROVE" ? "✅ Approved" : "❌ Rejected",
      `You have ${action} the ${resourceDescription}. The request is now ${statusText}.`,
      decisionUpper === "APPROVE" ? "success" : "warning"
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred";
    return renderResultPage(
      config.APP_URL,
      "Error",
      `Failed to process approval: ${message}`,
      "error"
    );
  }
}

function renderResultPage(appUrl: string, title: string, message: string, type: "success" | "warning" | "error"): Response {
  const colors = {
    success: { bg: "#ECFDF5", border: "#10B981", text: "#065F46", button: "#10B981" },
    warning: { bg: "#FEF3C7", border: "#F59E0B", text: "#92400E", button: "#F59E0B" },
    error: { bg: "#FEF2F2", border: "#EF4444", text: "#991B1B", button: "#EF4444" },
  };
  const c = colors[type];

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Z-float</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #F3F4F6;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      max-width: 400px;
      width: 100%;
      overflow: hidden;
    }
    .header {
      background: ${c.bg};
      border-bottom: 3px solid ${c.border};
      padding: 32px 24px;
      text-align: center;
    }
    .icon { font-size: 48px; margin-bottom: 12px; }
    .header h1 {
      color: ${c.text};
      font-size: 24px;
      font-weight: 700;
      margin: 0;
    }
    .content {
      padding: 32px 24px;
      text-align: center;
    }
    .content p {
      color: #374151;
      font-size: 16px;
      line-height: 1.6;
      margin: 0;
    }
    .footer {
      padding: 24px;
      text-align: center;
      border-top: 1px solid #E5E7EB;
    }
    .btn {
      display: inline-block;
      background: ${c.button};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
    .secondary { color: #6B7280; font-size: 13px; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="icon">${type === "success" ? "✅" : type === "warning" ? "⚠️" : "❌"}</div>
      <h1>${title}</h1>
    </div>
    <div class="content">
      <p>${message}</p>
    </div>
    <div class="footer">
      <a href="${appUrl}/approvals" class="btn">View in Z-float</a>
      <p class="secondary">This link can only be used once. You may close this window.</p>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}