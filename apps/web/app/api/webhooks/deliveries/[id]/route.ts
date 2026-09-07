import { NextRequest } from "next/server";
import { getDb, schema, eq, and } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";

/** GET /api/webhooks/deliveries/:id — full DLQ/delivery record for inspection:
 * the exact payload bytes sent (payloadBody), the signature used, attempts,
 * last HTTP status and the last error. Tenant-scoped. */
export async function GET(_request: NextRequest, ctx: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const [d] = await db
    .select()
    .from(schema.webhookDeliveries)
    .where(and(eq(schema.webhookDeliveries.id, ctx.params.id), eq(schema.webhookDeliveries.tenantId, user!.tenantId!)))
    .limit(1);
  if (!d) return apiError(404, "NOT_FOUND", "Delivery not found");
  return apiOk({
    data: {
      id: d.id,
      subscriptionId: d.subscriptionId,
      eventType: d.eventType,
      status: d.status,
      attempts: d.attempts,
      responseStatus: d.responseStatus,
      lastError: d.lastError,
      signature: d.signature,
      payload: d.payload,
      payloadBody: d.payloadBody,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      nextRetryAt: d.nextRetryAt,
    },
  });
}
