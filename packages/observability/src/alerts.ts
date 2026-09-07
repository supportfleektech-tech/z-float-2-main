/**
 * Alert rules — pure, deterministic evaluation of system-observability inputs
 * into per-rule severities. Kept dependency-free so the rules are unit
 * testable and identical wherever they run (admin health API today, a future
 * standalone alerting relay tomorrow).
 *
 * Severity ladder: ok < warn < critical. The health API marks the platform
 * DEGRADED when any rule is critical.
 */

export type Severity = "ok" | "warn" | "critical";

export interface AlertResult {
  /** Stable machine id, e.g. "worker_stale". */
  rule: string;
  /** Human label, e.g. "Queue worker heartbeat". */
  label: string;
  severity: Severity;
  /** Human-readable current state. */
  detail: string;
}

/** Backlog snapshot of one BullMQ queue (critical queues only). */
export interface QueueBacklog {
  queue: string;
  waiting: number;
  active: number;
  failed: number;
}

/** Everything the evaluator needs — produced by the health API gatherer. */
export interface ObservabilityInput {
  /** Dependency check results by name: postgres, redis, outbox, worker, ledger. */
  checks: Record<string, boolean>;
  /** Age of the worker heartbeat in ms; null when no heartbeat was ever seen. */
  workerHeartbeatAgeMs: number | null;
  /** Last ledger double-entry health run; null before the first run. */
  ledger: { ok: boolean; unbalanced: number } | null;
  queueBacklogs: QueueBacklog[];
  payments24h: { succeeded: number; failed: number };
  webhookDeliveries24h: { succeeded: number; failed: number };
  outboxUnpublished: number;
}

/** Rule thresholds (exported so dashboards/tests share one source of truth). */
export const THRESHOLDS = {
  workerHeartbeatWarnMs: 60_000,
  workerHeartbeatCriticalMs: 120_000,
  queueBacklogWarn: 100,
  queueBacklogCritical: 500,
  paymentSampleMin: 10,
  paymentFailureRateWarn: 0.1,
  paymentFailureRateCritical: 0.3,
  webhookFailuresWarn: 20,
  webhookFailuresCritical: 100,
  outboxLagWarn: 1_000,
  outboxLagCritical: 5_000,
} as const;

const ok = (rule: string, label: string, detail: string): AlertResult => ({ rule, label, severity: "ok", detail });
const warn = (rule: string, label: string, detail: string): AlertResult => ({ rule, label, severity: "warn", detail });
const critical = (rule: string, label: string, detail: string): AlertResult => ({ rule, label, severity: "critical", detail });

export function evaluateAlerts(input: ObservabilityInput): AlertResult[] {
  const out: AlertResult[] = [];
  const t = THRESHOLDS;

  // ---- dependencies ----
  out.push(
    input.checks.postgres === false
      ? critical("postgres_down", "PostgreSQL", "Database unreachable or check failed")
      : ok("postgres_down", "PostgreSQL", "Database reachable"),
  );
  out.push(
    input.checks.redis === false
      ? critical("redis_down", "Redis", "Redis unreachable or check failed")
      : ok("redis_down", "Redis", "Redis reachable"),
  );

  // ---- worker heartbeat ----
  if (input.workerHeartbeatAgeMs === null) {
    out.push(critical("worker_stale", "Queue worker heartbeat", "No heartbeat ever recorded — worker not running"));
  } else if (input.workerHeartbeatAgeMs > t.workerHeartbeatCriticalMs) {
    out.push(critical("worker_stale", "Queue worker heartbeat", `Last heartbeat ${Math.round(input.workerHeartbeatAgeMs / 1000)}s ago`));
  } else if (input.workerHeartbeatAgeMs > t.workerHeartbeatWarnMs) {
    out.push(warn("worker_stale", "Queue worker heartbeat", `Last heartbeat ${Math.round(input.workerHeartbeatAgeMs / 1000)}s ago`));
  } else {
    out.push(ok("worker_stale", "Queue worker heartbeat", "Heartbeat fresh"));
  }

  // ---- ledger health ----
  if (input.ledger === null) {
    out.push(warn("ledger_unknown", "Ledger double-entry health", "No health run recorded yet"));
  } else if (!input.ledger.ok) {
    out.push(
      critical("ledger_imbalance", "Ledger double-entry health", `${input.ledger.unbalanced} journal(s) out of balance`),
    );
  } else {
    out.push(ok("ledger_imbalance", "Ledger double-entry health", "All journals balanced"));
  }

  // ---- queue backlogs (per critical queue) ----
  for (const q of input.queueBacklogs) {
    const waitingLabel = `${q.waiting} waiting / ${q.active} active / ${q.failed} failed`;
    if (q.waiting >= t.queueBacklogCritical) {
      out.push(critical("queue_backlog", `Queue backlog · ${q.queue}`, waitingLabel));
    } else if (q.waiting >= t.queueBacklogWarn) {
      out.push(warn("queue_backlog", `Queue backlog · ${q.queue}`, waitingLabel));
    } else {
      out.push(ok("queue_backlog", `Queue backlog · ${q.queue}`, waitingLabel));
    }
  }

  // ---- payment failure rate (24h) ----
  const total = input.payments24h.succeeded + input.payments24h.failed;
  if (total < t.paymentSampleMin) {
    out.push(ok("payment_failure_rate", "Payment failure rate (24h)", `Insufficient traffic (${total} settled)`));
  } else {
    const rate = input.payments24h.failed / total;
    const pct = `${(rate * 100).toFixed(1)}% (${input.payments24h.failed}/${total} failed)`;
    if (rate >= t.paymentFailureRateCritical) {
      out.push(critical("payment_failure_rate", "Payment failure rate (24h)", pct));
    } else if (rate >= t.paymentFailureRateWarn) {
      out.push(warn("payment_failure_rate", "Payment failure rate (24h)", pct));
    } else {
      out.push(ok("payment_failure_rate", "Payment failure rate (24h)", pct));
    }
  }

  // ---- webhook delivery failures (24h) ----
  const wh = input.webhookDeliveries24h.failed;
  if (wh >= t.webhookFailuresCritical) {
    out.push(critical("webhook_failures", "Webhook delivery failures (24h)", `${wh} failed deliveries`));
  } else if (wh >= t.webhookFailuresWarn) {
    out.push(warn("webhook_failures", "Webhook delivery failures (24h)", `${wh} failed deliveries`));
  } else {
    out.push(ok("webhook_failures", "Webhook delivery failures (24h)", `${wh} failed deliveries`));
  }

  // ---- outbox lag ----
  if (input.outboxUnpublished >= t.outboxLagCritical) {
    out.push(critical("outbox_lag", "Outbox lag", `${input.outboxUnpublished} unpublished events`));
  } else if (input.outboxUnpublished >= t.outboxLagWarn) {
    out.push(warn("outbox_lag", "Outbox lag", `${input.outboxUnpublished} unpublished events`));
  } else {
    out.push(ok("outbox_lag", "Outbox lag", `${input.outboxUnpublished} unpublished events`));
  }

  return out;
}

export function worstSeverity(results: AlertResult[]): Severity {
  if (results.some((r) => r.severity === "critical")) return "critical";
  if (results.some((r) => r.severity === "warn")) return "warn";
  return "ok";
}
