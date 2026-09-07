import { eraseDataSubject, DsarError } from "@zfloat/audit";
import { getDb } from "@zfloat/database";
import { requirePlatformAdmin, apiError, apiOk } from "@/lib/api";

function dsarError(err: DsarError) {
  const status =
    err.code === "NOT_FOUND"
      ? 404
      : err.code === "AMBIGUOUS"
        ? 409
        : err.code === "CONFIRM_REQUIRED"
          ? 422
          : err.code === "SELF_ERASURE_FORBIDDEN"
            ? 403
            : err.code === "BAD_INPUT"
              ? 400
              : 500;
  return apiError(status, err.code, err.message);
}

/** POST /api/admin/dsar/erasure { userId?, email?, confirm: "ERASE" } —
 * scrubs the data subject's personal data across operational stores; audit +
 * security logs and financial records retained (documented exceptions). */
export async function POST(req: Request) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  let body: { userId?: string; email?: string; confirm?: string };
  try {
    body = (await req.json()) as { userId?: string; email?: string; confirm?: string };
  } catch {
    return apiError(400, "BAD_BODY", "JSON body expected");
  }
  try {
    const summary = await eraseDataSubject(db, {
      userId: body.userId,
      email: body.email,
      confirm: body.confirm ?? "",
      actorId: user!.userId,
    });
    return apiOk({ data: summary });
  } catch (err) {
    if (err instanceof DsarError) return dsarError(err);
    return apiError(500, "INTERNAL", err instanceof Error ? err.message : "Erasure failed");
  }
}
