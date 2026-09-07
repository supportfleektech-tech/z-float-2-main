/**
 * Phase 3 (GAP-ANALYSIS) — reconciliation exception resolution workflow on
 * real PostgreSQL: exceptions raised by the statement reconciliation engine
 * (AMOUNT_MISMATCH / UNMATCHED) can be resolved with a mandatory resolution
 * note, commented on without state change, and reopened; every action lands in
 * recon_exception_activity (append-only history) AND the platform audit log;
 * state guards (wrong status / empty note / cross-tenant / unknown id) hold.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { and, count, eq, sql } from "drizzle-orm";
import { createDb, schema } from "@zfloat/database";
import { reconcileStatement } from "../src/reconciliation.js";
import {
  resolveReconException,
  reopenReconException,
  commentOnReconException,
  getReconExceptionDetail,
  listReconExceptions,
} from "../src/recon-exceptions.js";

let db: ReturnType<typeof createDb>["db"];
let pool: ReturnType<typeof createDb>["pool"];

const TENANT = crypto.randomUUID();
const OTHER_TENANT = crypto.randomUUID();
const USER = crypto.randomUUID();
const OTHER_USER = crypto.randomUUID();

async function makePayment(providerReference: string, amountMinor: bigint, tenantId = TENANT) {
  const [p] = await db
    .insert(schema.payments)
    .values({
      tenantId,
      paymentNumber: `ZF-RECON-${providerReference}`,
      providerReference,
      channel: "mpesa",
      amountMinor,
      totalMinor: amountMinor,
      beneficiarySnapshot: { name: "Recon Test Payee" },
    })
    .returning();
  return p!;
}

/** Import a statement with rows: partial (payment exists, amount differs)
 * produces AMOUNT_MISMATCH; unknown ref produces UNMATCHED. */
async function raiseExceptions() {
  const payment = await makePayment("TXN-1001", 500_000n);
  const result = await reconcileStatement(db, {
    tenantId: TENANT,
    periodStart: new Date("2026-08-01T00:00:00Z"),
    periodEnd: new Date("2026-08-31T23:59:59Z"),
    actorId: USER,
    rows: [
      { providerReference: "TXN-1001", amountMinor: 490_000n, occurredAt: new Date("2026-08-10T10:00:00Z") },
      { providerReference: "TXN-9999", amountMinor: 12_500n, occurredAt: new Date("2026-08-11T11:00:00Z") },
    ],
  });
  return { payment, result };
}

async function findException(kind: "AMOUNT_MISMATCH" | "UNMATCHED") {
  const [row] = await db
    .select({ id: schema.reconExceptions.id })
    .from(schema.reconExceptions)
    .where(and(eq(schema.reconExceptions.tenantId, TENANT), eq(schema.reconExceptions.kind, kind)))
    .limit(1);
  return row!;
}

async function auditCount(action: string) {
  const [row] = await db
    .select({ n: count() })
    .from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.tenantId, TENANT), eq(schema.auditEvents.action, action)));
  return Number(row!.n);
}

beforeAll(async () => {
  ({ db, pool } = createDb());
  await db.insert(schema.tenants).values({ id: TENANT, name: "Recon Workflow Co", slug: `recon-wf-${Date.now()}`, status: "ACTIVE" });
  await db.insert(schema.tenants).values({ id: OTHER_TENANT, name: "Other Recon Co", slug: `recon-other-${Date.now()}`, status: "ACTIVE" });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE recon_exception_activity, recon_exceptions, recon_matches, recon_items, recon_runs, audit_events, payments, webhook_deliveries CASCADE`,
  );
});

describe("reconciliation exception resolution workflow", () => {
  it("resolves an AMOUNT_MISMATCH exception with a required note, stamping actor/time", async () => {
    await raiseExceptions();
    const exc = await findException("AMOUNT_MISMATCH");
    const detail = await resolveReconException(db, { exceptionId: exc.id, tenantId: TENANT, actorId: USER, note: "Provider statement shows the post-fee net amount; internal total is correct. Confirmed with bank statement." });

    expect(detail.status).toBe("RESOLVED");
    expect(detail.resolution).toContain("post-fee net amount");
    expect(detail.resolvedById).toBe(USER);
    expect(detail.resolvedAt).toBeInstanceOf(Date);

    // exception row is stamped
    const [row] = await db.select().from(schema.reconExceptions).where(eq(schema.reconExceptions.id, exc.id));
    expect(row!.status).toBe("RESOLVED");
    expect(row!.resolution).toContain("post-fee net amount");
    expect(row!.resolvedById).toBe(USER);
    expect(row!.resolvedAt).not.toBeNull();

    // one activity row: resolve OPEN -> RESOLVED
    const activity = await db
      .select()
      .from(schema.reconExceptionActivity)
      .where(eq(schema.reconExceptionActivity.exceptionId, exc.id));
    expect(activity).toHaveLength(1);
    expect(activity[0]!.action).toBe("resolve");
    expect(activity[0]!.fromStatus).toBe("OPEN");
    expect(activity[0]!.toStatus).toBe("RESOLVED");
    expect(activity[0]!.actorId).toBe(USER);
    expect(activity[0]!.note).toContain("post-fee net amount");

    // audit trail
    expect(await auditCount("reconciliation.exception.resolved")).toBe(1);
  });

  it("keeps UNMATCHED exceptions open on comment and records the note", async () => {
    await raiseExceptions();
    const exc = await findException("UNMATCHED");
    const detail = await commentOnReconException(db, { exceptionId: exc.id, tenantId: TENANT, actorId: USER, note: "Chasing the bank for the original reference mapping." });

    expect(detail.status).toBe("OPEN");
    expect(detail.resolution).toBeNull();
    const activity = await db
      .select()
      .from(schema.reconExceptionActivity)
      .where(eq(schema.reconExceptionActivity.exceptionId, exc.id));
    expect(activity).toHaveLength(1);
    expect(activity[0]!.action).toBe("comment");
    expect(activity[0]!.fromStatus).toBeNull();
    expect(activity[0]!.note).toBe("Chasing the bank for the original reference mapping.");
    expect(await auditCount("reconciliation.exception.commented")).toBe(1);
  });

  it("reopens a resolved exception and keeps the full history", async () => {
    await raiseExceptions();
    const exc = await findException("AMOUNT_MISMATCH");
    await commentOnReconException(db, { exceptionId: exc.id, tenantId: TENANT, actorId: USER, note: "Verifying with bank." });
    await resolveReconException(db, { exceptionId: exc.id, tenantId: TENANT, actorId: USER, note: "Bank confirmed net-amount treatment." });
    const reopened = await reopenReconException(db, { exceptionId: exc.id, tenantId: TENANT, actorId: OTHER_USER, note: "Same mismatch reappeared on the August closing statement." });

    expect(reopened.status).toBe("OPEN");
    expect(reopened.resolution).toBeNull();
    expect(reopened.resolvedById).toBeNull();
    expect(reopened.resolvedAt).toBeNull();

    // history is append-only and complete: comment, resolve, reopen (newest first)
    const activity = reopened.activity;
    expect(activity).toHaveLength(3);
    expect(activity[0]!.action).toBe("reopen");
    expect(activity[0]!.fromStatus).toBe("RESOLVED");
    expect(activity[0]!.toStatus).toBe("OPEN");
    expect(activity[0]!.actorId).toBe(OTHER_USER);
    expect(activity[1]!.action).toBe("resolve");
    expect(activity[2]!.action).toBe("comment");

    // the original resolution note is preserved in history even though cleared from the row
    expect(activity[1]!.note).toContain("Bank confirmed");
    expect(await auditCount("reconciliation.exception.reopened")).toBe(1);
    expect(await auditCount("reconciliation.exception.resolved")).toBe(1);
  });

  it("details surface linked item + payment context and history for the UI", async () => {
    const { payment } = await raiseExceptions();
    const exc = await findException("AMOUNT_MISMATCH");
    await resolveReconException(db, { exceptionId: exc.id, tenantId: TENANT, actorId: USER, note: "Fixed." });

    const detail = await getReconExceptionDetail(db, exc.id);
    expect(detail).not.toBeNull();
    expect(detail!.kind).toBe("AMOUNT_MISMATCH");
    expect(detail!.severity).toBe("HIGH");
    expect(detail!.status).toBe("RESOLVED");
    expect(detail!.paymentId).toBe(payment.id);
    expect(detail!.providerReference).toBe("TXN-1001");
    expect(detail!.amountMinor).toBe("490000"); // statement amount differs from payment 500000
    expect(detail!.paymentProviderReference).toBe("TXN-1001");
    expect(detail!.activity).toHaveLength(1);

    // listing supports status filters and joins item context
    const open = await listReconExceptions(db, { tenantId: TENANT, status: "OPEN" });
    expect(open).toHaveLength(1); // only the UNMATCHED one
    expect(open[0]!.kind).toBe("UNMATCHED");
    expect(open[0]!.providerReference).toBe("TXN-9999");
    expect(open[0]!.severity).toBe("MEDIUM");
    const mismatch = await listReconExceptions(db, { tenantId: TENANT, kind: "AMOUNT_MISMATCH" });
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]!.status).toBe("RESOLVED");
  });

  it("guards: resolution note is required", async () => {
    await raiseExceptions();
    const exc = await findException("UNMATCHED");
    await expect(
      resolveReconException(db, { exceptionId: exc.id, tenantId: TENANT, actorId: USER, note: "   " }),
    ).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
    const [row] = await db.select().from(schema.reconExceptions).where(eq(schema.reconExceptions.id, exc.id));
    expect(row!.status).toBe("OPEN");
  });

  it("guards: only open/active exceptions can be resolved; only resolved can be reopened", async () => {
    await raiseExceptions();
    const exc = await findException("UNMATCHED");
    await resolveReconException(db, { exceptionId: exc.id, tenantId: TENANT, actorId: USER, note: "Resolved." });

    // resolving again is refused
    await expect(
      resolveReconException(db, { exceptionId: exc.id, tenantId: TENANT, actorId: USER, note: "Again?" }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });

    // reopening the OTHER (still open) exception is refused
    const openExc = await findException("AMOUNT_MISMATCH");
    await expect(
      reopenReconException(db, { exceptionId: openExc.id, tenantId: TENANT, actorId: USER }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });

    // comment works in any status
    const commented = await commentOnReconException(db, { exceptionId: exc.id, tenantId: TENANT, actorId: USER, note: "Auditor asked for proof." });
    expect(commented.status).toBe("RESOLVED");
    const reopened = await reopenReconException(db, { exceptionId: exc.id, tenantId: TENANT, actorId: USER });
    expect(reopened.status).toBe("OPEN");
  });

  it("guards: empty comments are refused", async () => {
    await raiseExceptions();
    const exc = await findException("UNMATCHED");
    await expect(
      commentOnReconException(db, { exceptionId: exc.id, tenantId: TENANT, actorId: USER, note: "" }),
    ).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
  });

  it("guards: unknown ids and cross-tenant access are refused", async () => {
    await raiseExceptions();
    const exc = await findException("AMOUNT_MISMATCH");
    await expect(
      resolveReconException(db, { exceptionId: crypto.randomUUID(), tenantId: TENANT, actorId: USER, note: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // exception belongs to TENANT; caller scopes to OTHER_TENANT -> treated as not found
    await expect(
      resolveReconException(db, { exceptionId: exc.id, tenantId: OTHER_TENANT, actorId: OTHER_USER, note: "sneaky" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const [row] = await db.select().from(schema.reconExceptions).where(eq(schema.reconExceptions.id, exc.id));
    expect(row!.status).toBe("OPEN");
  });

  it("escaped-state exceptions resolve too, and every action is idempotent-safe on the audit side", async () => {
    // Insert an ESCALATED exception directly (raised via future triage flow)
    const [exc] = await db
      .insert(schema.reconExceptions)
      .values({ tenantId: TENANT, kind: "ORPHAN", severity: "HIGH", status: "ESCALATED" })
      .returning();
    const detail = await resolveReconException(db, { exceptionId: exc!.id, tenantId: TENANT, actorId: USER, note: "Escalation cleared: orphan matched to reversal." });
    expect(detail.status).toBe("RESOLVED");
    expect(detail.resolvedById).toBe(USER);
    expect(await auditCount("reconciliation.exception.resolved")).toBe(1);
    // reopen path from a manually resolved row
    const reopened = await reopenReconException(db, { exceptionId: exc!.id, tenantId: TENANT, actorId: OTHER_USER, note: "" });
    expect(reopened.status).toBe("OPEN");
    const activity = await db
      .select({ action: schema.reconExceptionActivity.action })
      .from(schema.reconExceptionActivity)
      .where(eq(schema.reconExceptionActivity.exceptionId, exc!.id))
      .orderBy(sql`created_at`);
    expect(activity.map((a) => a.action)).toEqual(["resolve", "reopen"]);
  });
});
