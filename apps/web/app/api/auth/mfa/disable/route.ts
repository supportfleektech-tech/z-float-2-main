import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { getDb, schema, eq, and, sql } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { verifyTOTP, decryptSecret } from "@zfloat/auth";
import { writeAuditEvent, writeSecurityEvent } from "@zfloat/audit";

/**
 * POST /api/auth/mfa/disable — turn MFA off after proving a current TOTP
 * code (or an unused backup code).
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }
  const code = String((body as Record<string, unknown>).code ?? "").trim();
  if (!code) return apiError(400, "CODE_REQUIRED", "Enter your current verification code");

  const [factor] = await db
    .select()
    .from(schema.mfaFactors)
    .where(and(eq(schema.mfaFactors.userId, user!.userId), eq(schema.mfaFactors.enabled, true)))
    .limit(1);

  let valid = factor ? verifyTOTP(decryptSecret(factor.secretEncrypted), code) : false;
  if (!valid) {
    const hash = createHash("sha256").update(code).digest("hex");
    const [backup] = await db
      .select()
      .from(schema.mfaBackupCodes)
      .where(and(eq(schema.mfaBackupCodes.userId, user!.userId), eq(schema.mfaBackupCodes.codeHash, hash), sql`${schema.mfaBackupCodes.usedAt} IS NULL`))
      .limit(1);
    if (backup) {
      await db.update(schema.mfaBackupCodes).set({ usedAt: new Date() }).where(eq(schema.mfaBackupCodes.id, backup.id));
      valid = true;
    }
  }
  if (!valid) {
    await writeSecurityEvent(db, { tenantId: user!.tenantId ?? undefined, userId: user!.userId, eventType: "mfa.disable.failed_bad_code", severity: "WARN", ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() });
    return apiError(400, "INVALID_CODE", "That code did not match");
  }

  await db.delete(schema.mfaFactors).where(eq(schema.mfaFactors.userId, user!.userId));
  await db.delete(schema.mfaBackupCodes).where(eq(schema.mfaBackupCodes.userId, user!.userId));
  await db.update(schema.users).set({ mfaEnabled: false, updatedAt: new Date() }).where(eq(schema.users.id, user!.userId));

  await writeAuditEvent(db, { tenantId: user!.tenantId ?? undefined, actorId: user!.userId, action: "mfa.disabled", resourceType: "user", resourceId: user!.userId });
  return apiOk({ data: { enabled: false } });
}
