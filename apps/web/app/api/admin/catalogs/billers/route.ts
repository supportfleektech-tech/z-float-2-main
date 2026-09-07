import { NextRequest } from "next/server";
import { getDb, schema, asc } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";
import { createPlatformConfigChange } from "@zfloat/approvals";
import { writeAuditEvent } from "@zfloat/audit";
import { guardApi } from "@/lib/platform-config";

/** Admin catalog console — billers (paybill/till collections).
 *
 * Maker-checker: writes are no longer direct. POST stages a change that a
 * SECOND platform admin approves in the admin approvals centre
 * (/api/admin/config-requests). Nothing is written here.
 */

export async function GET() {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const rows = await db.select().from(schema.billers).orderBy(asc(schema.billers.name));
  return apiOk({ data: rows });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await guardApi(() =>
    createPlatformConfigChange(db, { actorId: user!.userId, kind: "biller", op: "create", payload: body }),
  );
  if (!r.ok) return r.response;

  await writeAuditEvent(db, {
    tenantId: user!.tenantId ?? undefined,
    actorId: user!.userId,
    actorRole: "platform_admin",
    action: "platform.config.requested",
    resourceType: "platform_config_request",
    resourceId: r.data.requestId,
    after: { kind: "biller", op: "create", label: r.data.label },
    ip: request.headers.get("x-forwarded-for") ?? undefined,
  });

  return apiOk(
    { data: { requestId: r.data.requestId, status: "PENDING_APPROVAL", label: r.data.label } },
    { status: 202 },
  );
}
