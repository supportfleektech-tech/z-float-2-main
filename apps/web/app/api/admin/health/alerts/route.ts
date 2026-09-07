import { getDb } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";
import { recentOpsAlerts } from "@/lib/ops-alerts";

/** GET /api/admin/health/alerts — recent ops-alert notification deliveries
 * (templateCode `ops.alert`), newest first, for the /admin/health panel. */
export async function GET() {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const rows = await recentOpsAlerts(db, 25);
  return apiOk({ data: { rows } });
}
