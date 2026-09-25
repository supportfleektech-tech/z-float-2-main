/**
 * PATCH /api/team/:id/identity { phone?, idType?, idNumber?, kraPin? }
 * A member may update their own identity; team.manage may update anyone in
 * the workspace. Audited.
 */
import { getDb, schema, and, eq } from "@zfloat/database";
import { loadUserPermissions } from "@zfloat/auth";
import { writeAuditEvent } from "@zfloat/audit";
import { normalizeIdentity, normalizeKenyanPhone, IdentityValidationError, maskIdentifier } from "@zfloat/validation";
import { requireUser, apiError, apiOk } from "@/lib/api";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  if (params.id !== user!.userId) {
    const perms = await loadUserPermissions(db, user!.userId);
    if (!perms.has("team.manage")) return apiError(403, "FORBIDDEN", "You can only edit your own identity details");
  }
  let b: Record<string, unknown>;
  try {
    b = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }
  let identity;
  try {
    identity = normalizeIdentity({ idType: b.idType as string, idNumber: b.idNumber as string, kraPin: b.kraPin as string });
  } catch (err) {
    if (err instanceof IdentityValidationError) return apiError(400, "INVALID_IDENTITY", err.message, { field: err.field });
    throw err;
  }
  let phone: string | null | undefined;
  if (b.phone !== undefined) {
    phone = b.phone ? normalizeKenyanPhone(String(b.phone)) : null;
    if (b.phone && !phone) return apiError(400, "INVALID_PHONE", "Enter a valid Kenyan phone number");
  }
  const [row] = await db
    .update(schema.users)
    .set({ ...identity, ...(phone !== undefined ? { phone } : {}), updatedAt: new Date() })
    .where(and(eq(schema.users.id, params.id), eq(schema.users.tenantId, user!.tenantId!)))
    .returning({ id: schema.users.id, idType: schema.users.idType, idNumber: schema.users.idNumber, kraPin: schema.users.kraPin, phone: schema.users.phone });
  if (!row) return apiError(404, "NOT_FOUND", "Team member not found");
  await writeAuditEvent(db, {
    tenantId: user!.tenantId!,
    actorId: user!.userId,
    action: "user.identity_updated",
    resourceType: "user",
    resourceId: row.id,
    after: { idType: row.idType, idNumber: maskIdentifier(row.idNumber), kraPin: row.kraPin ? `${row.kraPin.slice(0, 2)}…${row.kraPin.slice(-2)}` : null },
  }).catch(() => undefined);
  return apiOk({ data: { ...row, idNumber: maskIdentifier(row.idNumber) || null } });
}
