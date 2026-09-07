/**
 * Outbox relay — publishes outbox_events to their handlers on a poll loop.
 *
 * Deployment model:
 *  - the worker embeds this relay for single-node setups (same 5s cadence it
 *    always had), and
 *  - `services/outbox-relay` runs the SAME loop as a standalone deployment,
 *    so production can scale the poller independently of the queue workers.
 *
 * Concurrency arbitration: every poll tick takes a Postgres advisory
 * transaction lock (`pg_try_advisory_xact_lock`) before pulling rows. When
 * the worker and one or more relay instances run together, exactly one of
 * them wins each tick, so events are never double-dispatched. The lease is
 * transaction-scoped: it auto-releases on commit or crash, and the
 * markPublished / markFailed updates commit atomically with the lease.
 *
 * Delivery semantics remain at-least-once: an event that fails to publish
 * stays unpublished (attempts++ via markFailed) and is retried on a later
 * tick up to the attempts cap enforced by pullUnpublished.
 */
import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";
import { enqueue } from "@zfloat/queue";
import { queueNotification } from "@zfloat/notifications";
import { markBatchRowOutcome, refreshBatchStatus } from "./bulk.js";
import { fanoutWebhookDeliveries } from "./outbound.js";
import { markFailed, markPublished, pullUnpublished } from "./outbox.js";
import { getConfig } from "@zfloat/config";

/** Advisory-lock key shared by every relay/worker deployment (arbitrary int8). Default: 723993001. Configurable via OUTBOX_RELAY_LEASE_KEY env var. */
export function getOutboxRelayLeaseKey(): number {
  return getConfig().OUTBOX_RELAY_LEASE_KEY;
}

export interface OutboxEventRef {
  id: string;
  eventType: string;
  tenantId: string | null;
  payload: Record<string, unknown>;
}

/** Handler invoked per unpublished event (bound to its own db handle). */
export type OutboxHandler = (event: OutboxEventRef) => Promise<void>;

export interface OutboxBatchResult {
  dispatched: number;
  failed: number;
}

export interface OutboxTickResult extends OutboxBatchResult {
  /** True when another poller held the dispatch lease for this tick. */
  skipped: boolean;
}

/** Route a single outbox event to its consumers (execution queue, notifications, webhooks). */
export async function handleOutboxEvent(db: Db, event: OutboxEventRef): Promise<void> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.eventType) {
    case "payment.queued": {
      // Bridge: outbox → execution queue. Single payments submitted via the web
      // API land here; batches enqueue their rows' executions directly.
      const paymentId = String(payload.paymentId ?? "");
      if (paymentId) {
        await enqueue(
          "payments.execution",
          {
            correlationId: `outbox:${event.id}`,
            tenantId: event.tenantId ?? undefined,
            paymentId,
            providerCode: "local-sandbox",
            attemptNumber: 1,
            idempotencyKey: `pay:${paymentId}`,
          },
          { jobId: `pay-${paymentId}` },
        );
      }
      break;
    }
    case "batch.approved": {
      // Bridge: approved batches → chunked execution queue. Deliberately NOT
      // wired to batch.submitted — that event means the batch is SUBMITTED and
      // awaiting approval; execution must wait for batch.approved.
      const batchId = String(payload.batchId ?? "");
      if (batchId && event.tenantId) {
        await enqueue(
          "batches.execution",
          {
            correlationId: `outbox:${event.id}`,
            tenantId: event.tenantId,
            batchId,
            actorId: payload.actorId as string | undefined,
            providerCode: "local-sandbox",
          },
          { jobId: `batch-${batchId}` },
        );
      }
      break;
    }
    case "payment.succeeded":
    case "payment.failed":
    case "payment.reversed":
    case "payment.approval_requested": {
      const title = {
        "payment.succeeded": "Payment successful",
        "payment.failed": "Payment failed",
        "payment.reversed": "Payment reversed",
        "payment.approval_requested": "Approval required",
      }[event.eventType] ?? "Payment update";

      // Batch row sync: any terminal payment outcome propagates to its batch
      // row, and the batch status is recomputed (COMPLETED / PARTIALLY_FAILED).
      // This is the single funnel for every outcome path (sync provider
      // result, verified webhook, monitor recovery, reversal).
      if (event.eventType !== "payment.approval_requested") {
        const paymentId = String(payload.paymentId ?? "");
        if (paymentId) {
          const [row] = await db
            .select({ id: schema.paymentBatchRows.id })
            .from(schema.paymentBatchRows)
            .where(eq(schema.paymentBatchRows.paymentId, paymentId))
            .limit(1);
          if (row) {
            await markBatchRowOutcome(db, {
              rowId: row.id,
              status: event.eventType === "payment.succeeded" ? "SUCCESS" : "FAILED",
              errorMessage: event.eventType === "payment.succeeded" ? undefined : String(payload.errorMessage ?? payload.reason ?? "payment failed"),
            });
            const [payment] = await db
              .select({ batchId: schema.payments.batchId })
              .from(schema.payments)
              .where(eq(schema.payments.id, paymentId))
              .limit(1);
            if (payment?.batchId) await refreshBatchStatus(db, payment.batchId);
          }
        }
      }
      await queueNotification(db, {
        tenantId: event.tenantId ?? undefined,
        channel: "IN_APP",
        title,
        body: `${title} — ${String(payload.paymentId ?? "")}`,
        data: payload,
      });
      break;
    }
    default:
      break;
  }

  // Outbound tenant webhooks: fan out domain events to matching subscriptions.
  if (event.tenantId) {
    try {
      await fanoutWebhookDeliveries(db, {
        tenantId: event.tenantId,
        eventType: event.eventType,
        payload,
      });
    } catch {
      // fanout must never break the core outbox handler; deliveries can be retried via the queue
    }
  }
}

/** Pull and dispatch one batch of unpublished events (no lease). */
export async function processOutboxBatch(db: Db, handle: OutboxHandler, limit = 100): Promise<OutboxBatchResult> {
  const events = await pullUnpublished(db, limit);
  let dispatched = 0;
  let failed = 0;
  for (const event of events) {
    try {
      await handle({
        id: event.id,
        eventType: event.eventType,
        tenantId: event.tenantId,
        payload: (event.payload ?? {}) as Record<string, unknown>,
      });
      await markPublished(db, event.id);
      dispatched += 1;
    } catch (err) {
      await markFailed(db, event.id, err instanceof Error ? err.message : "outbox handler failed");
      failed += 1;
    }
  }
  return { dispatched, failed };
}

/**
 * One poll tick. Runs inside a transaction that first tries the shared
 * advisory lease: a losing tick is skipped, a winning tick dispatches and
 * marks events inside the same transaction (commit is atomic with the lease).
 */
export async function dispatchOutboxTick(db: Db, opts: { handle: OutboxHandler; limit?: number }): Promise<OutboxTickResult> {
  const result: OutboxTickResult = { dispatched: 0, failed: 0, skipped: true };
  await db.transaction(async (tx) => {
    // drizzle returns a bare row array for literal SQL but the full pg
    // ResultSet for parameterized queries — unwrap both shapes.
    const leaseKey = getOutboxRelayLeaseKey();
    const raw = (await tx.execute(sql`select pg_try_advisory_xact_lock(${leaseKey}) as ok`)) as
      | Array<{ ok: boolean | null }>
      | { rows?: Array<{ ok: boolean | null }> };
    const rowsArr = Array.isArray(raw) ? raw : (raw.rows ?? []);
    const acquired = rowsArr[0]?.ok === true;
    if (!acquired) return; // another poller owns this tick
    const r = await processOutboxBatch(tx, opts.handle, opts.limit ?? 100);
    result.dispatched = r.dispatched;
    result.failed = r.failed;
    result.skipped = false;
  });
  return result;
}

export interface OutboxPollerOptions {
  handle: OutboxHandler;
  intervalMs?: number;
  batchSize?: number;
  log?: (line: string) => void;
}

export interface OutboxPoller {
  stop: () => void;
}

/** Run the dispatch loop until stop() — safe to embed (worker) or deploy standalone (relay). */
export function runOutboxPoller(db: Db, opts: OutboxPollerOptions): OutboxPoller {
  const intervalMs = opts.intervalMs ?? 5_000;
  const timer = setInterval(async () => {
    try {
      const r = await dispatchOutboxTick(db, { handle: opts.handle, limit: opts.batchSize ?? 100 });
      if (!r.skipped && (r.dispatched > 0 || r.failed > 0)) {
        opts.log?.(`[outbox] tick: dispatched ${r.dispatched}, failed ${r.failed}`);
      }
    } catch {
      // transient (db hiccup) — next tick
    }
  }, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
