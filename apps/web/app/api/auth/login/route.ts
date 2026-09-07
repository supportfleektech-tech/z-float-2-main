import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb, schema, eq, and, sql } from "@zfloat/database";
import { verifyPassword, createSession, verifyTOTP, decryptSecret } from "@zfloat/auth";
import { apiError, apiOk, SESSION_COOKIE, rateLimit } from "@/lib/api";
import { writeSecurityEvent, writeAuditEvent } from "@zfloat/audit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  otpCode: z.string().length(6).optional(),
});

export async function POST(request: Request) {
  const { db } = getDb();
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // 20 attempts/min/IP by default (brute-force posture). AUTH_LOGIN_RATE_MAX
  // exists ONLY for the sandbox/demo test posture (the E2E suite signs in more
  // than 20 times per minute from one IP); production keeps the default.
  const max = Number(process.env.AUTH_LOGIN_RATE_MAX) > 0 ? Number(process.env.AUTH_LOGIN_RATE_MAX) : 20;
  if (!(await rateLimit(`login:${ip}`, { windowMs: 60_000, max }))) {
    return apiError(
      429,
      "RATE_LIMITED",
      "Too many attempts — try again shortly",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION", "Invalid email or password format");
  }
  const { email, password, otpCode } = parsed.data;

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase()))
    .limit(1);
  if (!user || !user.passwordHash) {
    await writeSecurityEvent(db, {
      userId: user?.id,
      eventType: "login.failed.unknown_user",
      severity: "WARN",
      details: { email },
      ip,
    });
    return apiError(401, "INVALID_CREDENTIALS", "Incorrect email or password");
  }

  // lockout after repeated failures
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return apiError(
      423,
      "ACCOUNT_LOCKED",
      "Account temporarily locked after repeated failures",
    );
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    const lock = attempts >= 5;
    await db
      .update(schema.users)
      .set({
        failedLoginAttempts: attempts,
        lockedUntil: lock ? new Date(Date.now() + 15 * 60_000) : null,
      })
      .where(eq(schema.users.id, user.id));
    await writeSecurityEvent(db, {
      tenantId: user.tenantId ?? undefined,
      userId: user.id,
      eventType: "login.failed.bad_password",
      severity: lock ? "CRITICAL" : "WARN",
      details: { attempts },
      ip,
    });
    return apiError(401, "INVALID_CREDENTIALS", "Incorrect email or password");
  }

  // MFA step-up: require TOTP when enabled
  if (user.mfaEnabled) {
    if (!otpCode) {
      return apiOk({ mfaRequired: true, mfaType: "totp" }, { status: 200 });
    }
    const factors = await db
      .select()
      .from(schema.mfaFactors)
      .where(
        and(
          eq(schema.mfaFactors.userId, user.id),
          eq(schema.mfaFactors.enabled, true),
        ),
      );
    const valid = factors.some(
      (f) => f.secretEncrypted && verifyTOTP(decryptSecret(f.secretEncrypted), otpCode),
    );
    // Fallback: one-time 6-digit backup codes (sha256-stored, single use).
    let backupUsed = false;
    if (!valid) {
      const hash = createHash("sha256").update(otpCode).digest("hex");
      const [backup] = await db
        .select()
        .from(schema.mfaBackupCodes)
        .where(and(eq(schema.mfaBackupCodes.userId, user.id), eq(schema.mfaBackupCodes.codeHash, hash), sql`${schema.mfaBackupCodes.usedAt} IS NULL`))
        .limit(1);
      if (backup) {
        await db
          .update(schema.mfaBackupCodes)
          .set({ usedAt: new Date() })
          .where(eq(schema.mfaBackupCodes.id, backup.id));
        backupUsed = true;
      }
    }
    if (!valid && !backupUsed) {
      await writeSecurityEvent(db, {
        tenantId: user.tenantId ?? undefined,
        userId: user.id,
        eventType: "login.failed.otp",
        severity: "WARN",
        ip,
      });
      return apiError(401, "INVALID_OTP", "Incorrect verification code");
    }
  }

  const { token, expiresAt } = await createSession(db, {
    userId: user.id,
    tenantId: user.tenantId ?? undefined,
    ip,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  await db
    .update(schema.users)
    .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(schema.users.id, user.id));
  await writeAuditEvent(db, {
    tenantId: user.tenantId ?? undefined,
    actorId: user.id,
    action: "auth.login",
    resourceType: "user",
    resourceId: user.id,
    ip,
  });
  await writeSecurityEvent(db, {
    tenantId: user.tenantId ?? undefined,
    userId: user.id,
    eventType: "login.success",
    ip,
  });

  const response = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      mfaEnabled: user.mfaEnabled,
    },
  });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return response;
}
