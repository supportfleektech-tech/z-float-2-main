import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { submitForReview } from "@zfloat/kyc";

/**
 * POST /api/kyc/submit — submit the tenant's KYC profile for review.
 * Refuses while documents are still scanning or failed the malware check.
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!user!.tenantId) return apiError(403, "NO_TENANT", "Your account is not bound to a workspace.");
  const { db } = getDb();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const out = await submitForReview(db, {
    tenantId: user!.tenantId,
    businessName: typeof body.businessName === "string" ? body.businessName : undefined,
    registrationNumber: typeof body.registrationNumber === "string" ? body.registrationNumber : undefined,
    actorId: user!.userId,
  });
  if (!out.ok) return apiError(422, "KYC_SUBMIT_FAILED", out.error ?? "Submission failed.");
  return apiOk({ data: { ok: true, profileId: out.profileId } });
}
