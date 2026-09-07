import { NextRequest } from "next/server";
import { getDb, schema, eq, and } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { decryptSecret } from "@zfloat/auth";
import { signPayload } from "@zfloat/payments-core";
import { enqueue } from "@zfloat/queue";

/** PATCH /api/webhooks/:id — update url/events/status or send a test ping. */
export async function PATCH(request: NextRequest, ctx: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const [sub] = await db
    .select()
    .from(schema.webhookSubscriptions)
    .where(and(eq(schema.webhookSubscriptions.id, ctx.params.id), eq(schema.webhookSubscriptions.tenantId, user!.tenantId!)))
    .limit(1);
  if (!sub) return apiError(404, "NOT_FOUND", "Webhook subscription not found");

  if (b.status === "ACTIVE" || b.status === "DISABLED") {
    await db.update(schema.webhookSubscriptions).set({ status: b.status, updatedAt: new Date() }).where(eq(schema.webhookSubscriptions.id, sub.id));
    return apiOk({ data: { id: sub.id, status: b.status } });
  }

  if (b.test === true) {
    const payload = { eventType: "ping", message: "Z-float webhook test", sentAt: new Date().toISOString() };
    const [delivery] = await db
      .insert(schema.webhookDeliveries)
      .values({
        tenantId: user!.tenantId!,
        subscriptionId: sub.id,
        eventType: "ping",
        payload,
        signature: signPayload(decryptSecret(sub.secretEncrypted), payload),
        status: "PENDING",
      })
      .returning({ id: schema.webhookDeliveries.id });
    if (delivery) {
      await enqueue("webhooks.deliver", {
        correlationId: `whd-${delivery.id}`,
        tenantId: user!.tenantId!,
        deliveryId: delivery.id,
        attempt: 1,
      });
    }
    return apiOk({ data: { testSent: true, deliveryId: delivery?.id } });
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof b.name === "string" && b.name.trim()) set.name = b.name.trim();
  if (typeof b.url === "string" && b.url.trim()) {
    if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(b.url.trim())) return apiError(400, "INVALID_URL", "Enter a valid https:// endpoint URL");
    set.url = b.url.trim();
  }
  if (Array.isArray(b.events)) {
    const events = b.events.map(String);
    if (events.length === 0) return apiError(400, "INVALID_EVENTS", "Pick at least one event");
    set.events = events;
  }
  await db.update(schema.webhookSubscriptions).set(set).where(eq(schema.webhookSubscriptions.id, sub.id));
  return apiOk({ data: { id: sub.id, updated: true } });
}

/** DELETE /api/webhooks/:id — remove a subscription. */
export async function DELETE(_request: NextRequest, ctx: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  await db
    .delete(schema.webhookSubscriptions)
    .where(and(eq(schema.webhookSubscriptions.id, ctx.params.id), eq(schema.webhookSubscriptions.tenantId, user!.tenantId!)));
  return apiOk({ data: { deleted: true } });
}
