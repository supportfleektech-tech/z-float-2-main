import { NextRequest } from "next/server";
import { getDb, schema, eq, and } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { writeAuditEvent } from "@zfloat/audit";
import { replayDelivery, DeliveryReplayError } from "@zfloat/payments-core";

/** POST /api/webhooks/deliveries/:id/replay — re-enqueue a FAILED delivery
 * from the DLQ. The attempt state resets and the next delivery re-signs with
 * the subscription's CURRENT secret (so replaying after a secret rotation
 * sends a fresh signature). Audited for the tenant trail. */
export async function POST(_request: NextRequest, ctx: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  const [d] = await db
    .select({ id: schema.webhookDeliveries.id, status: schema.webhookDeliveries.status, attempts: schema.webhookDeliveries.attempts, lastError: schema.webhookDeliveries.lastError })
    .from(schema.webhookDeliveries)
    .where(and(eq(schema.webhookDeliveries.id, ctx.params.id), eq(schema.webhookDeliveries.tenantId, user!.tenantId!)))
    .limit(1);
  if (!d) return apiError(404, "NOT_FOUND", "Delivery not found");

  try {
    const out = await replayDelivery(db, ctx.params.id);
    await writeAuditEvent(db, {
      tenantId: user!.tenantId!,
      actorId: user!.userId,
      action: "webhook.delivery.replayed",
      resourceType: "webhook_delivery",
      resourceId: d.id,
      before: { status: d.status, attempts: d.attempts, lastError: d.lastError },
      after: { status: out.status, attempts: out.attempt },
    });
    return apiOk({ data: out });
  } catch (err) {
    if (err instanceof DeliveryReplayError) {
      const status = err.code === "NOT_FOUND" ? 404 : 409;
      return apiError(status, err.code, err.message);
    }
    return apiError(500, "REPLAY_FAILED", err instanceof Error ? err.message : "Replay failed");
  }
}
