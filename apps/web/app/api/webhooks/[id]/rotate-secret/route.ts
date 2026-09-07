import { NextRequest } from "next/server";
import { getDb, schema, eq, and } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { writeAuditEvent } from "@zfloat/audit";
import { rotateSubscriptionSecret, SecretRotationError } from "@zfloat/payments-core";

/** POST /api/webhooks/:id/rotate-secret — replace the signing secret.
 *
 * Regeneration semantics (documented): the OLD secret stops being valid the
 * moment this completes — deliveries retried or replayed afterwards are
 * re-signed with the NEW secret, and the tenant must update its verifier.
 * The returned secret is shown exactly once. The rotation is audited with the
 * before/after secret_version. */
export async function POST(request: NextRequest, ctx: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  const [sub] = await db
    .select({ id: schema.webhookSubscriptions.id, secretVersion: schema.webhookSubscriptions.secretVersion })
    .from(schema.webhookSubscriptions)
    .where(and(eq(schema.webhookSubscriptions.id, ctx.params.id), eq(schema.webhookSubscriptions.tenantId, user!.tenantId!)))
    .limit(1);
  if (!sub) return apiError(404, "NOT_FOUND", "Webhook subscription not found");

  try {
    const rotated = await rotateSubscriptionSecret(db, ctx.params.id);
    await writeAuditEvent(db, {
      tenantId: user!.tenantId!,
      actorId: user!.userId,
      action: "webhook.secret.rotated",
      resourceType: "webhook_subscription",
      resourceId: sub.id,
      before: { secretVersion: sub.secretVersion },
      after: { secretVersion: rotated.version, rotatedAt: rotated.rotatedAt.toISOString() },
      ip: request.headers.get("x-forwarded-for") ?? undefined,
    });
    return apiOk({
      data: {
        id: rotated.id,
        secret: rotated.secret,
        secretVersion: rotated.version,
        note: "The signing secret is shown once — update your verifier now. Deliveries replayed or retried from here on are signed with this new secret.",
      },
    });
  } catch (err) {
    if (err instanceof SecretRotationError) {
      return apiError(err.code === "NOT_FOUND" ? 404 : 400, err.code, err.message);
    }
    return apiError(500, "ROTATE_FAILED", err instanceof Error ? err.message : "Rotation failed");
  }
}
