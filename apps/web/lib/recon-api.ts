/**
 * Recon workflow API context — resolves WHO is acting and HOW FAR they can go.
 *
 *  - Platform admins (admin.* permission) operate cross-tenant: ctx.tenantId is
 *    null and the engine is called unscoped.
 *  - Tenant members act strictly inside their own tenant. Actions that CHANGE
 *    exception state additionally require `reconciliation.manage` (seeded on
 *    OWNER/ADMIN/FINANCE_MANAGER); the read-only list stays open to any
 *    signed-in member, matching the pre-existing reconciliation pages.
 */
import type { NextResponse } from "next/server";
import { getDb, type Db } from "@zfloat/database";
import { loadUserPermissions } from "@zfloat/auth";
import { apiError, requireUser, type ApiErrorBody } from "@/lib/api";

export interface ReconApiCtx {
  db: Db;
  actorId: string;
  /** Tenant scope. NULL = platform admin acting across all tenants. */
  tenantId: string | null;
  isPlatformAdmin: boolean;
}

export type ReconGuardResult = { ctx: ReconApiCtx } | { response: NextResponse<ApiErrorBody> };

export async function reconApiContext(requireManage = false): Promise<ReconGuardResult> {
  const { user, response } = await requireUser();
  if (response) return { response };
  const { db } = getDb();
  const perms = await loadUserPermissions(db, user!.userId);
  const isPlatformAdmin =
    perms.has("admin.tenants") ||
    perms.has("admin.audit") ||
    perms.has("admin.health") ||
    perms.has("admin.pricing") ||
    perms.has("admin.recon");
  if (isPlatformAdmin) {
    return { ctx: { db, actorId: user!.userId, tenantId: null, isPlatformAdmin: true } };
  }
  if (requireManage && !perms.has("reconciliation.manage")) {
    return {
      response: apiError(403, "FORBIDDEN", `You need the "reconciliation.manage" permission to resolve or comment on exceptions.`),
    };
  }
  if (!user!.tenantId) {
    return { response: apiError(403, "TENANT_CONTEXT_REQUIRED", "Your account is not bound to a tenant.") };
  }
  return { ctx: { db, actorId: user!.userId, tenantId: user!.tenantId, isPlatformAdmin: false } };
}

/** Map engine errors to HTTP responses. */
export function reconErrorResponse(err: unknown): NextResponse<ApiErrorBody> {
  const e = err as { code?: string; message?: string };
  if (e?.code === "NOT_FOUND") return apiError(404, "NOT_FOUND", e.message ?? "Recon exception not found");
  if (e?.code === "INVALID_STATUS") return apiError(409, "INVALID_STATUS", e.message ?? "Action not allowed in the current status");
  if (e?.code?.endsWith("_REQUIRED") || e?.code === "NOTE_TOO_LONG") return apiError(422, e.code, e.message ?? "Invalid note");
  return apiError(500, "INTERNAL", err instanceof Error ? err.message : "Unexpected error");
}
