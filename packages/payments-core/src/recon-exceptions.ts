/**
 * Reconciliation exception workflow (GAP-ANALYSIS Phase 3).
 *
 * Recon exceptions (AMOUNT_MISMATCH / UNMATCHED / DUPLICATE / UNKNOWN / ORPHAN)
 * surface money that does not tie back cleanly — provider statement rows or
 * webhook orphans with no exact internal match. Before this module they were
 * write-only: raised by the reconciliation engine and listed, with no way to
 * act. The workflow here gives operators an auditable in-app lifecycle:
 *
 *   OPEN ──resolve(note)──▶ RESOLVED ──reopen(note?)──▶ OPEN
 *     │                        │
 *     └──comment(note)─────────┴──comment(note)── (any status)
 *
 *  - resolve   requires a resolution note; stamps resolved_by/resolved_at and
 *              keeps the note on the exception.
 *  - reopen    returns a resolved exception to OPEN (the resolution note is
 *              cleared from the row; the original resolution stays in the
 *              activity history — nothing is lost).
 *  - comment   records a note without changing state (e.g. "checking with the
 *              bank", "waiting on provider file").
 *
 * Every action is appended to recon_exception_activity AND written to the
 * audit log (reconciliation.exception.resolved|reopened|commented) with
 * before/after status, so the trail is complete in-app and in the platform
 * audit viewer.
 */
import { and, desc, eq } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";
import { writeAuditEvent } from "@zfloat/audit";

export type ReconExceptionStatus = "OPEN" | "INVESTIGATING" | "RESOLVED" | "ESCALATED";
export type ReconExceptionKind = "AMOUNT_MISMATCH" | "UNMATCHED" | "DUPLICATE" | "UNKNOWN" | "ORPHAN";
export type ReconExceptionAction = "resolve" | "reopen" | "comment";

export class ReconExceptionError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ReconExceptionError";
  }
}

/** Workflow actions allowed from each status. */
const ACTION_FROM_STATUS: Record<ReconExceptionAction, ReconExceptionStatus[]> = {
  resolve: ["OPEN", "INVESTIGATING", "ESCALATED"],
  reopen: ["RESOLVED"],
  comment: ["OPEN", "INVESTIGATING", "RESOLVED", "ESCALATED"],
};

export interface ReconActivityRow {
  id: string;
  exceptionId: string;
  tenantId: string;
  actorId: string | null;
  action: ReconExceptionAction;
  note: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: Date;
}

/** The exception + its linked recon item/payment, as the UI needs it. */
export interface ReconExceptionDetail {
  id: string;
  tenantId: string;
  itemId: string | null;
  paymentId: string | null;
  kind: ReconExceptionKind;
  severity: string;
  status: ReconExceptionStatus;
  resolution: string | null;
  resolvedById: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  providerReference: string | null;
  amountMinor: string | null;
  occurredAt: Date | null;
  paymentProviderReference: string | null;
  activity: ReconActivityRow[];
}

function toDetail(row: (typeof schema.reconExceptions.$inferSelect) & { providerReference: string | null; amountMinor: bigint | null; occurredAt: Date | null; paymentProviderReference: string | null }): ReconExceptionDetail {
  return {
    id: row.id,
    tenantId: row.tenantId,
    itemId: row.itemId,
    paymentId: row.paymentId,
    kind: row.kind as ReconExceptionKind,
    severity: row.severity,
    status: row.status as ReconExceptionStatus,
    resolution: row.resolution,
    resolvedById: row.resolvedById,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    providerReference: row.providerReference,
    amountMinor: row.amountMinor !== null ? row.amountMinor.toString() : null,
    occurredAt: row.occurredAt,
    paymentProviderReference: row.paymentProviderReference,
    activity: [],
  };
}

/** Load one exception (with item/payment context) or null. Caller scopes. */
export async function getReconExceptionDetail(db: Db, exceptionId: string): Promise<ReconExceptionDetail | null> {
  const rows = await db
    .select({
      id: schema.reconExceptions.id,
      tenantId: schema.reconExceptions.tenantId,
      itemId: schema.reconExceptions.itemId,
      paymentId: schema.reconExceptions.paymentId,
      kind: schema.reconExceptions.kind,
      severity: schema.reconExceptions.severity,
      status: schema.reconExceptions.status,
      resolution: schema.reconExceptions.resolution,
      resolvedById: schema.reconExceptions.resolvedById,
      resolvedAt: schema.reconExceptions.resolvedAt,
      createdAt: schema.reconExceptions.createdAt,
      updatedAt: schema.reconExceptions.updatedAt,
      providerReference: schema.reconItems.providerReference,
      amountMinor: schema.reconItems.amountMinor,
      occurredAt: schema.reconItems.occurredAt,
      paymentProviderReference: schema.payments.providerReference,
    })
    .from(schema.reconExceptions)
    .leftJoin(schema.reconItems, eq(schema.reconItems.id, schema.reconExceptions.itemId))
    .leftJoin(schema.payments, eq(schema.payments.id, schema.reconExceptions.paymentId))
    .where(eq(schema.reconExceptions.id, exceptionId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const detail = toDetail(row);
  const activity = await db
    .select()
    .from(schema.reconExceptionActivity)
    .where(eq(schema.reconExceptionActivity.exceptionId, exceptionId))
    .orderBy(desc(schema.reconExceptionActivity.createdAt));
  detail.activity = activity.map((a) => ({
    id: a.id,
    exceptionId: a.exceptionId,
    tenantId: a.tenantId,
    actorId: a.actorId,
    action: a.action as ReconExceptionAction,
    note: a.note,
    fromStatus: a.fromStatus,
    toStatus: a.toStatus,
    createdAt: a.createdAt,
  }));
  return detail;
}

/** List exceptions with item context. `tenantId` is required (callers scope). */
export async function listReconExceptions(
  db: Db,
  opts: { tenantId: string; status?: string; kind?: string; limit?: number },
): Promise<ReconExceptionDetail[]> {
  const rows = await db
    .select({
      id: schema.reconExceptions.id,
      tenantId: schema.reconExceptions.tenantId,
      itemId: schema.reconExceptions.itemId,
      paymentId: schema.reconExceptions.paymentId,
      kind: schema.reconExceptions.kind,
      severity: schema.reconExceptions.severity,
      status: schema.reconExceptions.status,
      resolution: schema.reconExceptions.resolution,
      resolvedById: schema.reconExceptions.resolvedById,
      resolvedAt: schema.reconExceptions.resolvedAt,
      createdAt: schema.reconExceptions.createdAt,
      updatedAt: schema.reconExceptions.updatedAt,
      providerReference: schema.reconItems.providerReference,
      amountMinor: schema.reconItems.amountMinor,
      occurredAt: schema.reconItems.occurredAt,
      paymentProviderReference: schema.payments.providerReference,
    })
    .from(schema.reconExceptions)
    .leftJoin(schema.reconItems, eq(schema.reconItems.id, schema.reconExceptions.itemId))
    .leftJoin(schema.payments, eq(schema.payments.id, schema.reconExceptions.paymentId))
    .where(
      and(
        eq(schema.reconExceptions.tenantId, opts.tenantId),
        opts.status ? eq(schema.reconExceptions.status, opts.status) : undefined,
        opts.kind ? eq(schema.reconExceptions.kind, opts.kind) : undefined,
      ),
    )
    .orderBy(desc(schema.reconExceptions.createdAt))
    .limit(opts.limit ?? 200);
  return rows.map(toDetail);
}

/** Scope-check helper shared by the action functions. Throws NOT_FOUND when the
 * exception is missing OR belongs to another tenant (no cross-tenant leakage). */
async function loadScoped(db: Db, exceptionId: string, tenantId?: string) {
  const [row] = await db
    .select()
    .from(schema.reconExceptions)
    .where(eq(schema.reconExceptions.id, exceptionId))
    .limit(1);
  if (!row || (tenantId && row.tenantId !== tenantId)) {
    throw new ReconExceptionError("Recon exception not found", "NOT_FOUND");
  }
  return row;
}

async function recordActivity(
  db: Db,
  input: {
    exceptionId: string;
    tenantId: string;
    actorId: string | null;
    action: ReconExceptionAction;
    note: string | null;
    fromStatus: string | null;
    toStatus: string | null;
  },
): Promise<void> {
  await db.insert(schema.reconExceptionActivity).values({
    exceptionId: input.exceptionId,
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: input.action,
    note: input.note,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
  });
}

/** Resolve an open exception with a required resolution note. */
export async function resolveReconException(
  db: Db,
  input: { exceptionId: string; tenantId?: string; actorId?: string; note: string },
): Promise<ReconExceptionDetail> {
  const exception = await loadScoped(db, input.exceptionId, input.tenantId);
  const allowed = ACTION_FROM_STATUS.resolve;
  if (!allowed.includes(exception.status as ReconExceptionStatus)) {
    throw new ReconExceptionError(
      `Only ${allowed.join("/")} exceptions can be resolved (current: ${exception.status})`,
      "INVALID_STATUS",
    );
  }
  const note = String(input.note ?? "").trim();
  if (!note) throw new ReconExceptionError("A resolution note is required", "NOTE_REQUIRED");
  if (note.length > 4000) throw new ReconExceptionError("Resolution note is too long (max 4000 characters)", "NOTE_TOO_LONG");

  await db
    .update(schema.reconExceptions)
    .set({ status: "RESOLVED", resolution: note, resolvedById: input.actorId ?? null, resolvedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.reconExceptions.id, exception.id));
  await recordActivity(db, {
    exceptionId: exception.id,
    tenantId: exception.tenantId,
    actorId: input.actorId ?? null,
    action: "resolve",
    note,
    fromStatus: exception.status,
    toStatus: "RESOLVED",
  });
  await writeAuditEvent(db, {
    tenantId: exception.tenantId,
    actorId: input.actorId,
    actorRole: "tenant_user",
    action: "reconciliation.exception.resolved",
    resourceType: "recon_exception",
    resourceId: exception.id,
    before: { status: exception.status, kind: exception.kind },
    after: { status: "RESOLVED", note },
  });
  return (await getReconExceptionDetail(db, exception.id))!;
}

/** Reopen a resolved exception (e.g. the fix did not hold). */
export async function reopenReconException(
  db: Db,
  input: { exceptionId: string; tenantId?: string; actorId?: string; note?: string },
): Promise<ReconExceptionDetail> {
  const exception = await loadScoped(db, input.exceptionId, input.tenantId);
  if (exception.status !== "RESOLVED") {
    throw new ReconExceptionError("Only RESOLVED exceptions can be reopened", "INVALID_STATUS");
  }
  const note = String(input.note ?? "").trim() || "Reopened for further investigation";
  if (note.length > 4000) throw new ReconExceptionError("Reopen note is too long (max 4000 characters)", "NOTE_TOO_LONG");

  await db
    .update(schema.reconExceptions)
    .set({ status: "OPEN", resolution: null, resolvedById: null, resolvedAt: null, updatedAt: new Date() })
    .where(eq(schema.reconExceptions.id, exception.id));
  await recordActivity(db, {
    exceptionId: exception.id,
    tenantId: exception.tenantId,
    actorId: input.actorId ?? null,
    action: "reopen",
    note,
    fromStatus: "RESOLVED",
    toStatus: "OPEN",
  });
  await writeAuditEvent(db, {
    tenantId: exception.tenantId,
    actorId: input.actorId,
    actorRole: "tenant_user",
    action: "reconciliation.exception.reopened",
    resourceType: "recon_exception",
    resourceId: exception.id,
    before: { status: "RESOLVED", resolution: exception.resolution },
    after: { status: "OPEN", note },
  });
  return (await getReconExceptionDetail(db, exception.id))!;
}

/** Add a comment to an exception in any status. */
export async function commentOnReconException(
  db: Db,
  input: { exceptionId: string; tenantId?: string; actorId?: string; note: string },
): Promise<ReconExceptionDetail> {
  const exception = await loadScoped(db, input.exceptionId, input.tenantId);
  const note = String(input.note ?? "").trim();
  if (!note) throw new ReconExceptionError("A comment is required", "NOTE_REQUIRED");
  if (note.length > 4000) throw new ReconExceptionError("Comment is too long (max 4000 characters)", "NOTE_TOO_LONG");

  await recordActivity(db, {
    exceptionId: exception.id,
    tenantId: exception.tenantId,
    actorId: input.actorId ?? null,
    action: "comment",
    note,
    fromStatus: null,
    toStatus: null,
  });
  await writeAuditEvent(db, {
    tenantId: exception.tenantId,
    actorId: input.actorId,
    actorRole: "tenant_user",
    action: "reconciliation.exception.commented",
    resourceType: "recon_exception",
    resourceId: exception.id,
    before: { status: exception.status },
    after: { status: exception.status, note },
  });
  return (await getReconExceptionDetail(db, exception.id))!;
}
