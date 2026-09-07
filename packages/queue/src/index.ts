/**
 * Queue infrastructure — BullMQ over Redis with sane defaults for a financial
 * workload: exponential backoff, job IDs as idempotency guards, dead-letter
 * via stalled/failed job visibility, and a correlation id on every job.
 *
 * Queue names used by Z-float:
 *  - payments.execution     (single payment provider dispatch)
 *  - batches.execution      (chunked bulk-payment execution)
 *  - webhooks.process       (verified provider callbacks)
 *  - schedules.dispatch     (recurring payment due checks)
 *  - reconciliation.run     (matching jobs)
 *  - notifications.send     (email/sms/in-app)
 *  - files.scan             (malware scanning)
 *  - reports.generate       (async report exports)
 *  - payments.monitor       (provider status polling / unknown-state recovery)
 */
import { Queue, Worker, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { getConfig } from "@zfloat/config";

export const QUEUES = [
  "payments.execution",
  "batches.execution",
  "webhooks.process",
  "schedules.dispatch",
  "reconciliation.run",
  "notifications.send",
  "files.scan",
  "reports.generate",
  "payments.monitor",
  "webhooks.deliver",
] as const;
export type QueueName = (typeof QUEUES)[number];

export interface JobPayload {
  /** Correlation id — every job is traceable end to end. */
  correlationId: string;
  /** Idempotency key of the originating command, where applicable. */
  idempotencyKey?: string;
  tenantId?: string;
  [key: string]: unknown;
}

/** Baseline BullMQ job options (cleanup retention applies to every queue). */
const baseJobOptions: JobsOptions = {
  removeOnComplete: { age: 60 * 60 * 24 * 7, count: 10_000 }, // keep a week for forensics
  removeOnFail: { age: 60 * 60 * 24 * 30, count: 20_000 },
};

/**
 * Explicit per-queue attempts/backoff (GAP-ANALYSIS Phase 7; closes
 * KNOWN_LIMITATIONS #21). Every queue is listed with its rationale so tuning
 * is deliberate, not BullMQ-default drift:
 *
 *  - payments/batches/schedules/recon: 5 attempts, 1s → 16s ladder — money
 *    movement and its triggers retry across transient provider/DB hiccups,
 *    then fail loudly for a human (payments carry their own idempotency keys).
 *  - webhooks.process: 8 attempts — inbound event ingestion is idempotent
 *    (dedupe by webhook_event id) and must survive slow partners.
 *  - notifications.send: 10 attempts over a longer ladder — out-of-band
 *    delivery (email/SMS) is cheap, idempotent (SENT guard) and the least
 *    important to fail fast on.
 *  - files.scan / reports.generate / payments.monitor: 3–5 attempts as noted.
 */
export const QUEUE_POLICIES: Record<QueueName, { attempts: number; backoffDelayMs: number; note: string }> = {
  "payments.execution": { attempts: 5, backoffDelayMs: 1_000, note: "money movement; idempotent, retry transient, then DLQ to human" },
  "batches.execution": { attempts: 5, backoffDelayMs: 1_000, note: "batch rows materialize idempotently per row" },
  "webhooks.process": { attempts: 8, backoffDelayMs: 1_000, note: "inbound event ingestion, idempotent by event id" },
  "schedules.dispatch": { attempts: 5, backoffDelayMs: 1_000, note: "dispatch tick must not silently drop" },
  "reconciliation.run": { attempts: 5, backoffDelayMs: 5_000, note: "statements can be large; back off gentler" },
  "notifications.send": { attempts: 10, backoffDelayMs: 2_000, note: "email/SMS cheap + idempotent SENT guard" },
  "files.scan": { attempts: 3, backoffDelayMs: 2_000, note: "malware scan; fail to quarantine quickly" },
  "reports.generate": { attempts: 3, backoffDelayMs: 5_000, note: "heavy job; retry slow" },
  "payments.monitor": { attempts: 5, backoffDelayMs: 2_000, note: "stuck-payment sweep must eventually run" },
  "webhooks.deliver": { attempts: 5, backoffDelayMs: 2_000, note: "outbound fanout; own 4xx/5xx classification inside job" },
};

/** Resolve the job options for a queue + caller overrides (pure, unit-tested). */
export function resolveJobOptions(
  queueName: QueueName,
  opts?: { jobId?: string; delayMs?: number; attempts?: number },
): JobsOptions {
  const policy = QUEUE_POLICIES[queueName];
  return {
    ...baseJobOptions,
    ...(opts ? { jobId: opts.jobId, delay: opts.delayMs ?? 0 } : { delay: 0 }),
    attempts: opts?.attempts ?? policy.attempts,
    backoff: { type: "exponential", delay: policy.backoffDelayMs },
  };
}

function redisConnection(): { host: string; port: number; prefix?: string } {
  const config = getConfig();
  const url = new URL(config.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    prefix: config.REDIS_PREFIX ? `{${config.REDIS_PREFIX}}` : undefined,
  };
}

export interface QueueClient {
  enqueue(
    queueName: QueueName,
    payload: JobPayload,
    opts?: { jobId?: string; delayMs?: number; attempts?: number },
  ): Promise<string>;
}

export class BullQueueClient implements QueueClient {
  private queues = new Map<QueueName, Queue>();
  private readonly conn = redisConnection();

  private getQueue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.conn });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueue(
    queueName: QueueName,
    payload: JobPayload,
    opts?: { jobId?: string; delayMs?: number; attempts?: number },
  ): Promise<string> {
    const q = this.getQueue(queueName);
    const job = await q.add("default", payload, resolveJobOptions(queueName, opts));
    return job.id ?? "";
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }
}

/** Enqueue without requiring a long-lived client instance (creates on demand). */
export async function enqueue(queueName: QueueName, payload: JobPayload, opts?: { jobId?: string; delayMs?: number }): Promise<string> {
  const client = new BullQueueClient();
  const id = await client.enqueue(queueName, payload, opts);
  await client.close();
  return id;
}

export type JobHandler = (payload: JobPayload) => Promise<void>;

export interface WorkerHandle {
  close(): Promise<void>;
  readonly queueName: QueueName;
}

/**
 * Register a worker for a queue. Multiple handlers per queue are not allowed
 * (single responsibility per queue).
 */
export function startWorker(queueName: QueueName, handler: JobHandler, opts?: { concurrency?: number }): WorkerHandle {
  const config = getConfig();
  const worker = new Worker(
    queueName,
    async (job) => {
      await handler(job.data as JobPayload);
    },
    {
      connection: redisConnection(),
      concurrency: opts?.concurrency ?? config.WORKER_CONCURRENCY,
    },
  );
  worker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`[worker] ${queueName} job ${job?.id} failed after ${job?.attemptsMade} attempts:`, err.message);
  });
  worker.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error(`[worker] ${queueName} connection error:`, err.message);
  });
  return {
    queueName,
    close: async () => {
      await worker.close();
    },
  };
}

/**
 * Standalone Redis for cache/locks used by rate limiting and features.
 * Bounded clients are a per-process WARM SINGLETON (one per Redis URL): with
 * enableOfflineQueue:false a freshly-created ioredis client rejects any
 * command issued before the socket reaches 'ready' — a few ms on loopback but
 * enough to break request paths that create a client and immediately
 * ping/incr against a HEALTHY Redis (health checks, rate limiting, cooldowns,
 * metrics). Reusing one warmed client makes the fail-fast contract about
 * OUTAGES only: while the connection is down every command rejects quickly
 * (no hung HTTP requests); the background retryStrategy keeps reconnecting
 * (exponential to 1s, never gives up) so the same client recovers after an
 * outage without a process restart. Workers/BullMQ keep the resilient
 * long-retry client so they survive blips and reconnect.
 */
export interface RedisClientOptions {
  /** bounded: fail fast instead of queueing commands while Redis is down. */
  bounded?: boolean;
}

export function getRedis(opts?: RedisClientOptions): Redis {
  return createRedisClient(opts);
}

const boundedClients = new Map<string, Redis>();

export function createRedisClient(opts?: RedisClientOptions): Redis {
  const url = getConfig().REDIS_URL;
  if (opts?.bounded) {
    let client = boundedClients.get(url);
    if (!client) {
      client = new Redis(url, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2_000,
        retryStrategy: (times) => Math.min(times * 100, 1_000),
      });
      // Connection failures are surfaced through command rejections / promise
      // callers; without a listener ioredis also emits an unhandled 'error'
      // event for every refused connect (log spam during outages).
      client.on("error", () => undefined);
      boundedClients.set(url, client);
    }
    return client;
  }
  const client = new Redis(url, { maxRetriesPerRequest: null });
  client.on("error", () => undefined);
  return client;
}

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

/**
 * Snapshot a queue's live job counts (observability: backlog alerts).
 * Opens/closes its own Queue instance, like {@link enqueue}.
 */
export async function getQueueCounts(queueName: QueueName): Promise<QueueCounts> {
  const queue = new Queue(queueName, { connection: redisConnection() });
  try {
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
    };
  } finally {
    await queue.close();
  }
}
