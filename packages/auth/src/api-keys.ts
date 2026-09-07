/**
 * Developer API keys — tenant-scoped credentials for the public API
 * (`/api/public/v1`). Full keys are returned exactly once at creation;
 * only the SHA-256 hash is persisted. Keys can be revoked (soft delete via
 * status) and carry an optional expiry.
 *
 * Wire format: `Authorization: Bearer zf_live_<prefix>_<secret>` (also
 * accepted as `x-api-key`). Prefix enables support triage without exposing
 * the secret.
 */
import { and, eq } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { schema, toJsonSafe, type Db } from "@zfloat/database";

export const API_KEY_PREFIX = "zf_live";
export const API_KEY_SECRET_BYTES = 32;

export interface ApiKeyRow {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;
  status: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface CreatedApiKey {
  key: ApiKeyRow;
  /** Full credential — show once, never persist. */
  secret: string;
}

export class ApiKeyError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ApiKeyError";
  }
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Generate a new key pair (raw + hash) without touching the DB. */
export function generateApiKeyPair(_name: string): { raw: string; prefix: string; hash: string } {
  const secret = randomBytes(API_KEY_SECRET_BYTES).toString("base64url");
  // 3 bytes → 6 hex chars: always [A-Za-z0-9]{6}, matching the documented
  // `zf_live_<prefix>_<secret>` wire format (base64url can contain -/_ which
  // the old filter-and-slice produced shorter prefixes for — intermittent
  // credential-format violations).
  const prefix = randomBytes(3).toString("hex").slice(0, 6);
  const raw = `${API_KEY_PREFIX}_${prefix}_${secret}`;
  return { raw, prefix: `${API_KEY_PREFIX}_${prefix}`, hash: hashApiKey(raw) };
}

/** Create a tenant API key. Returns the raw secret once. */
export async function createApiKey(
  db: Db,
  input: { tenantId: string; name: string; createdById?: string; expiresAt?: Date },
): Promise<CreatedApiKey> {
  if (!input.name || !input.name.trim()) {
    throw new ApiKeyError("API key name is required", "BAD_INPUT");
  }
  const { raw, prefix, hash } = generateApiKeyPair(input.name);
  const [row] = await db
    .insert(schema.apiKeys)
    .values({
      tenantId: input.tenantId,
      name: input.name.slice(0, 120),
      keyPrefix: prefix,
      keyHash: hash,
      status: "ACTIVE",
      createdById: input.createdById,
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!row) throw new ApiKeyError("failed to persist API key", "CREATE_FAILED");
  return { key: row as unknown as ApiKeyRow, secret: raw };
}

export async function listApiKeys(db: Db, tenantId: string): Promise<ApiKeyRow[]> {
  const rows = await db
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.tenantId, tenantId))
    .orderBy(schema.apiKeys.createdAt);
  return rows as unknown as ApiKeyRow[];
}

export async function revokeApiKey(db: Db, input: { keyId: string; tenantId: string }): Promise<boolean> {
  const [row] = await db
    .update(schema.apiKeys)
    .set({ status: "REVOKED" })
    .where(and(eq(schema.apiKeys.id, input.keyId), eq(schema.apiKeys.tenantId, input.tenantId)))
    .returning({ id: schema.apiKeys.id });
  return !!row;
}

export interface AuthenticatedKey {
  keyId: string;
  tenantId: string;
  name: string;
}

/**
 * Resolve a bearer credential to a tenant. Returns null when the key is
 * unknown, revoked or expired. Touches last_used_at on success (best-effort).
 */
export async function authenticateApiKey(db: Db, credential: string): Promise<AuthenticatedKey | null> {
  if (!credential.startsWith(`${API_KEY_PREFIX}_`)) return null;
  const hash = hashApiKey(credential);
  const [key] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.keyHash, hash)).limit(1);
  if (!key) return null;
  if (key.status !== "ACTIVE") return null;
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;
  await db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, key.id))
    .catch(() => undefined);
  return { keyId: key.id, tenantId: key.tenantId, name: key.name };
}

/** Extract the credential from common header shapes. */
export function extractApiCredential(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1]!.trim();
  }
  const alt = headers.get("x-api-key");
  return alt?.trim() || null;
}

export function apiKeyAuditSafe(key: { id: string; keyPrefix: string; tenantId: string }) {
  return toJsonSafe({ keyId: key.id, keyPrefix: key.keyPrefix, tenantId: key.tenantId });
}

export { randomUUID };
