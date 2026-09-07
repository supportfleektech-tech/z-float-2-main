import { NextRequest } from "next/server";
import { getDb, schema, eq } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";

/** PATCH /api/payment-links/:id — pause / resume / close a link. */
export async function PATCH(request: NextRequest, ctx: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const status = String(b.status ?? "");
  if (!["ACTIVE", "PAUSED", "CLOSED"].includes(status)) return apiError(400, "INVALID_STATUS", "Status must be ACTIVE, PAUSED or CLOSED");

  const [existing] = await db.select().from(schema.paymentLinks).where(eq(schema.paymentLinks.id, ctx.params.id)).limit(1);
  if (!existing || existing.tenantId !== user!.tenantId) return apiError(404, "NOT_FOUND", "Payment link not found");

  await db.update(schema.paymentLinks).set({ status, updatedAt: new Date() }).where(eq(schema.paymentLinks.id, existing.id));
  return apiOk({ data: { id: existing.id, status } });
}
