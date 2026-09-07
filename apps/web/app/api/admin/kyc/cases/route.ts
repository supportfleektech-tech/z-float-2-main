import { NextRequest } from "next/server";
import { getDb, schema } from "@zfloat/database";
import { apiOk, apiError, requirePermission } from "@/lib/api";
import { listCases, decideCase } from "@zfloat/kyc";
import { writeAuditEvent } from "@zfloat/audit";
import { eq } from "drizzle-orm";

/**
 * GET /api/admin/kyc/cases?status=OPEN — compliance case queue (admin.kyc).
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePermission("admin.kyc");
  if (response) return response;
  const { db } = getDb();
  const status = request.nextUrl.searchParams.get("status") ?? undefined;
  const cases = await listCases(db, status && status !== "ALL" ? status : undefined, 200);
  return apiOk({ data: { cases } });
}

/**
 * POST /api/admin/kyc/cases (decide body) — see also /decide below. { caseId, decision: APPROVED|REJECTED|CLOSED, note }
 * Decisions are persisted and audited; OPEN/IN_REVIEW cases transition to a
 * terminal state with the reviewer's identity recorded.
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requirePermission("admin.kyc");
  if (response) return response;
  const { db } = getDb();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const caseId = String(body.caseId ?? "");
  const decision = String(body.decision ?? "");
  const note = String(body.note ?? "").slice(0, 2000);
  if (!caseId) return apiError(400, "BAD_REQUEST", "caseId is required.");
  if (!["APPROVED", "REJECTED", "CLOSED"].includes(decision)) {
    return apiError(400, "BAD_DECISION", "decision must be APPROVED, REJECTED or CLOSED.");
  }
  const [kase] = await db.select().from(schema.kycCases).where(eq(schema.kycCases.id, caseId)).limit(1);
  if (!kase) return apiError(404, "NOT_FOUND", "Case not found.");
  if (["APPROVED", "REJECTED", "CLOSED"].includes(kase.status)) {
    return apiError(409, "ALREADY_DECIDED", `Case is already ${kase.status}.`);
  }

  await decideCase(db, { caseId, decision: decision as "APPROVED" | "REJECTED" | "CLOSED", note, actorId: user!.userId });
  await writeAuditEvent(db, {
    tenantId: kase.tenantId ?? undefined,
    actorId: user!.userId,
    actorRole: "COMPLIANCE_ADMIN",
    action: "kyc.case.decided",
    resourceType: "kyc_case",
    resourceId: caseId,
    after: { paymentId: kase.paymentId, decision, note: note.slice(0, 300) },
  });
  return apiOk({ data: { caseId, decision } });
}
