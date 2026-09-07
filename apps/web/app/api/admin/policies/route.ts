import { NextRequest } from "next/server";
import { getDb, schema, eq, or, isNull, asc, desc, toJsonSafe } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";
import { createPlatformConfigChange } from "@zfloat/approvals";
import { writeAuditEvent } from "@zfloat/audit";
import { guardApi } from "@/lib/platform-config";
import type { ApprovalRule } from "@zfloat/approvals";

/** Admin policies console — tenant approval policies.
 *
 * Maker-checker: writes are no longer direct. POST (create) and PATCH
 * (versioned edits / pause / activate) stage a change that a SECOND platform
 * admin approves in the admin approvals centre (/admin/approvals). On
 * approval the change is applied with the semantics the direct routes had —
 * rule edits archive the live rules into approval_policy_versions and bump
 * the version; active toggles emit activate/pause audits — all under the
 * APPROVER's authority.
 */

/** GET ?tenantId=… — policies + version history + tenant roles for the builder. Without tenantId, returns the active tenant list for the selector. */
export async function GET(request: NextRequest) {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const tenantId = request.nextUrl.searchParams.get("tenantId") ?? "";

  const tenants = await db
    .select({ id: schema.tenants.id, name: schema.tenants.name })
    .from(schema.tenants)
    .where(eq(schema.tenants.status, "ACTIVE"))
    .orderBy(asc(schema.tenants.name));

  if (!tenantId) {
    return apiOk({ data: { policies: [], roles: [], tenants } });
  }

  const policies = await db
    .select()
    .from(schema.approvalPolicies)
    .where(eq(schema.approvalPolicies.tenantId, tenantId))
    .orderBy(desc(schema.approvalPolicies.updatedAt));

  const roles = await db
    .select({ id: schema.roles.id, name: schema.roles.name, description: schema.roles.description })
    .from(schema.roles)
    .where(or(eq(schema.roles.tenantId, tenantId), isNull(schema.roles.tenantId)))
    .orderBy(asc(schema.roles.name));

  return apiOk({
    data: {
      policies: policies.map((p) => ({ ...(toJsonSafe(p) as Record<string, unknown>), rules: (p.rules ?? []) as unknown as ApprovalRule[] })),
      roles,
      tenants,
    },
  });
}

/** POST — stage a new approval policy (lands active as version 1 on approval). */
export async function POST(request: NextRequest) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await guardApi(() =>
    createPlatformConfigChange(db, {
      actorId: user!.userId,
      kind: "approval_policy",
      op: "create",
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
    after: { kind: "approval_policy", op: "create", label: r.data.label },
    ip: request.headers.get("x-forwarded-for") ?? undefined,
  });

  return apiOk(
    { data: { requestId: r.data.requestId, status: "PENDING_APPROVAL", label: r.data.label } },
    { status: 202 },
  );
}
