import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";
import { createPlatformConfigChange } from "@zfloat/approvals";
import { writeAuditEvent } from "@zfloat/audit";
import { guardApi } from "@/lib/platform-config";

/** PATCH — stage a biller update; applied only after a second admin approves. */
export async function PATCH(request: NextRequest, ctx: { params: { id: string } }) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await guardApi(() =>
    createPlatformConfigChange(db, {
      actorId: user!.userId,
      kind: "biller",
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
    after: { kind: "biller", op: "update", label: r.data.label, targetId: ctx.params.id },
    ip: request.headers.get("x-forwarded-for") ?? undefined,
  });

  return apiOk(
    { data: { requestId: r.data.requestId, status: "PENDING_APPROVAL", label: r.data.label } },
    { status: 202 },
  );
}

/** DELETE — stage a biller removal; executed only after a second admin approves. */
export async function DELETE(request: NextRequest, ctx: { params: { id: string } }) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();

  const r = await guardApi(() =>
    createPlatformConfigChange(db, {
      actorId: user!.userId,
      kind: "biller",
      op: "delete",
      targetId: ctx.params.id,
      payload: {},
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
    after: { kind: "biller", op: "delete", label: r.data.label, targetId: ctx.params.id },
    ip: request.headers.get("x-forwarded-for") ?? undefined,
  });

  return apiOk(
    { data: { requestId: r.data.requestId, status: "PENDING_APPROVAL", label: r.data.label } },
    { status: 202 },
  );
}
