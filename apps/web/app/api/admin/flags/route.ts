import { NextRequest } from "next/server";
import { getDb, schema } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";
import { createPlatformConfigChange } from "@zfloat/approvals";
import { writeAuditEvent } from "@zfloat/audit";
import { guardApi } from "@/lib/platform-config";

/** Admin flags console — feature-flag toggles.
 *
 * Maker-checker: POST no longer flips the flag directly. It stages the
 * toggle; a SECOND platform admin approves it in the admin approvals centre
 * (/admin/approvals), and only then is the flag flipped (audited as
 * `feature_flag.updated` under the approver's authority).
 */

export async function GET() {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const rows = await db.select().from(schema.featureFlags);
  return apiOk({ data: rows });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const flagId = body.flagId ? String(body.flagId) : undefined;
  const r = await guardApi(() =>
    createPlatformConfigChange(db, {
      actorId: user!.userId,
      kind: "feature_flag",
      op: "update",
      targetId: flagId,
      payload: { enabled: body.enabled },
    }),
  );
  if (!r.ok) return r.response;

  await writeAuditEvent(db, {
    tenantId: user!.tenantId ?? undefined,
    actorId: user!.userId,
    actorRole: "platform_admin",
    action: "platform.config.requested",
    resourceType: "platform_config_request",
    resourceId: r.data.requestId,
    after: { kind: "feature_flag", op: "update", label: r.data.label },
    ip: request.headers.get("x-forwarded-for") ?? undefined,
  });

  return apiOk(
    { data: { requestId: r.data.requestId, status: "PENDING_APPROVAL", label: r.data.label } },
    { status: 202 },
  );
}
