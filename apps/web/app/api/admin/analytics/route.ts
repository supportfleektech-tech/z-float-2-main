import { getDb, schema, sql, count, sum, eq, gte, and } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";
import { getQueueCounts, QUEUES } from "@zfloat/queue";
import { getRedis } from "@zfloat/queue";

const HEARTBEAT_KEY = "zfloat:worker:heartbeat";
const LEDGER_KEY = "zfloat:ledger:last";

export async function GET(req: Request) {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const url = new URL(req.url);
  const timeRange = url.searchParams.get("range") || "24h"; // 24h, 7d, 30d, 90d
  
  const hoursMap: Record<string, number> = { "24h": 24, "7d": 168, "30d": 720, "90d": 2160 };
  const hours = hoursMap[timeRange] || 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  try {
    // 1. Overall stats
    const [
      tenantCountResult,
      userCountResult,
      paymentCountResult,
      volumeResult,
      activeFeeRulesResult,
      openReconResult,
      pendingApprovalsResult,
      auditCountResult,
      activeApiKeysResult,
    ] = await Promise.all([
      db.select({ n: count() }).from(schema.tenants),
      db.select({ n: count() }).from(schema.users),
      db.select({ n: count() }).from(schema.payments),
      db.select({ total: sum(schema.payments.amountMinor) }).from(schema.payments).where(eq(schema.payments.status, "SUCCESS")),
      db.select({ n: count() }).from(schema.feeRules).where(eq(schema.feeRules.status, "ACTIVE")),
      db.select({ n: count() }).from(schema.reconExceptions).where(eq(schema.reconExceptions.status, "OPEN")),
      db.select({ n: count() }).from(schema.approvalRequests).where(eq(schema.approvalRequests.status, "PENDING")),
      db.select({ n: count() }).from(schema.auditEvents),
      db.select({ n: count() }).from(schema.apiKeys).where(eq(schema.apiKeys.status, "ACTIVE")),
    ]);
    const tenantCount = tenantCountResult[0];
    const userCount = userCountResult[0];
    const paymentCount = paymentCountResult[0];
    const activeFeeRules = activeFeeRulesResult[0];
    const openRecon = openReconResult[0];
    const pendingApprovals = pendingApprovalsResult[0];
    const auditCount = auditCountResult[0];
    const activeApiKeys = activeApiKeysResult[0];

    // 2. Time-series data for charts
    const [volumeSeries, paymentMethodSeries, tenantSeries, statusSeries, dailyVolumeSeries] = await Promise.all([
      // Hourly volume for the time range
      db.execute(sql`
        SELECT 
          date_trunc('hour', created_at) as time,
          status,
          SUM(amount_minor) as volume,
          COUNT(*) as count
        FROM payments
        WHERE created_at >= ${since}
        GROUP BY date_trunc('hour', created_at), status
        ORDER BY time ASC
      `),
      // Payment method distribution
      db.execute(sql`
        SELECT 
          channel as name,
          SUM(amount_minor) as value,
          COUNT(*) as count
        FROM payments
        WHERE created_at >= ${since} AND status = 'SUCCESS'
        GROUP BY channel
        ORDER BY value DESC
      `),
      // Top tenants by volume
      db.execute(sql`
        SELECT 
          t.name,
          SUM(p.amount_minor) as volume,
          COUNT(p.id) as payments
        FROM payments p
        JOIN tenants t ON t.id = p.tenant_id
        WHERE p.created_at >= ${since} AND p.status = 'SUCCESS'
        GROUP BY t.id, t.name
        ORDER BY volume DESC
        LIMIT 10
      `),
      // Payment status distribution
      db.execute(sql`
        SELECT 
          status as name,
          COUNT(*) as value
        FROM payments
        WHERE created_at >= ${since}
        GROUP BY status
        ORDER BY value DESC
      `),
      // Daily volume for trend chart
      db.execute(sql`
        SELECT 
          date_trunc('day', created_at) as time,
          SUM(CASE WHEN status = 'SUCCESS' THEN amount_minor ELSE 0 END) as success_volume,
          SUM(CASE WHEN status = 'FAILED' THEN amount_minor ELSE 0 END) as failed_volume,
          COUNT(*) as total_count,
          SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success_count
        FROM payments
        WHERE created_at >= ${since}
        GROUP BY date_trunc('day', created_at)
        ORDER BY time ASC
      `),
    ]);

    // 3. Queue metrics
    const queueMetrics = await Promise.all(
      QUEUES.map(async (q) => {
        try {
          const c = await getQueueCounts(q);
          return { queue: q, ...c };
        } catch {
          return { queue: q, waiting: -1, active: -1, failed: -1 };
        }
      })
    );

    // 4. Redis metrics
    const redis = getRedis({ bounded: true });
    let redisUp = 0;
    let heartbeatAgeMs = -1;
    let ledgerData = null;
    try {
      const pong = await redis.ping();
      redisUp = pong === "PONG" ? 1 : 0;
      const beat = await redis.get(HEARTBEAT_KEY);
      if (beat) heartbeatAgeMs = Math.max(0, Date.now() - new Date(beat).getTime());
      const raw = await redis.get(LEDGER_KEY);
      if (raw) ledgerData = JSON.parse(raw);
    } catch {
      redisUp = 0;
    }

    // 5. Outbox metrics
    const [outboxLagResult] = await db
      .select({ n: count(), oldest: sql<Date | null>`min(${schema.outboxEvents.createdAt})` })
      .from(schema.outboxEvents)
      .where(sql`${schema.outboxEvents.publishedAt} IS NULL`);
    const oldestS = outboxLagResult?.oldest ? Math.max(0, Math.round((Date.now() - new Date(outboxLagResult.oldest).getTime()) / 1000)) : 0;

    // 5. Webhook delivery metrics
    const [webhookSucceededResult] = await db
      .select({ n: count() })
      .from(schema.webhookDeliveries)
      .where(and(
        gte(schema.webhookDeliveries.createdAt, since),
        eq(schema.webhookDeliveries.status, "SUCCESS"),
      ));
    const [webhookFailedResult] = await db
      .select({ n: count() })
      .from(schema.webhookDeliveries)
      .where(and(
        gte(schema.webhookDeliveries.createdAt, since),
        eq(schema.webhookDeliveries.status, "FAILED"),
      ));

    // 7. Webhook delivery 24h is aggregated by webhookDeliveries24h below.

    // 8. Ledger health
    let ledgerHealth = { ok: true, tenantsChecked: 0, unbalanced: 0 };
    if (ledgerData) {
      ledgerHealth = {
        ok: ledgerData.ok,
        tenantsChecked: ledgerData.tenantsChecked || 0,
        unbalanced: ledgerData.unbalanced || 0,
      };
    }

    // Format chart data
    const volumeByHour = new Map<string, { success: number; failed: number; count: number }>();
    for (const row of (volumeSeries.rows as any[])) {
      const time = new Date(row.time).toISOString();
      if (!volumeByHour.has(time)) volumeByHour.set(time, { success: 0, failed: 0, count: 0 });
      const entry = volumeByHour.get(time)!;
      if (row.status === "SUCCESS") entry.success = Number(row.volume);
      else if (row.status === "FAILED") entry.failed = Number(row.volume);
      entry.count += Number(row.count);
    }
    const volumeChartData = Array.from(volumeByHour.entries()).map(([time, data]) => ({
      time: new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      ...data,
    }));

    const dailyVolumeMap = new Map<string, { success: number; failed: number; successCount: number; totalCount: number }>();
    for (const row of (dailyVolumeSeries.rows as any[])) {
      const time = String(row.time ?? "").slice(0, 10);
      dailyVolumeMap.set(time, {
        success: Number(row.success_volume || 0),
        failed: Number(row.failed_volume || 0),
        successCount: Number(row.success_count || 0),
        totalCount: Number(row.total_count || 0),
      });
    }
    const dailyVolumeChartData = Array.from(dailyVolumeMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([time, data]) => ({
        time,
        volume: data.success,
        failed: data.failed,
        count: data.successCount,
      }));

    const paymentMethods = (paymentMethodSeries.rows as any[]).map(r => ({
      name: r.name,
      value: Number(r.value),
      count: Number(r.count),
    }));

    const tenantPerformance = (tenantSeries.rows as any[]).map(r => ({
      name: r.name.length > 20 ? r.name.slice(0, 20) + "..." : r.name,
      volume: Number(r.volume),
      payments: Number(r.payments),
    }));

    const statusDistribution = (statusSeries.rows as any[]).map(r => ({
      name: r.name,
      value: Number(r.value),
    }));

    const queueBacklog = queueMetrics.map(q => ({
      queue: q.queue.replace(/\./g, " "),
      waiting: q.waiting,
      active: q.active,
      failed: q.failed,
    }));

    return apiOk({
      data: {
        overview: {
          tenants: tenantCount?.n ?? 0,
          users: userCount?.n ?? 0,
          payments: paymentCount?.n ?? 0,
          volumeMinor: BigInt(volumeResult?.[0]?.total ?? 0).toString(),
          activeFeeRules: activeFeeRules?.n ?? 0,
          openReconExceptions: openRecon?.n ?? 0,
          pendingApprovals: pendingApprovals?.n ?? 0,
          auditEvents: auditCount?.n ?? 0,
          activeApiKeys: activeApiKeys?.n ?? 0,
        },
        charts: {
          volume: volumeChartData,
          dailyVolume: dailyVolumeChartData,
          paymentMethods,
          tenantPerformance: tenantPerformance.slice(0, 8),
          statusDistribution,
          queueBacklog,
        },
        metrics: {
          payments24h: {
            succeeded: 0, // Will be computed from volumeChartData
            failed: 0,
          },
          webhookDeliveries24h: {
            succeeded: webhookSucceededResult?.n ?? 0,
            failed: webhookFailedResult?.n ?? 0,
          },
          outboxUnpublished: Number(outboxLagResult?.n ?? 0),
          outboxOldestSeconds: oldestS,
          workerHeartbeatAgeMs: heartbeatAgeMs,
          redisUp,
          activeApiKeys: activeApiKeys?.n ?? 0,
          ledger: ledgerHealth,
        },
        timeRange,
      },
    });
  } catch (error) {
    console.error("[admin/analytics] error:", error);
    return apiOk({
      data: {
        overview: {
          tenants: 0,
          users: 0,
          payments: 0,
          volumeMinor: "0",
          activeFeeRules: 0,
          openReconExceptions: 0,
          pendingApprovals: 0,
          auditEvents: 0,
          activeApiKeys: 0,
        },
        charts: {
          volume: [],
          dailyVolume: [],
          paymentMethods: [],
          tenantPerformance: [],
          statusDistribution: [],
          queueBacklog: [],
        },
        metrics: {
          payments24h: { succeeded: 0, failed: 0 },
          webhookDeliveries24h: { succeeded: 0, failed: 0 },
          outboxUnpublished: 0,
          outboxOldestSeconds: 0,
          workerHeartbeatAgeMs: -1,
          redisUp: 0,
          activeApiKeys: 0,
          ledger: { ok: true, tenantsChecked: 0, unbalanced: 0 },
        },
        timeRange,
      },
    });
  }
}