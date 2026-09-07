import { createHash, randomInt } from "node:crypto";
import { NextRequest } from "next/server";
import { getDb, schema, eq, and } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { verifyTOTP, decryptSecret } from "@zfloat/auth";
import { writeAuditEvent, writeSecurityEvent } from "@zfloat/audit";

/** Six-digit one-time backup codes — sha256-hashed at rest, single use. */
function generateBackupCodes(n = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    codes.push(randomInt(0, 1_000_000).toString().padStart(6, "0"));
  }
  return codes;
}

/**
 * POST /api/auth/mfa/verify — confirm the code from the authenticator app,
 * enable the factor, and issue one-time backup codes (returned exactly once).
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

  const [factor] = await db
    .select()
    .from(schema.mfaFactors)
    .where(and(eq(schema.mfaFactors.userId, user!.userId), eq(schema.mfaFactors.enabled, false)))
    .limit(1);
  if (!factor) return apiError(404, "NO_PENDING_FACTOR", "Start enrollment first (POST /api/auth/mfa/enroll)");

  if (!verifyTOTP(decryptSecret(factor.secretEncrypted), code)) {
    await writeSecurityEvent(db, { tenantId: user!.tenantId ?? undefined, userId: user!.userId, eventType: "mfa.enroll.failed_bad_code", severity: "WARN", ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() });
    return apiError(400, "INVALID_CODE", "That code did not match — check your authenticator app");
  }

  await db
    .update(schema.mfaFactors)
    .set({ enabled: true, verifiedAt: new Date() })
    .where(eq(schema.mfaFactors.id, factor.id));
  await db.update(schema.users).set({ mfaEnabled: true, updatedAt: new Date() }).where(eq(schema.users.id, user!.userId));

  // Replace any old backup codes, issue fresh ones (plaintext returned once).
  await db.delete(schema.mfaBackupCodes).where(eq(schema.mfaBackupCodes.userId, user!.userId));
  const codes = generateBackupCodes();
  for (const c of codes) {
    await db.insert(schema.mfaBackupCodes).values({
      userId: user!.userId,
      codeHash: createHash("sha256").update(c).digest("hex"),
    });
  }

  await writeAuditEvent(db, { tenantId: user!.tenantId ?? undefined, actorId: user!.userId, action: "mfa.enabled", resourceType: "user", resourceId: user!.userId });
  return apiOk({
    data: {
      enabled: true,
      backupCodes: codes,
      note: "Backup codes are shown once — store them somewhere safe. Each can be used a single time.",
    },
  });
}
