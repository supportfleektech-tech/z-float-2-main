/**
 * Z-float worker — processes all background queues:
 *  payments.execution | batches.execution | webhooks.process | schedules.dispatch
 *  reconciliation.run | notifications.send | files.scan | reports.generate
 *  payments.monitor | outbox relay (embedded poller; standalone: services/outbox-relay)
 *
 * Also runs the periodic housekeeping (approval expiry, schedule dispatch,
 * provider monitor) on cron timers when WORKER_CRON_ENABLED=true.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "@zfloat/config";
import { getDb, type Db } from "@zfloat/database";
import { enqueue, startWorker, getRedis, type JobPayload, type WorkerHandle } from "@zfloat/queue";
import { createProviderRegistry } from "@zfloat/providers";
import { dispatchNotification } from "@zfloat/notifications";
import {
  executePayment,
  processWebhookEvent,
  monitorStuckPayments,
  materializeBatchRow,
  markBatchRowOutcome,
  refreshBatchStatus,
  getBatchRows,
  createScheduledPayments,
  expireApprovals,
  runReconciliation,
  scanFile,
  generateReport,
  runLedgerHealthCheck,
  deliverWebhook,
  gcIdempotencyRecords,
  runReportScheduleDispatch,
  resumeInterruptedBatches,
} from "./jobs.js";
import { runOutboxPoller, handleOutboxEvent } from "@zfloat/payments-core";
import { applySecretsToEnv } from "@zfloat/secrets";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../../../.env"), quiet: true });

// Secrets vault: apply KMS/local envelope secrets to process.env BEFORE any
// config parsing or adapter construction reads env vars. Explicit env values
// always win, so local development is unaffected. Fail closed on vault errors.
try {
  await applySecretsToEnv();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("[worker] secrets vault failure — refusing to start:", err);
  process.exit(1);
}

const registry = createProviderRegistry();

function providerFor(payload: JobPayload) {
  const code = (payload.providerCode as string) ?? "local-sandbox";
  return registry.get(code);
}

async function main() {
  const config = getConfig();
  const { db } = getDb();
  const handles: WorkerHandle[] = [];

  // Global error handlers
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[worker] Unhandled Rejection at:', promise, 'reason:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[worker] Uncaught Exception:', err);
  });

  // ---- payments.execution: dispatch a single payment to its provider ----
  console.log('[worker] Starting payments.execution worker...');
  handles.push(
    startWorker("payments.execution", async (payload) => {
      await executePayment(db, {
        tenantId: payload.tenantId as string,
        paymentId: payload.paymentId as string,
        provider: providerFor(payload),
        attemptNumber: (payload.attemptNumber as number) ?? 1,
      });
    }),
  );
  console.log('[worker] payments.execution worker started');

  // ---- batches.execution: materialize + execute batch rows in chunks ----
  // Chunk driver: getBatchRows returns at most CHUNK (200) VALID rows, so a
  // batch larger than one chunk MUST loop here — a single pass left the rest
  // of the rows VALID forever and the batch stuck PROCESSING (bug found by the
  // Phase-9-closeout batch soak). Materialization is idempotent per row
  // (deterministic payment idempotency key `batch:<id>:row:<n>`), so a stall
  // recovery re-run simply skips rows already PENDING/SUCCESS.
  console.log('[worker] Starting batches.execution worker...');
  handles.push(
    startWorker("batches.execution", async (payload) => {
      const batchId = payload.batchId as string;
      const tenantId = payload.tenantId as string;
      let chunk = 0;
      while (chunk < 500) {
        const rows = await getBatchRows(db, batchId);
        if (rows.length === 0) break;
        for (const row of rows) {
          try {
            const { paymentId } = await materializeBatchRow(db, { tenantId, batchId, rowId: row.id, actorId: payload.actorId as string });
            await enqueue("payments.execution", {
              correlationId: payload.correlationId,
              tenantId,
              paymentId,
              providerCode: payload.providerCode,
              attemptNumber: 1,
              idempotencyKey: `row:${row.id}`,
            }, { jobId: `pay-${paymentId}` });
          } catch (err) {
            await markBatchRowOutcome(db, { rowId: row.id, status: "FAILED", errorMessage: err instanceof Error ? err.message : "failed" });
          }
        }
        await refreshBatchStatus(db, batchId);
        chunk += 1;
        if (rows.length < 200) break; // final chunk
        await new Promise((r) => setTimeout(r, 50)); // yield between chunks
      }
    }),
  );
  console.log('[worker] batches.execution worker started');

  // ---- webhooks.process: verified provider callbacks ----
  console.log('[worker] Starting webhooks.process worker...');
  handles.push(
    startWorker("webhooks.process", async (payload) => {
      await processWebhookEvent(db, payload.eventId as string);
    }),
  );
  console.log('[worker] webhooks.process worker started');

  // ---- notifications.send ----
  console.log('[worker] Starting notifications.send worker...');
  handles.push(
    startWorker("notifications.send", async (payload) => {
      await dispatchNotification(db, payload.notificationId as string);
    }),
  );
  console.log('[worker] notifications.send worker started');

  // ---- payments.monitor: unknown-state recovery ----
  console.log('[worker] Starting payments.monitor worker...');
  handles.push(
    startWorker("payments.monitor", async (payload) => {
      await monitorStuckPayments(db, registry.default(), { olderThanMs: payload.olderThanMs as number | undefined });
    }),
  );
  console.log('[worker] payments.monitor worker started');

  // ---- schedules.dispatch: create payments for due schedules ----
  console.log('[worker] Starting schedules.dispatch worker...');
  handles.push(
    startWorker("schedules.dispatch", async (payload) => {
      const created = await createScheduledPayments(db, { limit: 50 });
      if (payload.enqueueNext && created > 0) {
        await enqueue("schedules.dispatch", { correlationId: payload.correlationId, enqueueNext: true }, { delayMs: 30_000 });
      }
    }),
  );
  console.log('[worker] schedules.dispatch worker started');

  // ---- reconciliation.run: match provider items against payments ----
  console.log('[worker] Starting reconciliation.run worker...');
  handles.push(
    startWorker("reconciliation.run", async (payload) => {
      await runReconciliation(db, { runId: payload.runId as string | undefined });
    }),
  );
  console.log('[worker] reconciliation.run worker started');

  // ---- files.scan: malware scanning pipeline (mock/clamav) ----
  console.log('[worker] Starting files.scan worker...');
  handles.push(
    startWorker("files.scan", async (payload) => {
      await scanFile(db, payload.fileId as string);
    }),
  );
  console.log('[worker] files.scan worker started');

  // ---- webhooks.deliver: outbound tenant webhook delivery with retries ----
  console.log('[worker] Starting webhooks.deliver worker...');
  handles.push(
    startWorker("webhooks.deliver", async (payload) => {
      await deliverWebhook(db, payload.deliveryId as string, Number(payload.attempt ?? 1));
    }),
  );
  console.log('[worker] webhooks.deliver worker started');

  // ---- reports.generate: async exports (structure; workers add exporters) ----
  console.log('[worker] Starting reports.generate worker...');
  handles.push(
    startWorker("reports.generate", async (payload) => {
      await generateReport(db, payload.reportId as string, payload);
    }),
  );
  console.log('[worker] reports.generate worker started');

  // Startup stall recovery (see hourly sweep below): re-drive PROCESSING
  // batches that still have VALID rows (interrupted runs from a previous
  // worker lifetime).
  try {
    await resumeInterruptedBatches(db, (batchId, tenantId) =>
      enqueue("batches.execution", { correlationId: `resume:${batchId}`, tenantId, batchId, actorId: undefined, providerCode: "local-sandbox" },
        { jobId: `batch-${batchId}-r${Math.floor(Date.now() / 60_000)}` }),
    );
  } catch {
    // non-fatal at startup
  }

  // ---- outbox relay (shared poller; also deployable standalone via services/outbox-relay) ----
  const outbox = runOutboxPoller(db, {
    handle: (event) => handleOutboxEvent(db, event),
    log: (line) => console.log(line),
  });

  // ---- cron-style housekeeping ----
  if (config.WORKER_CRON_ENABLED) {
    const hourly = setInterval(async () => {
      try {
        await expireApprovals(db);
      } catch {
        // next run
      }
      try {
        // Crash/stall recovery: batches stuck PROCESSING with VALID rows left
        // (worker died mid-run, job lost, older buggy builds) get re-driven.
        const resumed = await resumeInterruptedBatches(db, (batchId, tenantId) =>
          enqueue("batches.execution", { correlationId: `resume:${batchId}`, tenantId, batchId, actorId: undefined, providerCode: "local-sandbox" },
            { jobId: `batch-${batchId}-r${Math.floor(Date.now() / 60_000)}` }),
        );
        if (resumed > 0) {
          // eslint-disable-next-line no-console
          console.log(`[worker] resumed ${resumed} interrupted batch(es)`);
        }
      } catch {
        // next run
      }
      try {
        // Idempotency-key retention: free stuck IN_PROGRESS keys and purge
        // finished records past the retention window.
        const gc = await gcIdempotencyRecords(db);
        if (gc.freedStale > 0 || gc.purgedCompleted > 0) {
          // eslint-disable-next-line no-console
          console.log(`[worker] idempotency GC: freed ${gc.freedStale} stale, purged ${gc.purgedCompleted} completed`);
        }
      } catch {
        // next run
      }
    }, 15 * 60_000);
    hourly.unref();

    const monitor = setInterval(async () => {
      try {
        await monitorStuckPayments(db, registry.default(), { olderThanMs: 5 * 60_000, limit: 20 });
      } catch {
        // next run
      }
    }, 60_000);
    monitor.unref();

    const scheduleTimer = setInterval(async () => {
      try {
        await enqueue("schedules.dispatch", { correlationId: `cron-${Date.now()}`, enqueueNext: false });
      } catch {
        // next run
      }
      try {
        // Recurring report exports (monthly/weekly) + artifact retention sweep.
        const r = await runReportScheduleDispatch(db);
        if (r.produced > 0 || r.purged > 0) {
          // eslint-disable-next-line no-console
          console.log(`[worker] report schedules: produced ${r.produced}, purged ${r.purged} artifact(s)`);
        }
      } catch {
        // next run
      }
    }, 60_000);
    scheduleTimer.unref();

    // Ledger health — double-entry invariant verification (startup + every 10 min).
    // The Redis record (zfloat:ledger:last) is written with EX 900 — longer than
    // the cadence — so an expired or single missed run never leaves the health
    // surface reporting "no ledger health run recorded yet" for a full cycle.
    // A Redis restart still flushes the record with everything else; the ~30s
    // heartbeat restores it within ~60s (see beatHeartbeat below) instead of
    // waiting out the full 10-minute ledger cadence. Both states tripped the
    // ledger_unknown alert rule + E2E health gate.
    const ledgerTimer = setInterval(async () => {
      try {
        await recordLedgerHealth(db);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] ledger health interval run failed:", err instanceof Error ? err.message : err);
      }
    }, 10 * 60_000);
    ledgerTimer.unref();

    // Run once at startup so health is established before the first traffic.
    void recordLedgerHealth(db).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[worker] ledger health startup run failed:", err instanceof Error ? err.message : err);
    });
  }

  // ---- observability: worker heartbeat (always on, not gated by cron flag) ----
  async function recordLedgerHealth(db: Db): Promise<void> {
    const results = await runLedgerHealthCheck(db);
    const redis = getRedis();
    try {
      await redis.set(
        "zfloat:ledger:last",
        JSON.stringify({
          at: new Date().toISOString(),
          ok: results.every((r) => r.healthy),
          tenantsChecked: results.length,
          unbalanced: results.reduce((n, r) => n + r.unbalancedJournals, 0),
        }),
        "EX",
        900,
      );
    } finally {
      redis.disconnect();
    }
    // eslint-disable-next-line no-console
    console.log(
      `[worker] ledger health: ${results.length} tenant(s) checked, ${results.reduce((n, r) => n + r.unbalancedJournals, 0)} unbalanced`,
    );
  }

  // Throttle ledger-record restores from the heartbeat path to at most 1/min.
  let lastLedgerRestoreMs = 0;

  async function beatHeartbeat(): Promise<void> {
    const redis = getRedis();
    try {
      await redis.set("zfloat:worker:heartbeat", new Date().toISOString(), "EX", 300);
      // Self-heal the ledger record on the fast cadence: a Redis restart
      // flushes zfloat:ledger:last along with everything else, and the regular
      // ledger job would not rewrite it for up to 10 minutes — meanwhile the
      // health surface reports "no ledger health run recorded yet" and the
      // ledger_unknown rule fires. If the record is missing, re-run the check
      // here (throttled) so the gap is bounded by ~1 heartbeat interval.
      if (Date.now() - lastLedgerRestoreMs > 60_000) {
        const exists = await redis.exists("zfloat:ledger:last");
        if (exists === 0) {
          lastLedgerRestoreMs = Date.now();
          try {
            await recordLedgerHealth(db);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error("[worker] ledger health heartbeat restore failed:", err instanceof Error ? err.message : err);
          }
        }
      }
    } finally {
      redis.disconnect();
    }
  }
  const heartbeatTimer = setInterval(() => {
    void beatHeartbeat().catch(() => undefined);
  }, 30_000);
  heartbeatTimer.unref();
  void beatHeartbeat().catch(() => undefined);

  // eslint-disable-next-line no-console
  console.log(`[worker] running ${handles.length} queue workers (concurrency ${config.WORKER_CONCURRENCY}) + housekeeping`);
  // eslint-disable-next-line no-console
  console.log("[worker] default provider:", registry.default().code);

  // Keep process alive - BullMQ workers should do this but just in case
  const keepAlive = setInterval(() => {}, 1000);
  // Don't unref - this keeps the process alive

  const shutdown = async () => {
    outbox.stop();
    clearInterval(keepAlive);
    // eslint-disable-next-line no-console
    console.log("[worker] shutting down...");
    await Promise.all(handles.map((h) => h.close()));
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}


main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[worker] fatal:", err);
  process.exit(1);
});
