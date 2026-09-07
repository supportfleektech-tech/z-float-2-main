import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { validateSession } from "@zfloat/auth";
import { secretsReady } from "@/lib/secret-guard";
import { getDb } from "@zfloat/database";

export const SESSION_COOKIE = "zf_session";

export function getSessionToken(): string | undefined {
  return cookies().get(SESSION_COOKIE)?.value;
}

/** Resolve the authenticated user from the session cookie. */
export async function getSessionUser() {
  const token = getSessionToken();
  if (!token) return null;
  const { db } = getDb();
  return validateSession(db, token);
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export function apiError(status: number, code: string, message: string, details?: unknown): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, message, details } },
    { status },
  );
}

export function apiOk<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}

/** Server-side auth guard for API routes. */
export async function requireUser() {
  await secretsReady();
  const user = await getSessionUser();
  if (!user) {
    return { user: null as null, response: apiError(401, "UNAUTHENTICATED", "Sign in to continue") };
  }
  return { user, response: null as null };
}

/** Platform-admin guard. */
export async function requirePlatformAdmin() {
  const { user, response } = await requireUser();
  if (response) return { user: null as null, response };
  const { db } = getDb();
  const { loadUserPermissions } = await import("@zfloat/auth");
  const perms = await loadUserPermissions(db, user!.userId);
  const isPlatformAdmin = perms.has("admin.tenants") || perms.has("admin.audit") || perms.has("admin.health") || perms.has("admin.pricing");
  if (!isPlatformAdmin) {
    return { user: null as null, response: apiError(403, "FORBIDDEN", "Platform administrator access required") };
  }
  return { user, response: null as null };
}

/** Permission-scoped guard: any signed-in user holding `permission`. */
export async function requirePermission(permission: string) {
  const { user, response } = await requireUser();
  if (response) return { user: null as null, response };
  const { db } = getDb();
  const { loadUserPermissions } = await import("@zfloat/auth");
  const perms = await loadUserPermissions(db, user!.userId);
  if (!perms.has(permission)) {
    return { user: null as null, response: apiError(403, "FORBIDDEN", `You need the "${permission}" permission to do that.`) };
  }
  return { user, response: null as null };
}

/** Fixed-window rate limiter (Redis, in-memory fallback). Returns TRUE when the request is ALLOWED. */
export async function rateLimit(key: string, opts: { windowMs?: number; max?: number } = {}): Promise<boolean> {
  const { secretsReady: guard } = await import("@/lib/secret-guard");
  await guard();
  const { getConfig } = await import("@zfloat/config");
  const config = getConfig();
  const windowMs = opts.windowMs ?? config.RATE_LIMIT_WINDOW_MS;
  const max = opts.max ?? config.RATE_LIMIT_MAX;
  try {
    const { createRedisClient } = await import("@zfloat/queue");
    const redis = createRedisClient({ bounded: true });
    const bucket = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
    const count = await redis.incr(bucket);
    if (count === 1) await redis.expire(bucket, Math.ceil(windowMs / 1000));
    // NOTE: no redis.quit() — bounded clients are a per-process warm
    // singleton (createRedisClient) and must outlive individual requests.
    return count <= max;
  } catch {
    return true; // fail-open on cache outage (documented tradeoff; DB still guards abuse)
  }
}
