import { NextRequest } from "next/server";
import { getDb, schema, desc, eq, and, isNull, count, sql, inArray } from "@zfloat/database";
import { getSessionUser, apiOk, apiError } from "@/lib/api";

/**
 * Notifications for the signed-in tenant.
 * GET  → latest notifications; ?channel=IN_APP (default) keeps the bell fast,
 *        ?channel=ALL returns EMAIL/SMS rows too with recipient info.
 * POST → mark IN_APP rows read ({action:"markRead"}).
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in to continue");
  if (!user.tenantId) return apiError(403, "NO_TENANT", "Your account is not linked to a tenant");

  const channel = (request.nextUrl.searchParams.get("channel") ?? "IN_APP").toUpperCase();
  if (!["IN_APP", "EMAIL", "SMS", "ALL"].includes(channel)) {
    return apiError(400, "INVALID_CHANNEL", "channel must be IN_APP, EMAIL, SMS or ALL");
  }

  const { db } = getDb();
  const [unreadRow] = await db
    .select({ n: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.tenantId, user.tenantId), eq(schema.notifications.channel, "IN_APP"), isNull(schema.notifications.readAt)));

  const scoped =
    channel === "ALL"
      ? and(eq(schema.notifications.tenantId, user.tenantId))
      : and(eq(schema.notifications.tenantId, user.tenantId), eq(schema.notifications.channel, channel));

  const rows = await db
    .select({
      id: schema.notifications.id,
      channel: schema.notifications.channel,
      title: schema.notifications.title,
      body: schema.notifications.body,
      status: schema.notifications.status,
      sentAt: schema.notifications.sentAt,
      createdAt: schema.notifications.createdAt,
      readAt: schema.notifications.readAt,
      userId: schema.notifications.userId,
    })
    .from(schema.notifications)
    .where(scoped)
    .orderBy(desc(sql`${schema.notifications.readAt} IS NULL`), desc(schema.notifications.createdAt))
    .limit(60);

  // Resolve recipient display (email/phone) for out-of-band rows.
  const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
  const users = userIds.length
    ? await db
        .select({ id: schema.users.id, email: schema.users.email, phone: schema.users.phone })
        .from(schema.users)
        .where(inArray(schema.users.id, userIds))
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const items = rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    title: r.title,
    body: r.body,
    status: r.status,
    sentAt: r.sentAt,
    createdAt: r.createdAt,
    readAt: r.readAt,
    data: undefined, // never leak raw data blobs to the UI
    recipient: r.userId
      ? r.channel === "SMS"
        ? userMap.get(r.userId)?.phone ?? null
        : userMap.get(r.userId)?.email ?? null
      : null,
  }));

  return apiOk({ items, unreadCount: Number(unreadRow?.n ?? 0) });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in to continue");
  if (!user.tenantId) return apiError(403, "NO_TENANT", "Your account is not linked to a tenant");

  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "markRead") return apiError(400, "INVALID_ACTION", "Unsupported action");

  const { db } = getDb();
  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.tenantId, user.tenantId), eq(schema.notifications.channel, "IN_APP"), isNull(schema.notifications.readAt)));

  return apiOk({ marked: true });
}
