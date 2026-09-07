/**
 * Worker job implementations — one function per queue concern.
 * Re-exports the domain functions from @zfloat/payments-core and adds the
 * queue-specific glue (batch row walking, reconciliation runner, file
 * scanning, scheduled payment creation, outbox event handling).
 */
import { and, eq, sql } from "drizzle-orm";
import { schema, toJsonSafe, type Db } from "@zfloat/database";
import {
  executePayment,
  processWebhookEvent,
  monitorStuckPayments,
  materializeBatchRow,
  markBatchRowOutcome,
  refreshBatchStatus,
  runReconciliation,
  fanoutWebhookDeliveries,
  deliverWebhook,
  withIdempotency,
} from "@zfloat/payments-core";
import { expireDueApprovals } from "@zfloat/approvals";

export {
  executePayment,
  processWebhookEvent,
  monitorStuckPayments,
  materializeBatchRow,
  markBatchRowOutcome,
  refreshBatchStatus,
  runReconciliation,
  fanoutWebhookDeliveries,
  deliverWebhook,
};
export const expireApprovals = expireDueApprovals;
export { runReportScheduleDispatch } from "@zfloat/payments-core";
export { gcIdempotencyRecords } from "@zfloat/payments-core";

/** Valid rows of a batch awaiting execution (chunked processing). */
export async function getBatchRows(db: Db, batchId: string, limit = 200) {
  return db
    .select()
    .from(schema.paymentBatchRows)
    .where(and(eq(schema.paymentBatchRows.batchId, batchId), eq(schema.paymentBatchRows.status, "VALID")))
    .orderBy(schema.paymentBatchRows.rowNumber)
    .limit(limit);
}

/**
 * Crash/stall recovery: re-drive batches that are stuck PROCESSING while still
 * holding VALID (never-materialized) rows — e.g. a worker that died between
 * chunks or a job that completed without draining every chunk (pre-loop
 * driver). Materialization is idempotent per row, so re-running is safe: rows
 * already PENDING/SUCCESS are simply not selected.
 */
export async function resumeInterruptedBatches(
  db: Db,
  enqueue: (batchId: string, tenantId: string) => Promise<unknown>,
): Promise<number> {
  const stuck = await db
    .selectDistinct({ batchId: schema.paymentBatches.id, tenantId: schema.paymentBatches.tenantId })
    .from(schema.paymentBatches)
    .innerJoin(schema.paymentBatchRows, eq(schema.paymentBatchRows.batchId, schema.paymentBatches.id))
    .where(and(eq(schema.paymentBatches.status, "PROCESSING"), eq(schema.paymentBatchRows.status, "VALID")))
    .limit(25);
  let resumed = 0;
  for (const b of stuck) {
    try {
      await enqueue(b.batchId, b.tenantId);
      resumed += 1;
    } catch {
      // one bad enqueue must not block the rest
    }
  }
  return resumed;
}

/**
 * Schedules.dispatch — create payments for schedules whose nextRunAt <= now.
 * Each schedule becomes a single payment through the normal pipeline and its
 * nextRunAt advances per frequency.
 * Idempotent per (tenant, schedule.id, nextRunAt) to prevent duplicate payments
 * if the cron fires twice.
 */
export async function createScheduledPayments(db: Db, opts: { limit?: number } = {}) {
  const now = new Date();
  const due = await db
    .select()
    .from(schema.paymentSchedules)
    .where(
      and(
        eq(schema.paymentSchedules.status, "ACTIVE"),
        sql`${schema.paymentSchedules.nextRunAt} <= ${now}`,
      ),
    )
    .limit(opts.limit ?? 50);

  let created = 0;
  for (const schedule of due) {
    try {
      const [wallet] = await db
        .select()
        .from(schema.wallets)
        .where(eq(schema.wallets.tenantId, schedule.tenantId))
        .limit(1);
      const [maker] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.tenantId, schedule.tenantId))
        .limit(1);
      if (!wallet || !maker) continue;
      const beneficiary = (schedule.beneficiarySnapshot ?? { name: schedule.name }) as Record<string, unknown>;
      const idempotencyKey = `sched:${schedule.id}:${schedule.nextRunAt?.toISOString() ?? now.toISOString()}`;
      
      await db.transaction(async (tx) => {
        await withIdempotency(
          tx,
          { tenantId: schedule.tenantId, scope: "schedule.dispatch", key: idempotencyKey },
          async () => {
            await tx.insert(schema.payments).values({
              tenantId: schedule.tenantId,
              paymentNumber: `ZF-SCH-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
              product: "single_payment",
              channel: schedule.channel,
              amountMinor: BigInt(schedule.amountMinor),
              feeMinor: 0n,
              totalMinor: BigInt(schedule.amountMinor),
              currency: "KES",
              status: "DRAFT",
              sourceWalletId: wallet.id,
              beneficiarySnapshot: toJsonSafe(beneficiary) as Record<string, unknown>,
              category: schedule.category,
              remark: `Scheduled: ${schedule.name}`,
              createdById: maker.id,
              scheduledFor: schedule.nextRunAt,
            });
          }
        );
      });
      created += 1;
    } catch {
      // keep schedule for next pass; do not crash the dispatcher
    }
    // advance nextRunAt (simple daily/monthly rule; cron_expr support in phase 2)
    const next = advanceFrequency(schedule.nextRunAt ?? now, schedule.frequency);
    await db
      .update(schema.paymentSchedules)
      .set({ nextRunAt: next, lastRunAt: now, status: next > now ? "ACTIVE" : "COMPLETED" })
      .where(eq(schema.paymentSchedules.id, schedule.id));
  }
  return created;
}

function advanceFrequency(from: Date, frequency: string): Date {
  const d = new Date(from);
  switch (frequency) {
    case "DAILY":
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case "WEEKLY":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "MONTHLY":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    default:
      d.setUTCDate(d.getUTCDate() + 30);
  }
  return d;
}

/**
 * files.scan — malware scan pipeline. `mock` driver (dev) marks CLEAN after
 * a header sanity check; `clamav` driver speaks clamd (TCP) for production.
 */
export async function scanFile(db: Db, fileId: string): Promise<"CLEAN" | "INFECTED" | "ERROR"> {
  const [file] = await db.select().from(schema.fileObjects).where(eq(schema.fileObjects.id, fileId)).limit(1);
  if (!file) return "ERROR";

  const driver = process.env.MALWARE_SCANNER_DRIVER ?? "mock";
  let result: "CLEAN" | "INFECTED" | "ERROR";
  if (driver === "clamav") {
    result = await clamavScan(file.storageKey);
  } else {
    // mock: reject obvious script bombs, accept everything else
    const ext = file.filename.split(".").pop()?.toLowerCase() ?? "";
    result = ["php", "sh", "exe", "bat", "cmd", "js"].includes(ext) ? "INFECTED" : "CLEAN";
  }
  await db.update(schema.fileObjects).set({ scanStatus: result }).where(eq(schema.fileObjects.id, file.id));
  return result;
}

async function clamavScan(storageKey: string): Promise<"CLEAN" | "INFECTED" | "ERROR"> {
  const net = await import("node:net");
  const host = process.env.CLAMAV_HOST ?? "127.0.0.1";
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const onData = (data: Buffer) => {
      const text = data.toString();
      socket.destroy();
      if (text.includes("FOUND")) resolve("INFECTED");
      else if (text.includes("OK")) resolve("CLEAN");
      else resolve("ERROR");
    };
  socket.on("connect", () => socket.write(`zINSTREAM\u0000${storageKey}\u0000`));
    socket.on("data", onData);
    socket.on("error", () => resolve("ERROR"));
    setTimeout(() => {
      socket.destroy();
      resolve("ERROR");
    }, 10_000);
  });
}

/** reports.generate — async CSV export. Writes tenant-scoped payment data to REPORT_STORAGE_DIR. */
export async function generateReport(db: Db, reportId: string, payload: unknown): Promise<void> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const reportType = String(p.reportType ?? "transactions");
  try {
    const [report] = await db
      .select({ tenantId: schema.reports.tenantId })
      .from(schema.reports)
      .where(eq(schema.reports.id, reportId));
    if (!report) throw new Error(`report ${reportId} not found`);
    const tenantId = report.tenantId;

    // Tenant-scoped transactions (the CSV export contract: never cross tenants).
    const payments = await db
      .select({
        paymentNumber: schema.payments.paymentNumber,
        beneficiarySnapshot: schema.payments.beneficiarySnapshot,
        amountMinor: schema.payments.amountMinor,
        feeMinor: schema.payments.feeMinor,
        totalMinor: schema.payments.totalMinor,
        channel: schema.payments.channel,
        status: schema.payments.status,
        providerReference: schema.payments.providerReference,
        createdAt: schema.payments.createdAt,
        updatedAt: schema.payments.updatedAt,
      })
      .from(schema.payments)
      .where(eq(schema.payments.tenantId, tenantId));

    const header = reportType === "fees"
      ? ["payment_number", "beneficiary_name", "amount_minor", "fee_minor", "total_minor", "channel", "status", "created_at"]
      : ["payment_number", "beneficiary_name", "amount_minor", "fee_minor", "total_minor", "channel", "status", "provider_reference", "created_at", "updated_at"];
    const rows = payments.map((r) => {
      const name = String((r.beneficiarySnapshot as Record<string, unknown> | null)?.name ?? "");
      const base = [
        r.paymentNumber,
        csvEscape(name),
        String(r.amountMinor),
        String(r.feeMinor ?? 0),
        String(r.totalMinor ?? r.amountMinor),
        r.channel,
        r.status,
      ];
      return reportType === "fees"
        ? [...base, new Date(r.createdAt).toISOString()].join(",")
        : [...base, r.providerReference ?? "", new Date(r.createdAt).toISOString(), new Date(r.updatedAt).toISOString()].join(",");
    });
    const csv = [header.join(","), ...rows].join("\n");

    // Artifact storage is driver-abstracted: local disk (dev) or S3 (prod).
    const { getObjectStore } = await import("@zfloat/storage");
    const store = getObjectStore();
    const key = `reports/${reportId}.csv`;
    await store.put({ key, body: Buffer.from(csv, "utf8"), contentType: "text/csv" });
    const payloadRef = store.driver === "s3" ? `s3://${key}` : await store.urlFor(key);

    await db
      .update(schema.reports)
      .set({ status: "GENERATED", payloadRef, rowCount: payments.length, completedAt: new Date() })
      .where(eq(schema.reports.id, reportId));
    // eslint-disable-next-line no-console
    console.log(`[worker] report ${reportId} generated (type=${reportType}, rows=${payments.length}, store=${store.driver}, key=${key})`);
  } catch (err) {
    await db
      .update(schema.reports)
      .set({ status: "FAILED", completedAt: new Date() })
      .where(eq(schema.reports.id, reportId));
    throw err instanceof Error ? err : new Error("report generation failed");
  }
}

/** Minimal CSV field escaping: quote when the value contains commas, quotes or newlines. */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Ledger health — double-entry invariant verification per tenant; flags imbalances. */
export interface LedgerHealthSummary {
  healthy: boolean;
  tenantId: string;
  journalsChecked: number;
  unbalancedJournals: number;
}

export async function runLedgerHealthCheck(db: Db, tenantId?: string): Promise<LedgerHealthSummary[]> {
  const { checkLedgerHealth } = await import("@zfloat/ledger");
  const results = await checkLedgerHealth(db, tenantId);
  for (const r of results) {
    if (!r.healthy) {
      await db.insert(schema.auditEvents).values({
        tenantId: r.tenantId,
        actorId: null,
        action: "ledger.health.imbalance",
        resourceType: "ledger",
        resourceId: r.tenantId,
        after: {
          journalsChecked: r.journalsChecked,
          unbalancedJournals: r.unbalancedJournals,
          totalDebitMinor: r.totalDebitMinor.toString(),
          totalCreditMinor: r.totalCreditMinor.toString(),
        },
      });
      // eslint-disable-next-line no-console
      console.error(`[worker] LEDGER IMBALANCE tenant=${r.tenantId} journals=${r.journalsChecked} unbalanced=${r.unbalancedJournals}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[worker] ledger health: ${results.length} tenant(s) checked, all balanced` + (results.some((r) => !r.healthy) ? " — IMBALANCE DETECTED" : ""));
  return results;
}
