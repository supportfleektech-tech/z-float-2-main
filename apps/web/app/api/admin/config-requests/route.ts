import { NextRequest } from "next/server";
import { getDb, schema, inArray } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";
import { listPlatformConfigRequests } from "@zfloat/approvals";

/** Platform-config maker-checker centre.
 * GET — staged platform changes (billers/airtime catalog …) with creator and
 * decision history, for the second-admin approval UI (/admin/approvals).
 * Decisions: POST /api/admin/config-requests/{id}.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();

  const status = request.nextUrl.searchParams.get("status") ?? undefined;
  const rows = await listPlatformConfigRequests(db, status);

  const userIds = Array.from(new Set(rows.map((r: { createdById: string | null }) => r.createdById).filter(Boolean))) as string[];
  const users = userIds.length
    ? await db
        .select({ id: schema.users.id, email: schema.users.email, fullName: schema.users.fullName })
        .from(schema.users)
        .where(inArray(schema.users.id, userIds))
    : [];

  const requestIds = rows.map((r: { id: string }) => r.id);
  const actions = requestIds.length
    ? await db
        .select({
          id: schema.approvalActions.id,
          requestId: schema.approvalActions.requestId,
          actorId: schema.approvalActions.actorId,
          decision: schema.approvalActions.decision,
          comment: schema.approvalActions.comment,
          createdAt: schema.approvalActions.createdAt,
        })
        .from(schema.approvalActions)
        .where(inArray(schema.approvalActions.requestId, requestIds))
        .orderBy(schema.approvalActions.createdAt)
    : [];
  const actionUserIds = Array.from(new Set(actions.map((a) => a.actorId).filter(Boolean))) as string[];
  const actionUsers = actionUserIds.length
    ? await db
        .select({ id: schema.users.id, email: schema.users.email, fullName: schema.users.fullName })
        .from(schema.users)
        .where(inArray(schema.users.id, actionUserIds))
    : [];

  return apiOk({
    data: rows.map((r: { id: string; status: string; createdAt: Date; updatedAt: Date; executedAt: Date | null; executionError: string | null; change: unknown; createdById: string | null }) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      executedAt: r.executedAt,
      executionError: r.executionError,
      change: r.change,
      creator: r.createdById ? users.find((u) => u.id === r.createdById) ?? null : null,
      actions: actions
        .filter((a) => a.requestId === r.id)
        .map((a) => ({ ...a, actor: actionUsers.find((u) => u.id === a.actorId) ?? null })),
    })),
  });
}
