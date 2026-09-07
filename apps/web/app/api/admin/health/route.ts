import { getDb, count, isNull, schema, sql } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";
import { getRedis, getQueueCounts, type QueueName } from "@zfloat/queue";
import { evaluateAlerts, worstSeverity } from "@zfloat/observability";
import { maybeSendOpsAlerts } from "@/lib/ops-alerts";

/** Queues whose backlog can block revenue-critical work. */
const CRITICAL_QUEUES: QueueName[] = [
  "payments.execution",
  "batches.execution",
  "files.scan",
  "webhooks.deliver",
  "notifications.send",
];

const HEARTBEAT_KEY = "zfloat:worker:heartbeat";
const LEDGER_KEY = "zfloat:ledger:last";
const WORKER_STALE_MS = 120_000;

export async function GET() {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const redis = getRedis({ bounded: true });

  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  // PostgreSQL
  try {
    const rows = await db.execute(sql`select 1 as ok`);
    checks.push({ name: "postgres", ok: rows.rowCount === 1 });
  } catch (err) {
    checks.push({ name: "postgres", ok: false, detail: err instanceof Error ? err.message : "unreachable" });
  }

  // Redis
  try {
    const pong = await redis.ping();
    checks.push({ name: "redis", ok: pong === "PONG" });
  } catch (err) {
    checks.push({ name: "redis", ok: false, detail: err instanceof Error ? err.message : "unreachable" });
  }

  // Worker heartbeat
  let workerHeartbeatAgeMs: number | null = null;
  try {
    const beat = await redis.get(HEARTBEAT_KEY);
    if (beat) workerHeartbeatAgeMs = Date.now() - new Date(beat).getTime();
    if (beat && workerHeartbeatAgeMs !== null && workerHeartbeatAgeMs <= WORKER_STALE_MS) {
      checks.push({ name: "worker", ok: true, detail: `last beat ${Math.max(0, Math.round(workerHeartbeatAgeMs / 1000))}s ago` });
    } else if (beat) {
      checks.push({ name: "worker", ok: false, detail: `last beat ${Math.max(0, Math.round((workerHeartbeatAgeMs ?? 0) / 1000))}s ago` });
    } else {
      checks.push({ name: "worker", ok: false, detail: "no heartbeat — worker not running" });
    }
  } catch (err) {
    checks.push({ name: "worker", ok: false, detail: err instanceof Error ? err.message : "heartbeat read failed" });
  }

  // Outbox lag
  let outboxUnpublished = 0;
  try {
    const [lag] = await db.select({ n: count() }).from(schema.outboxEvents).where(isNull(schema.outboxEvents.publishedAt));
    outboxUnpublished = lag?.n ?? 0;
    checks.push({ name: "outbox", ok: outboxUnpublished < 1000, detail: `${outboxUnpublished} unpublished` });
  } catch (err) {
    checks.push({ name: "outbox", ok: false, detail: err instanceof Error ? err.message : "query failed" });
  }

  // Ledger double-entry health (last worker run)
  interface LedgerSummary {
    at: string;
    ok: boolean;
    tenantsChecked: number;
    unbalanced: number;
  }
  let ledger: LedgerSummary | null = null;
  try {
    const raw = await redis.get(LEDGER_KEY);
    if (raw) {
      ledger = JSON.parse(raw) as LedgerSummary;
      checks.push({
        name: "ledger",
        ok: ledger?.ok === true,
        detail: ledger ? `last run ${new Date(ledger.at).toISOString()} — ${ledger.tenantsChecked} tenant(s), ${ledger.unbalanced} unbalanced` : "no data",
      });
    } else {
      checks.push({ name: "ledger", ok: false, detail: "no ledger health run recorded yet" });
    }
  } catch (err) {
    checks.push({ name: "ledger", ok: false, detail: err instanceof Error ? err.message : "read failed" });
  }

  // ---- metrics ----
  // Queue backlogs (critical queues)
  const queueBacklogs: Array<{ queue: string; waiting: number; active: number; failed: number }> = [];
  for (const q of CRITICAL_QUEUES) {
    try {
      const c = await getQueueCounts(q);
      queueBacklogs.push({ queue: q, ...c });
    } catch {
      queueBacklogs.push({ queue: q, waiting: -1, active: -1, failed: -1 });
    }
  }

  // Payments settled in the last 24h
  const payments24h = { succeeded: 0, failed: 0 };
  try {
    const rows = await db.execute(
      sql`select status, count(*)::int as n from payments where created_at >= now() - interval '24 hours' group by status`,
    );
    for (const row of rows.rows) {
      const st = String(row.status ?? "");
      const n = Number(row.n ?? 0);
      if (st === "SUCCESS") payments24h.succeeded += n;
      else if (st === "FAILED") payments24h.failed += n;
    }
  } catch {
    // metrics best-effort
  }

  // Webhook deliveries in the last 24h
  const webhookDeliveries24h = { succeeded: 0, failed: 0 };
  try {
    const rows = await db.execute(
      sql`select status, count(*)::int as n from webhook_deliveries where created_at >= now() - interval '24 hours' group by status`,
    );
    for (const row of rows.rows) {
      const st = String(row.status ?? "");
      const n = Number(row.n ?? 0);
      if (st === "DELIVERED" || st === "SUCCESS") webhookDeliveries24h.succeeded += n;
      else if (st === "FAILED") webhookDeliveries24h.failed += n;
    }
  } catch {
    // metrics best-effort
  }

  // Active developer API keys
  let activeApiKeys = 0;
  try {
    const rows = await db.execute(sql`select count(*)::int as n from api_keys where status = 'active'`);
    activeApiKeys = Number(rows.rows[0]?.n ?? 0);
  } catch {
    // metrics best-effort
  }

  const metrics = {
    queueBacklogs,
    payments24h,
    webhookDeliveries24h,
    outboxUnpublished,
    workerHeartbeatAgeMs,
    ledger,
    activeApiKeys,
  };

  // ---- alert rules ----
  const rules = evaluateAlerts({
    checks: Object.fromEntries(checks.map((c) => [c.name, c.ok])),
    workerHeartbeatAgeMs,
    ledger,
    queueBacklogs,
    payments24h,
    webhookDeliveries24h,
    outboxUnpublished,
  });
  const worst = worstSeverity(rules);
  const criticalCount = rules.filter((r) => r.severity === "critical").length;
  const warnCount = rules.filter((r) => r.severity === "warn").length;

  // Phase 4: fire out-of-band ops notifications for non-ok rules (per-rule
  // cooldown, env recipients, fail-closed). Never throws.
  const alertSends = await maybeSendOpsAlerts(db, rules);

  const healthy = checks.every((c) => c.ok) && criticalCount === 0;

  return apiOk({
    data: {
      at: new Date().toISOString(),
      checks,
      healthy,
      metrics,
      alerts: { rules, worst, criticalCount, warnCount, alertSends },
    },
  });
}
