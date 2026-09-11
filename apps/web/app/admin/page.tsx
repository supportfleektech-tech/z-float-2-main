"use client";

import { useEffect, useState } from "react";
import { Card, Badge, Skeleton, Select, Button, PageHeader } from "@/components/ui";
import { formatKES } from "@/lib/money";
import {
  PaymentsVolumeChart,
  RevenueTrendChart,
  PaymentMethodDistributionChart,
  TenantPerformanceChart,
  QueueBacklogChart,
  LedgerHealthChart,
  RealTimeMetricCard,
} from "@/components/admin/Charts";

interface AnalyticsData {
  overview: {
    tenants: number;
    users: number;
    payments: number;
    volumeMinor: string;
    activeFeeRules: number;
    openReconExceptions: number;
    pendingApprovals: number;
    auditEvents: number;
    activeApiKeys: number;
  };
  charts: {
    volume: Array<{ time: string; success: number; failed: number; count: number }>;
    dailyVolume: Array<{ time: string; volume: number; failed: number; count: number }>;
    paymentMethods: Array<{ name: string; value: number; count: number }>;
    tenantPerformance: Array<{ name: string; volume: number; payments: number }>;
    statusDistribution: Array<{ name: string; value: number }>;
    queueBacklog: Array<{ queue: string; waiting: number; active: number; failed: number }>;
  };
  metrics: {
    payments24h: { succeeded: number; failed: number };
    webhookDeliveries24h: { succeeded: number; failed: number };
    outboxUnpublished: number;
    outboxOldestSeconds: number;
    workerHeartbeatAgeMs: number;
    redisUp: number;
    activeApiKeys: number;
    ledger: { ok: boolean; tenantsChecked: number; unbalanced: number };
  };
  timeRange: string;
}

export default function AdminOverview() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState("24h");
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/analytics?range=${timeRange}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data?.overview || !body?.data?.charts || !body?.data?.metrics) {
        throw new Error(body?.error?.message ?? `Analytics unavailable (HTTP ${res.status})`);
      }
      if (body.data) {
        // Compute payments24h from volume chart data
        const volume = Array.isArray(body.data.charts.volume) ? body.data.charts.volume : [];
        const succeeded = volume.reduce((sum: number, d: any) => sum + (d.success || 0), 0);
        const failed = volume.reduce((sum: number, d: any) => sum + (d.failed || 0), 0);

        setData({
          ...body.data,
          metrics: {
            ...body.data.metrics,
            payments24h: { succeeded, failed },
          },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [timeRange]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-danger/20 bg-danger/5 p-6 text-center text-danger">
        {error}
        <Button variant="secondary" size="sm" className="mt-3" onClick={fetchData}>
          Retry
        </Button>
      </div>
    );
  }

  const d = data!;

  const formatNumber = (n: number) => n.toLocaleString();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform overview"
        subtitle="Everything across every tenant — live analytics from the database."
        actions={
          <div className="flex items-center gap-2">
            <Select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="w-36">
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </Select>
            <Button variant="secondary" size="sm" onClick={fetchData}>
              Refresh
            </Button>
          </div>
        }
      />

      {/* Key Metrics Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <RealTimeMetricCard
          label="Tenants"
          value={formatNumber(d.overview.tenants)}
          trend="neutral"
        />
        <RealTimeMetricCard
          label="Active Users"
          value={formatNumber(d.overview.users)}
          trend="neutral"
        />
        <RealTimeMetricCard
          label={`Payments (${timeRange})`}
          value={formatNumber(d.charts.volume.reduce((s, v) => s + v.count, 0))}
        />
        <RealTimeMetricCard
          label={`Volume (${timeRange})`}
          value={formatKES(d.charts.volume.reduce((s, v) => s + (v.success || 0), 0).toString())}
        />
        <RealTimeMetricCard
          label="Pending Approvals"
          value={d.overview.pendingApprovals}
          trend={d.overview.pendingApprovals > 0 ? "up" : "neutral"}
        />
      </div>

      {/* Charts Row 1: Volume & Revenue */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Payments Volume</h2>
            <Badge tone={d.metrics.payments24h.failed > 0 ? "warning" : "success"}>
              {d.metrics.payments24h.failed > 0 ? `${d.metrics.payments24h.failed} failed` : "All healthy"}
            </Badge>
          </div>
          <PaymentsVolumeChart data={d.charts.volume} />
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold mb-4">Revenue Trend</h2>
          <RevenueTrendChart data={d.charts.dailyVolume} />
        </Card>
      </div>

      {/* Charts Row 2: Distribution & Performance */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="font-semibold mb-4">Payment Methods Distribution</h2>
          <PaymentMethodDistributionChart data={d.charts.paymentMethods} />
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold mb-4">Top Tenants by Volume</h2>
          <TenantPerformanceChart data={d.charts.tenantPerformance} />
        </Card>
      </div>

      {/* Charts Row 3: Status & Queue Health */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="font-semibold mb-4">Payment Status Distribution</h2>
          <PaymentMethodDistributionChart data={d.charts.statusDistribution} />
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Queue Backlog</h2>
            <Badge tone={d.metrics.workerHeartbeatAgeMs > 60000 ? "danger" : "success"}>
              {d.metrics.workerHeartbeatAgeMs === -1 ? "Worker down" : d.metrics.workerHeartbeatAgeMs > 60000 ? "Stale" : "Healthy"}
            </Badge>
          </div>
          <QueueBacklogChart data={d.charts.queueBacklog} />
        </Card>
      </div>

      {/* System Health Row */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6">
          <h2 className="font-semibold mb-4">System Dependencies</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-control border border-borderline">
              <span className="font-medium">PostgreSQL</span>
              <Badge tone="success">Connected</Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-control border border-borderline">
              <span className="font-medium">Redis / Valkey</span>
              <Badge tone={d.metrics.redisUp ? "success" : "danger"}>
                {d.metrics.redisUp ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-control border border-borderline">
              <span className="font-medium">Worker Heartbeat</span>
              <Badge tone={d.metrics.workerHeartbeatAgeMs === -1 ? "danger" : d.metrics.workerHeartbeatAgeMs > 60000 ? "warning" : "success"}>
                {d.metrics.workerHeartbeatAgeMs === -1
                  ? "Never"
                  : d.metrics.workerHeartbeatAgeMs > 60000
                  ? `${Math.round(d.metrics.workerHeartbeatAgeMs / 1000)}s ago (STALE)`
                  : `${Math.round(d.metrics.workerHeartbeatAgeMs / 1000)}s ago`}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-control border border-borderline">
              <span className="font-medium">Ledger Health</span>
              <Badge tone={d.metrics.ledger.ok ? "success" : "danger"}>
                {d.metrics.ledger.ok ? `Balanced (${d.metrics.ledger.tenantsChecked} tenants)` : `IMBALANCE (${d.metrics.ledger.unbalanced} unbalanced)`}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-control border border-borderline">
              <span className="font-medium">Outbox Relay</span>
              <Badge tone={d.metrics.outboxUnpublished > 100 ? "warning" : "success"}>
                {d.metrics.outboxUnpublished} unpublished
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-control border border-borderline">
              <span className="font-medium">Active API Keys</span>
              <Badge tone="neutral">{d.metrics.activeApiKeys}</Badge>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold mb-4">Ledger Double-Entry Health</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-control border border-borderline">
              <span className="font-medium">Last Check</span>
              <span className="text-sm text-muted">
                {d.metrics.ledger.tenantsChecked > 0
                  ? `Checked ${d.metrics.ledger.tenantsChecked} tenant(s)`
                  : "No data"}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-control border border-borderline">
              <span className="font-medium">Unbalanced Journals</span>
              <Badge tone={d.metrics.ledger.unbalanced > 0 ? "danger" : "success"}>
                {d.metrics.ledger.unbalanced}
              </Badge>
            </div>
            <LedgerHealthChart data={[]} />
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <Button className="w-full justify-start gap-3" onClick={() => window.location.href = "/admin/tenants"}>
              <span>👥</span>
              <span>Manage Tenants & Merchants</span>
            </Button>
            <Button className="w-full justify-start gap-3" onClick={() => window.location.href = "/admin/pricing"}>
              <span>💰</span>
              <span>Pricing & Fee Rules</span>
            </Button>
            <Button className="w-full justify-start gap-3" onClick={() => window.location.href = "/admin/providers"}>
              <span>🔗</span>
              <span>Providers & Routing</span>
            </Button>
            <Button className="w-full justify-start gap-3" onClick={() => window.location.href = "/admin/approvals"}>
              <span>✍️</span>
              <span>Config Approvals ({d.overview.pendingApprovals} pending)</span>
            </Button>
            <Button className="w-full justify-start gap-3" onClick={() => window.location.href = "/admin/reconciliation"}>
              <span>🔄</span>
              <span>Reconciliation ({d.overview.openReconExceptions} exceptions)</span>
            </Button>
            <Button className="w-full justify-start gap-3" onClick={() => window.location.href = "/admin/kyc"}>
              <span>⚖️</span>
              <span>KYC & AML Cases</span>
            </Button>
            <Button className="w-full justify-start gap-3" onClick={() => window.location.href = "/admin/audit"}>
              <span>📋</span>
              <span>Audit Log ({d.overview.auditEvents} events)</span>
            </Button>
            <Button className="w-full justify-start gap-3" onClick={() => window.location.href = "/admin/health"}>
              <span>♥️</span>
              <span>System Health Deep Dive</span>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}