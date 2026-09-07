import { NextRequest } from "next/server";
import { getDb, schema, eq } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { revokeApiKey } from "@zfloat/auth";
import { writeAuditEvent } from "@zfloat/audit";

/** Revoke a tenant API key. Takes effect immediately (hash removed from lookups). */
export async function POST(_request: NextRequest, ctx: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!user!.tenantId) return apiError(403, "NO_TENANT", "Your account is not bound to a workspace.");
  const { db } = getDb();

  const [key] = await db
    .select({ id: schema.apiKeys.id, keyPrefix: schema.apiKeys.keyPrefix })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.id, ctx.params.id))
    .limit(1);
  if (!key) return apiError(404, "NOT_FOUND", "Key not found.");

  const ok = await revokeApiKey(db, { keyId: key.id, tenantId: user!.tenantId });
  if (!ok) return apiError(403, "FORBIDDEN", "Key does not belong to your workspace.");
  await writeAuditEvent(db, {
    tenantId: user!.tenantId,
    actorId: user!.userId,
    actorRole: "OWNER",
    action: "api_key.revoked",
    resourceType: "api_key",
    resourceId: key.id,
    after: { keyPrefix: key.keyPrefix },
  });
  return apiOk({ data: { revoked: true, id: key.id } });
}
