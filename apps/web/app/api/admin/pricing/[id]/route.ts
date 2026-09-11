import { NextRequest } from "next/server";
import { getDb, schema, eq } from "@zfloat/database";
import { requirePlatformAdmin, apiOk, apiError } from "@/lib/api";
import { createPlatformConfigChange } from "@zfloat/approvals";
import { writeAuditEvent } from "@zfloat/audit";
import { guardApi } from "@/lib/platform-config";

/** Fee-rule removal goes through maker-checker as a DISABLE update —
 * the engine forbids hard-deleting versioned fee rules (UNSUPPORTED_OP),
 * so "delete" stages a deactivation a second platform admin approves.
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();

  const [existing] = await db.select().from(schema.feeRules).where(eq(schema.feeRules.id, params.id)).limit(1);
  if (!existing) return apiError(404, "NOT_FOUND", "Fee rule not found");

  const r = await guardApi(() =>
    createPlatformConfigChange(db, {
      actorId: user!.userId,
      kind: "fee_rule",
      op: "update",
      targetId: params.id,
      payload: { status: "DISABLED", changeComment: `Deactivated via admin console` },
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
    after: { kind: "fee_rule", op: "update", toStatus: "DISABLED", label: r.data.label },
    ip: request.headers.get("x-forwarded-for") ?? undefined,
  });

  return apiOk(
    { data: { requestId: r.data.requestId, status: "PENDING_APPROVAL", label: r.data.label } },
    { status: 202 },
  );
}
