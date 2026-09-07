import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { requirePlatformAdmin, apiOk, apiError } from "@/lib/api";
import { decidePlatformConfigChange, PLATFORM_CONFIG_APPROVER_ROLE } from "@zfloat/approvals";
import { guardApi, loadActorRoles } from "@/lib/platform-config";

/** POST — a second platform admin approves/rejects a staged config change.
 * Approval EXECUTES the change here under the approver's authority; the
 * maker can never approve their own request (engine: MAKER_CHECKER_VIOLATION).
 */
export async function POST(request: NextRequest, ctx: { params: { id: string } }) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = body.decision === "reject" ? "REJECT" : "APPROVE";
  const roles = await loadActorRoles(db, user!.userId);
  if (!roles.includes(PLATFORM_CONFIG_APPROVER_ROLE)) {
    return apiError(403, "ROLE_MISMATCH", `You need the ${PLATFORM_CONFIG_APPROVER_ROLE} role to decide platform config changes`);
  }

  const r = await guardApi(() =>
    decidePlatformConfigChange(db, {
      requestId: ctx.params.id,
      actorId: user!.userId,
      actorRoles: roles,
      decision,
      comment: body.comment ? String(body.comment) : undefined,
    }),
  );
  if (!r.ok) return r.response;

  return apiOk({ data: r.data });
}
