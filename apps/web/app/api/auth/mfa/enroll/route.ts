import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { getDb, schema, eq, and } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { generateTOTPSecret, totpUri, encryptSecret } from "@zfloat/auth";

/**
 * POST /api/auth/mfa/enroll — start TOTP enrollment.
 * Creates a disabled factor holding the encrypted secret and returns the
 * plaintext secret + otpauth URL (displayed once, in the QR code).
 */
export async function POST(_request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  const [active] = await db
    .select()
    .from(schema.mfaFactors)
    .where(and(eq(schema.mfaFactors.userId, user!.userId), eq(schema.mfaFactors.enabled, true)))
    .limit(1);
  if (active) return apiError(409, "MFA_ALREADY_ENABLED", "Two-factor authentication is already enabled");

  const secret = generateTOTPSecret();
  // Reuse the existing pending factor if one exists (re-enrollment after an aborted setup).
  const [existing] = await db
    .select()
    .from(schema.mfaFactors)
    .where(and(eq(schema.mfaFactors.userId, user!.userId), eq(schema.mfaFactors.enabled, false)))
    .limit(1);
  if (existing) {
    await db
      .update(schema.mfaFactors)
      .set({ secretEncrypted: encryptSecret(secret) })
      .where(eq(schema.mfaFactors.id, existing.id));
  } else {
    await db.insert(schema.mfaFactors).values({
      userId: user!.userId,
      type: "TOTP",
      secretEncrypted: encryptSecret(secret),
      enabled: false,
    });
  }

  const otpauthUrl = totpUri(secret, user!.email);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 240, margin: 1 });

  return apiOk({
    data: {
      secret,
      otpauthUrl,
      qrDataUrl,
      note: "Scan the QR with your authenticator app, then confirm with POST /api/auth/mfa/verify.",
    },
  });
}
