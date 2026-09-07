/**
 * GET /api/admin/metrics — Prometheus text exposition (GAP-ANALYSIS Phase 7).
 * Admin-auth (platform admin session). Exposes live operational gauges:
 * per-queue BullMQ depths (waiting/active/delayed/failed), outbox lag
 * (unpublished count + oldest age), worker heartbeat age, Postgres/Redis
 * reachability, 24h payment + webhook outcome totals and the ledger health
 * result. Scrape config: see runbook RB-20 (metrics).
 *
 * Content-Type: text/plain; version=0.0.4
 */
import { getDb, isNull, min, count, schema, sql } from "@zfloat/database";
import { requirePlatformAdmin } from "@/lib/api";
import { QUEUES, getQueueCounts } from "@zfloat/queue";
import { getRedis } from "@zfloat/queue";

const HEARTBEAT_KEY = "zfloat:worker:heartbeat";
const LEDGER_KEY = "zfloat:ledger:last";

export async function GET() {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const redis = getRedis({ bounded: true });
  const lines: string[] = [];
  lines.push("# HELP zfloat_info Static build/runtime info.", "# TYPE zfloat_info gauge", 'zfloat_info{version="1.0.0",node="' + process.version + '"} 1');

  // Postgres reachability
  try {
    await db.execute(sql`select 1`);
    lines.push("# HELP zfloat_postgres_up Whether Postgres answers.", "# TYPE zfloat_postgres_up gauge", "zfloat_postgres_up 1");
  } catch {
    lines.push("# TYPE zfloat_postgres_up gauge", "zfloat_postgres_up 0");
  }

  // Redis reachability + worker heartbeat age
  let redisUp = 0;
  let heartbeatAgeS = -1;
  try {
    const pong = await redis.ping();
    redisUp = pong === "PONG" ? 1 : 0;
    const beat = await redis.get(HEARTBEAT_KEY);
    if (beat) heartbeatAgeS = Math.max(0, Math.round((Date.now() - new Date(beat).getTime()) / 1000));
  } catch {
    redisUp = 0;
  }
  lines.push("# HELP zfloat_redis_up Whether Redis answers.", "# TYPE zfloat_redis_up gauge", `zfloat_redis_up ${redisUp}`);
  lines.push("# HELP zfloat_worker_heartbeat_age_seconds Seconds since the worker's last heartbeat (-1 = never).", "# TYPE zfloat_worker_heartbeat_age_seconds gauge", `zfloat_worker_heartbeat_age_seconds ${heartbeatAgeS}`);

  // Per-queue depths (all queues; critical ones feed the backlog alert rules)
  lines.push("# HELP zfloat_queue_jobs Queue depth by state (waiting/active/delayed/failed).", "# TYPE zfloat_queue_jobs gauge");
  for (const q of QUEUES) {
    try {
      const c = await getQueueCounts(q);
      lines.push(`zfloat_queue_jobs{queue="${q}",state="waiting"} ${c.waiting}`);
      lines.push(`zfloat_queue_jobs{queue="${q}",state="active"} ${c.active}`);
      lines.push(`zfloat_queue_jobs{queue="${q}",state="delayed"} ${c.delayed}`);
      lines.push(`zfloat_queue_jobs{queue="${q}",state="failed"} ${c.failed}`);
    } catch {
      lines.push(`zfloat_queue_jobs{queue="${q}",state="waiting"} -1`);
    }
  }

  // Outbox lag
  try {
    const [lag] = await db
      .select({ n: count(), oldest: min(schema.outboxEvents.createdAt) })
      .from(schema.outboxEvents)
      .where(isNull(schema.outboxEvents.publishedAt));
    const oldestS = lag?.oldest ? Math.max(0, Math.round((Date.now() - lag.oldest.getTime()) / 1000)) : 0;
    lines.push("# HELP zfloat_outbox_unpublished Events awaiting relay.", "# TYPE zfloat_outbox_unpublished gauge", `zfloat_outbox_unpublished ${Number(lag?.n ?? 0)}`);
    lines.push("# HELP zfloat_outbox_oldest_unpublished_seconds Age of the oldest unpublished event.", "# TYPE zfloat_outbox_oldest_unpublished_seconds gauge", `zfloat_outbox_oldest_unpublished_seconds ${oldestS}`);
  } catch {
    lines.push("# TYPE zfloat_outbox_unpublished gauge", "zfloat_outbox_unpublished -1");
  }

  // 24h outcomes
  try {
    const payments = await db.execute(
      sql`select status, count(*)::int as n from payments where created_at >= now() - interval '24 hours' group by status`,
    );
    const p24 = { succeeded: 0, failed: 0 };
    for (const row of payments.rows as Array<{ status: string; n: number }>) {
      if (row.status === "SUCCESS") p24.succeeded += row.n;
      else if (row.status === "FAILED") p24.failed += row.n;
    }
    const webhooks = await db.execute(
      sql`select status, count(*)::int as n from webhook_deliveries where created_at >= now() - interval '24 hours' group by status`,
    );
    const w24 = { succeeded: 0, failed: 0 };
    for (const row of webhooks.rows as Array<{ status: string; n: number }>) {
      if (row.status === "DELIVERED" || row.status === "SUCCESS") w24.succeeded += row.n;
      else if (row.status === "FAILED") w24.failed += row.n;
    }
    lines.push("# HELP zfloat_payments_24h_total Payments settled in the last 24h by outcome.", "# TYPE zfloat_payments_24h_total gauge", `zfloat_payments_24h_total{outcome="succeeded"} ${p24.succeeded}`, `zfloat_payments_24h_total{outcome="failed"} ${p24.failed}`);
    lines.push("# HELP zfloat_webhook_deliveries_24h_total Outbound deliveries in the last 24h by outcome.", "# TYPE zfloat_webhook_deliveries_24h_total gauge", `zfloat_webhook_deliveries_24h_total{outcome="succeeded"} ${w24.succeeded}`, `zfloat_webhook_deliveries_24h_total{outcome="failed"} ${w24.failed}`);
  } catch {
    // best-effort metric
  }

  // Last ledger double-entry health run
  try {
    const raw = await redis.get(LEDGER_KEY);
    const ledger = raw ? (JSON.parse(raw) as { at: string; ok: boolean }) : null;
    const ageS = ledger ? Math.max(0, Math.round((Date.now() - new Date(ledger.at).getTime()) / 1000)) : -1;
    lines.push("# HELP zfloat_ledger_health_last_run_age_seconds Age of the last ledger health run (-1 = never).", "# TYPE zfloat_ledger_health_last_run_age_seconds gauge", `zfloat_ledger_health_last_run_age_seconds ${ageS}`);
  } catch {
    // best-effort metric
  }

  // NOTE: no redis.quit() — bounded clients are a per-process warm singleton.
  return new Response(lines.join("\n") + "\n", {
    status: 200,
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
