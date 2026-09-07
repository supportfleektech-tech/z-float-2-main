import { NextRequest } from "next/server";
import { getDb, schema, asc, toJsonSafe } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";
import { createPlatformConfigChange } from "@zfloat/approvals";
import { writeAuditEvent } from "@zfloat/audit";
import { guardApi } from "@/lib/platform-config";

/** Admin catalog console — airtime/data denominations.
 *
 * Maker-checker: writes are staged for a second platform admin's approval
 * (see apps/web/app/api/admin/config-requests).
 */

export async function GET() {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const rows = await db.select().from(schema.airtimeCatalog).orderBy(asc(schema.airtimeCatalog.name));
  return apiOk({ data: rows.map((r) => toJsonSafe(r)) });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await guardApi(() =>
    createPlatformConfigChange(db, { actorId: user!.userId, kind: "airtime", op: "create", payload: body }),
  );
  if (!r.ok) return r.response;

  await writeAuditEvent(db, {
    tenantId: user!.tenantId ?? undefined,
    actorId: user!.userId,
    actorRole: "platform_admin",
    action: "platform.config.requested",
    resourceType: "platform_config_request",
    resourceId: r.data.requestId,
    after: { kind: "airtime", op: "create", label: r.data.label },
    ip: request.headers.get("x-forwarded-for") ?? undefined,
  });

  return apiOk(
    { data: { requestId: r.data.requestId, status: "PENDING_APPROVAL", label: r.data.label } },
    { status: 202 },
  );
}
