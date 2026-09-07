import { NextRequest } from "next/server";
import { getDb, schema, desc, and, eq, ilike, gte, lte, inArray } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";

/**
 * Admin audit log.
 * Query params (all optional): action, actor (email ilike), resourceType,
 * resourceId (ilike), from / to (ISO), limit (≤500). Returns before/after
 * payloads so the viewer can render change diffs.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const sp = request.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 100), 500);

  const conds = [];
  const action = sp.get("action")?.trim();
  if (action) conds.push(ilike(schema.auditEvents.action, `%${action}%`));
  const resourceType = sp.get("resourceType")?.trim();
  if (resourceType) conds.push(eq(schema.auditEvents.resourceType, resourceType));
  const resourceId = sp.get("resourceId")?.trim();
  if (resourceId) conds.push(ilike(schema.auditEvents.resourceId ?? "", `%${resourceId}%`));
  const from = sp.get("from");
  if (from && !Number.isNaN(new Date(from).getTime())) conds.push(gte(schema.auditEvents.createdAt, new Date(from)));
  const to = sp.get("to");
  if (to && !Number.isNaN(new Date(to).getTime())) conds.push(lte(schema.auditEvents.createdAt, new Date(to)));

  // Actor filter needs the id → resolve first from email pattern.
  const actor = sp.get("actor")?.trim();
  let actorIds: string[] | null = null;
  if (actor) {
    const users = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(ilike(schema.users.email, `%${actor}%`));
    actorIds = users.map((u) => u.id);
    if (actorIds.length === 0) return apiOk({ data: [] }); // nothing can match
  }

  const where = and(...conds, ...(actorIds ? [inArray(schema.auditEvents.actorId, actorIds)] : []));
  const rows = await db
    .select({
      id: schema.auditEvents.id,
      action: schema.auditEvents.action,
      resourceType: schema.auditEvents.resourceType,
      resourceId: schema.auditEvents.resourceId,
      actorId: schema.auditEvents.actorId,
      actorRole: schema.auditEvents.actorRole,
      before: schema.auditEvents.before,
      after: schema.auditEvents.after,
      ip: schema.auditEvents.ip,
      createdAt: schema.auditEvents.createdAt,
    })
    .from(schema.auditEvents)
    .where(where)
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(limit);

  const filteredRows = rows;

  const actorIdsUsed = [...new Set(filteredRows.map((r) => r.actorId).filter(Boolean))] as string[];
  const emails = new Map<string, string>();
  if (actorIdsUsed.length) {
    const users = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users);
    for (const u of users) emails.set(u.id, u.email);
  }
  return apiOk({
    data: filteredRows.map((r) => ({
      id: r.id,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      actorEmail: r.actorId ? (emails.get(r.actorId) ?? "deleted user") : "system",
      actorRole: r.actorRole,
      ipAddress: r.ip,
      before: r.before ?? null,
      after: r.after ?? null,
      createdAt: r.createdAt,
    })),
  });
}
