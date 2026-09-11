import { NextRequest } from "next/server";
import { getDb, schema, desc } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";
import { createPlatformConfigChange } from "@zfloat/approvals";
import { writeAuditEvent } from "@zfloat/audit";
import { guardApi } from "@/lib/platform-config";

/** Admin pricing console — fee rules.
 *
 * Maker-checker: writes are no longer direct. POST stages a change that a
 * SECOND platform admin approves in the admin approvals centre
 * (/admin/approvals). Nothing is written here. On approval the change is
 * applied with the same semantics the direct route had — the row version is
 * bumped, a feeVersions snapshot row is appended, and the
 * `pricing.rule.updated` audit is written under the APPROVER's authority.
 */

/** List fee rules (with version history). */
export async function GET() {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const rules = await db.select().from(schema.feeRules).orderBy(desc(schema.feeRules.updatedAt)).limit(100);
  const versions = await db.select().from(schema.feeVersions).orderBy(desc(schema.feeVersions.createdAt)).limit(200);
  return apiOk({
    data: {
      rules: rules.map((r) => ({ ...r, flatFeeMinor: r.flatFeeMinor.toString(), percentBps: r.percentBps.toString(), minFeeMinor: r.minFeeMinor.toString(), maxFeeMinor: r.maxFeeMinor.toString() })),
      versions,
    },
  });
}

/**
 * Stage a fee-rule create/update. The console sends the FULL intended rule
 * (minor-unit integer strings); `ruleId` in the body selects the rule to
 * update (create otherwise). The staged payload is validated like the old
 * direct write; applying still requires a second platform admin.
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ruleId = body.ruleId ? String(body.ruleId) : undefined;
  const r = await guardApi(() =>
    createPlatformConfigChange(db, {
      actorId: user!.userId,
      kind: "fee_rule",
      op: ruleId ? "update" : "create",
      targetId: ruleId,
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
    after: { kind: "fee_rule", op: ruleId ? "update" : "create", label: r.data.label },
    ip: request.headers.get("x-forwarded-for") ?? undefined,
  });

  return apiOk(
    { data: { requestId: r.data.requestId, status: "PENDING_APPROVAL", label: r.data.label } },
    { status: 202 },
  );
}
