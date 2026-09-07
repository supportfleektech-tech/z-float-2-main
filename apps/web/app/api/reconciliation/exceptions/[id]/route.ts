import { getReconExceptionDetail } from "@zfloat/payments-core";
import { schema, inArray } from "@zfloat/database";
import { apiOk } from "@/lib/api";
import { reconApiContext } from "@/lib/recon-api";

interface Params {
  params: Promise<{ id: string }>;
}

/** GET /api/reconciliation/exceptions/[id] — detail + activity history.
 * Tenant members may only read their own tenant's exception; platform admins
 * may read any (cross-tenant admin view). Actor names/emails are resolved for
 * display. */
export async function GET(_req: Request, { params }: Params) {
  const guard = await reconApiContext(false);
  if ("response" in guard) return guard.response;
  const { db, tenantId } = guard.ctx;
  const { id } = await params;
  const detail = await getReconExceptionDetail(db, id);
  if (!detail || (tenantId && detail.tenantId !== tenantId)) {
    return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Recon exception not found" } }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  // Resolve actor display names/emails from the users table (same-tenant or platform).
  const actorIds = [...new Set(detail.activity.map((a) => a.actorId).filter((x): x is string => Boolean(x)))];
  const actorMap: Record<string, { id: string; name: string; email: string }> = {};
  if (actorIds.length > 0) {
    const users = await db.select().from(schema.users).where(inArray(schema.users.id, actorIds));
    for (const u of users) actorMap[u.id] = { id: u.id, name: u.fullName, email: u.email };
  }
  return apiOk({ data: { ...detail, activity: detail.activity.map((a) => ({ ...a, actor: a.actorId ? actorMap[a.actorId] ?? null : null })) } });
}
