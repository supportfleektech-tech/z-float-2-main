import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { apiOk, apiError, requirePermission } from "@/lib/api";
import { listDocuments, getProfile, decideProfile } from "@zfloat/kyc";
import { writeAuditEvent } from "@zfloat/audit";

/**
 * GET /api/admin/kyc/tenant?tenantId= — a tenant's profile + documents, so a
 * compliance reviewer can inspect evidence before deciding a case.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePermission("admin.kyc");
  if (response) return response;
  const { db } = getDb();
  const tenantId = request.nextUrl.searchParams.get("tenantId");
  if (!tenantId) return apiError(400, "BAD_REQUEST", "tenantId is required.");
  const profile = await getProfile(db, tenantId);
  const docs = await listDocuments(db, tenantId);
  return apiOk({ data: { profile, documents: docs } });
}

/**
 * POST /api/admin/kyc/tenant/decide — review decision on a tenant's profile.
 * { tenantId, decision: APPROVED|REJECTED, level: BASIC|FULL, note }
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requirePermission("admin.kyc");
  if (response) return response;
  const { db } = getDb();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tenantId = String(body.tenantId ?? "");
  const decision = String(body.decision ?? "");
  const level = String(body.level ?? "BASIC");
  const note = String(body.note ?? "").slice(0, 2000);
  if (!tenantId) return apiError(400, "BAD_REQUEST", "tenantId is required.");
  if (!["APPROVED", "REJECTED"].includes(decision)) return apiError(400, "BAD_DECISION", "decision must be APPROVED or REJECTED.");
  if (!["BASIC", "FULL"].includes(level)) return apiError(400, "BAD_LEVEL", "level must be BASIC or FULL.");

  const profile = await getProfile(db, tenantId);
  if (!profile) return apiError(404, "NOT_FOUND", "No KYC profile for this tenant.");
  if (profile.status !== "PENDING") {
    return apiError(409, "WRONG_STATE", `Profile is ${profile.status} — only PENDING profiles can be decided.`);
  }

  await decideProfile(db, { tenantId, decision: decision as "APPROVED" | "REJECTED", note, actorId: user!.userId, level: level as "BASIC" | "FULL" });
  await writeAuditEvent(db, {
    tenantId,
    actorId: user!.userId,
    actorRole: "COMPLIANCE_ADMIN",
    action: "kyc.profile.decided",
    resourceType: "kyc_profile",
    resourceId: profile.id,
    after: { decision, level, note: note.slice(0, 300) },
  });
  return apiOk({ data: { tenantId, decision, level } });
}
