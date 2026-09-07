import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { getDb, schema, eq, desc } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { encryptSecret } from "@zfloat/auth";
import { OUTBOUND_EVENTS } from "@zfloat/payments-core";

const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

/** GET /api/webhooks — tenant's outbound webhook endpoints + recent deliveries. */
export async function GET(_request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const subs = await db
    .select()
    .from(schema.webhookSubscriptions)
    .where(eq(schema.webhookSubscriptions.tenantId, user!.tenantId!))
    .orderBy(desc(schema.webhookSubscriptions.createdAt));
  const deliveries = await db
    .select()
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.tenantId, user!.tenantId!))
    .orderBy(desc(schema.webhookDeliveries.createdAt))
    .limit(25);
  return apiOk({
    data: {
      subscriptions: subs.map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        events: s.events,
        status: s.status,
        secretVersion: s.secretVersion,
        secretRotatedAt: s.secretRotatedAt,
        createdAt: s.createdAt,
      })),
      deliveries: deliveries.map((d) => ({
        id: d.id,
        subscriptionId: d.subscriptionId,
        eventType: d.eventType,
        status: d.status,
        attempts: d.attempts,
        responseStatus: d.responseStatus,
        lastError: d.lastError,
        signature: d.signature,
        createdAt: d.createdAt,
        nextRetryAt: d.nextRetryAt,
      })),
      events: OUTBOUND_EVENTS,
    },
  });
}

/** POST /api/webhooks — subscribe an endpoint. */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  const url = String(b.url ?? "").trim();
  const events = Array.isArray(b.events) ? b.events.map(String) : [];

  if (!name) return apiError(400, "NAME_REQUIRED", "Give this endpoint a name");
  if (!URL_RE.test(url)) return apiError(400, "INVALID_URL", "Enter a valid https:// endpoint URL");
  const validEvents = events.filter((e) => (OUTBOUND_EVENTS as readonly string[]).includes(e));
  if (validEvents.length === 0) return apiError(400, "INVALID_EVENTS", "Pick at least one event to subscribe to");

  // Tenant-provided secret or auto-generated; encrypted at rest, never returned again.
  const rawSecret = String(b.secret ?? "").trim() || randomBytes(24).toString("hex");

  const [sub] = await db
    .insert(schema.webhookSubscriptions)
    .values({
      tenantId: user!.tenantId!,
      name,
      url,
      secretEncrypted: encryptSecret(rawSecret),
      events: validEvents,
      status: "ACTIVE",
      createdById: user!.userId,
    })
    .returning();
  if (!sub) return apiError(500, "SUBSCRIBE_FAILED", "Could not create webhook subscription");

  return apiOk(
    {
      data: {
        id: sub.id,
        name: sub.name,
        url: sub.url,
        events: sub.events,
        status: sub.status,
        secret: rawSecret,
        note: "The signing secret is shown once — keep it to verify x-zfloat-signature payloads.",
      },
    },
    { status: 201 },
  );
}
