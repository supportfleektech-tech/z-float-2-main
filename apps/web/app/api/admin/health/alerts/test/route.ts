import { getDb } from "@zfloat/database";
import { requirePlatformAdmin, apiOk, apiError } from "@/lib/api";
import { sendTestOpsAlert } from "@/lib/ops-alerts";

/** POST /api/admin/health/alerts/test — dispatch one labeled test alert to the
 * first configured ops email (proves the channel end to end). */
export async function POST() {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  try {
    const result = await sendTestOpsAlert(db);
    return apiOk({ data: { ...result, message: "Test alert queued" } });
  } catch (err) {
    return apiError(400, "ALERT_TEST_FAILED", err instanceof Error ? err.message : "Test alert failed");
  }
}
