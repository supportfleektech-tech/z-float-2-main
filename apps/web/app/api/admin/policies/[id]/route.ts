import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";
import { createPlatformConfigChange } from "@zfloat/approvals";
import { writeAuditEvent } from "@zfloat/audit";
import { guardApi } from "@/lib/platform-config";

/** Policy PATCH — stage a versioned policy edit / pause / activate.
 *
 * Maker-checker: nothing is written here. The PATCH body (name, description,
 * rules as builder shapes, active, comment) is staged for a SECOND platform
 * admin's approval; on approval the apply core archives the current rules
 * when they change (approval_policy_versions), bumps the version, and audits
 * approval.policy.update|activate|pause under the approver's authority.
 */
export async function PATCH(request: NextRequest, ctx: { params: { id: string } }) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await guardApi(() =>
    createPlatformConfigChange(db, {
      actorId: user!.userId,
      kind: "approval_policy",
      op: "update",
      targetId: ctx.params.id,
      payload: body,
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
    after: { kind: "approval_policy", op: "update", label: r.data.label },
    ip: request.headers.get("x-forwarded-for") ?? undefined,
  });

  return apiOk(
    { data: { requestId: r.data.requestId, status: "PENDING_APPROVAL", label: r.data.label } },
    { status: 202 },
  );
}
