/**
 * Session management — opaque random tokens stored as SHA-256 hashes (a DB
 * leak never exposes live sessions), with expiry, revocation and rotation.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";

export const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateSessionInput {
  userId: string;
  tenantId?: string;
  ip?: string;
  userAgent?: string;
  deviceName?: string;
  ttlMs?: number;
}

export async function createSession(db: Db, input: CreateSessionInput): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? SESSION_TTL_MS));
  await db.insert(schema.sessions).values({
    userId: input.userId,
    tenantId: input.tenantId,
    tokenHash: hashToken(token),
    ip: input.ip,
    userAgent: input.userAgent,
    deviceName: input.deviceName,
    expiresAt,
  });
  return { token, expiresAt };
}

export interface SessionUser {
  sessionId: string;
  userId: string;
  tenantId: string | null;
  email: string;
  fullName: string;
  mfaEnabled: boolean;
  expiresAt: Date;
}

/** Validate a token; returns session + user, or null. */
export async function validateSession(db: Db, token: string): Promise<SessionUser | null> {
  const tokenHash = hashToken(token);
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.tokenHash, tokenHash), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  if (!session || session.revokedAt) return null;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId)).limit(1);
  if (!user || user.status !== "ACTIVE") return null;

  // touch last_seen (throttled by caller frequency — fine at this scale)
  await db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, session.id));

  return {
    sessionId: session.id,
    userId: user.id,
    tenantId: session.tenantId ?? user.tenantId,
    email: user.email,
    fullName: user.fullName,
    mfaEnabled: user.mfaEnabled,
    expiresAt: session.expiresAt,
  };
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.tokenHash, hashToken(token)));
}

/** Revoke every session of a user (password change, suspicious activity). */
export async function revokeAllUserSessions(db: Db, userId: string): Promise<void> {
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
}

export async function listUserSessions(db: Db, userId: string) {
  return db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId)).orderBy(schema.sessions.createdAt);
}
