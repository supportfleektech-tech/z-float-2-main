import { exportDataSubject, DsarError } from "@zfloat/audit";
import { getDb } from "@zfloat/database";
import { requirePlatformAdmin, apiError, apiOk } from "@/lib/api";

function dsarError(err: DsarError) {
  const status = err.code === "NOT_FOUND" ? 404 : err.code === "AMBIGUOUS" ? 409 : err.code === "BAD_INPUT" ? 400 : 500;
  return apiError(status, err.code, err.message);
}

/** GET /api/admin/dsar/export?userId=<uuid> (or &email=<email> when the email
 * belongs to exactly one account) — ODPC data-subject export: personal-data
 * bundle JSON; financial records referenced, never dumped. */
export async function GET(req: Request) {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") ?? undefined;
  const email = url.searchParams.get("email") ?? undefined;
  try {
    const bundle = await exportDataSubject(db, { userId, email });
    return apiOk({ data: bundle });
  } catch (err) {
    if (err instanceof DsarError) return dsarError(err);
    return apiError(500, "INTERNAL", err instanceof Error ? err.message : "Export failed");
  }
}
