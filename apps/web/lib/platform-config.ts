/**
 * Shared plumbing for platform-config maker-checker endpoints
 * (Phase 1 of docs/GAP-ANALYSIS.md).
 */
import { apiError } from "./api";
import { PlatformConfigError, ApprovalError } from "@zfloat/approvals";
import { eq, schema, type Db } from "@zfloat/database";

type ApiResponse = ReturnType<typeof apiError>;

/** Map engine/module error codes onto HTTP responses (same codes/messages the
 * direct-write routes used, so admin clients keep their behaviour). */
export function toApiErrorResponse(err: unknown): ApiResponse {
  if (err instanceof ApprovalError) {
    const table: Record<string, number> = {
      NOT_FOUND: 404,
      ALREADY_RESOLVED: 409,
      MAKER_CHECKER_VIOLATION: 403,
      ALREADY_ACTED: 409,
      ROLE_MISMATCH: 403,
      NO_ACTIONABLE_STEP: 409,
      NO_STEPS_REQUIRED: 400,
      CREATE_FAILED: 500,
      SNAPSHOT_MISSING: 500,
    };
    return apiError(table[err.code] ?? 400, err.code, err.message);
  }
  if (err instanceof PlatformConfigError) {
    const badRequest = new Set([
      "INVALID_CODE", "INVALID_NAME", "INVALID_ACCOUNT", "MISSING_FIELDS", "INVALID_AMOUNT",
      "EMPTY_CHANGE", "CODE_IMMUTABLE", "TARGET_REQUIRED", "UNSUPPORTED_KIND",
      "MISSING_TENANT", "INVALID_PRODUCT", "INVALID_CHANNEL", "INVALID_PROVIDER",
      "INVALID_STATUS", "INVALID_ENABLED", "UNSUPPORTED_OP", "INVALID_RULES",
    ]);
    const status = badRequest.has(err.code)
      ? 400
      : err.code === "CODE_EXISTS"
        ? 409
        : err.code === "NOT_FOUND" || err.code === "TENANT_NOT_FOUND"
          ? 404
          : 422;
    return apiError(status, err.code, err.message);
  }
  return apiError(500, "INTERNAL", err instanceof Error ? err.message : "Unexpected error");
}

/** Run a staging/decision call and convert failures into API responses. */
export async function guardApi<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; response: ApiResponse }> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, response: toApiErrorResponse(err) };
  }
}

/** The actor's role NAMES (what the approvals engine role gate matches on). */
export async function loadActorRoles(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ name: schema.roles.name })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(eq(schema.userRoles.userId, userId));
  return rows.map((r) => r.name);
}
