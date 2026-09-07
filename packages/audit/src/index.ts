/**
 * Audit service — append-only audit trail for financially material and
 * privileged actions. The DB trigger blocks UPDATE/DELETE on audit_events.
 */
import { schema, toJsonSafe, type Db } from "@zfloat/database";

export interface AuditInput {
  tenantId?: string;
  actorId?: string;
  actorRole?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  correlationId?: string;
}

export async function writeAuditEvent(db: Db, input: AuditInput): Promise<string> {
  const [row] = await db
    .insert(schema.auditEvents)
    .values({
      tenantId: input.tenantId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      before: input.before !== undefined ? (toJsonSafe(input.before) as Record<string, unknown>) : undefined,
      after: input.after !== undefined ? (toJsonSafe(input.after) as Record<string, unknown>) : undefined,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
      correlationId: input.correlationId,
    })
    .returning();
  return row!.id;
}

/** Record a security-relevant event (login failures, suspicious activity...). */
export async function writeSecurityEvent(
  db: Db,
  input: { tenantId?: string; userId?: string; eventType: string; severity?: "INFO" | "WARN" | "CRITICAL"; details?: unknown; ip?: string },
): Promise<string> {
  const [row] = await db
    .insert(schema.securityEvents)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      eventType: input.eventType,
      severity: input.severity ?? "INFO",
      details: input.details !== undefined ? (toJsonSafe(input.details) as Record<string, unknown>) : undefined,
      ip: input.ip,
    })
    .returning();
  return row!.id;
}

export * from "./dsar.js";
