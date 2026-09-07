import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { apiError, rateLimit } from "@/lib/api";
import { authenticateApiKey, extractApiCredential, type AuthenticatedKey } from "@zfloat/auth";

export interface PublicApiContext {
  auth: AuthenticatedKey;
}

/**
 * Guard for /api/public/v1 — API-key auth (Bearer zf_live_… or x-api-key),
 * tenant resolution, fixed-window rate limit, consistent error bodies.
 */
export async function requirePublicApiKey(request: NextRequest): Promise<{ ctx: PublicApiContext | null; response: Response | null }> {
  const { db } = getDb();
  const credential = extractApiCredential(request.headers);
  if (!credential) {
    return { ctx: null, response: apiError(401, "UNAUTHENTICATED", "Missing API key — send Authorization: Bearer zf_live_… or x-api-key.") };
  }
  const auth = await authenticateApiKey(db, credential);
  if (!auth) {
    return { ctx: null, response: apiError(401, "INVALID_API_KEY", "Unknown, revoked or expired API key.") };
  }
  const allowed = await rateLimit(`apikey:${auth.keyId}`, { windowMs: 60_000, max: 60 });
  if (!allowed) {
    return { ctx: null, response: apiError(429, "RATE_LIMITED", "Rate limit exceeded (60 requests/minute per key).") };
  }
  return { ctx: { auth }, response: null };
}

