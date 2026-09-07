import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { createApiKey, listApiKeys } from "@zfloat/auth";
import { writeAuditEvent } from "@zfloat/audit";

/**
 * GET /api/developers/keys — list tenant API keys (no secrets).
 * POST /api/developers/keys — create; the raw credential is returned once.
 */
export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!user!.tenantId) return apiError(403, "NO_TENANT", "Your account is not bound to a workspace.");
  const { db } = getDb();
  const keys = await listApiKeys(db, user!.tenantId);
  return apiOk({ data: { keys } });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!user!.tenantId) return apiError(403, "NO_TENANT", "Your account is not bound to a workspace.");
  const { db } = getDb();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  if (!name) return apiError(400, "BAD_REQUEST", "name is required.");

  const created = await createApiKey(db, { tenantId: user!.tenantId, name, createdById: user!.userId });
  await writeAuditEvent(db, {
    tenantId: user!.tenantId,
    actorId: user!.userId,
    actorRole: "OWNER",
    action: "api_key.created",
    resourceType: "api_key",
    resourceId: created.key.id,
    after: { name, keyPrefix: created.key.keyPrefix },
  });
  return apiOk({
    data: {
      key: created.key,
      secret: created.secret, // shown exactly once — never returned again
      note: "Copy this key now — for security it will not be shown again.",
    },
  });
}
