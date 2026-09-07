"use client";

import { useEffect, useState } from "react";
import { Card, Badge, Button, Skeleton, Spinner } from "@/components/ui";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

type Severity = "ok" | "warn" | "critical";

interface AlertRule {
  rule: string;
  label: string;
  severity: Severity;
  detail: string;
}

interface AlertSendOutcome {
  rule: string;
  severity: string;
  sent: boolean;
  skippedReason?: string;
  channels?: string[];
}

interface OpsAlertRow {
  id: string;
  title: string;
  body: string;
  channel: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
  data: { rule?: string; severity?: string } | null;
}

interface HealthData {
  at: string;
  checks: Check[];
  healthy: boolean;
  metrics: {
    queueBacklogs: Array<{ queue: string; waiting: number; active: number; failed: number }>;
    payments24h: { succeeded: number; failed: number };
    webhookDeliveries24h: { succeeded: number; failed: number };
    outboxUnpublished: number;
    workerHeartbeatAgeMs: number | null;
    ledger: { at: string; ok: boolean; tenantsChecked: number; unbalanced: number } | null;
    activeApiKeys: number;
  };
  alerts: { rules: AlertRule[]; worst: Severity; criticalCount: number; warnCount: number; alertSends?: AlertSendOutcome[] };
}

const sevTone: Record<Severity, "success" | "warning" | "danger"> = {
  ok: "success",
  warn: "warning",
  critical: "danger",
};

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone === "warn" ? "text-amber-600" : ""}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </Card>
  );
}

export default function AdminHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [busy, setBusy] = useState(false);
  const [deliveries, setDeliveries] = useState<OpsAlertRow[] | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load(silent = false) {
    if (!silent) setBusy(true);
    try {
      const res = await fetch("/api/admin/health");
      const body = (await res.json()) as { data: HealthData };
      if (body.data) setData(body.data);
    } catch {
      // keep last snapshot on transient failures
    } finally {
      if (!silent) setBusy(false);
    }
  }

  async function loadDeliveries() {
    try {
      const res = await fetch("/api/admin/health/alerts");
      const body = (await res.json()) as { data: { rows: OpsAlertRow[] } };
      setDeliveries(body.data?.rows ?? []);
    } catch {
      setDeliveries([]);
    }
  }

  async function sendTestAlert() {
    setTestBusy(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/admin/health/alerts/test", { method: "POST" });
      const body = (await res.json()) as { data?: { queued: number; email: string }; error?: { message: string } };
      if (!res.ok) {
        setTestMsg({ ok: false, text: body.error?.message ?? "Test alert failed" });
        return;
      }
      setTestMsg({ ok: true, text: `Test alert queued to ${body.data?.email} — watch for it below.` });
      await loadDeliveries();
    } catch {
      setTestMsg({ ok: false, text: "Network error — try again" });
    } finally {
      setTestBusy(false);
    }
  }

  useEffect(() => {
    void load();
    void loadDeliveries();
    const t = setInterval(() => {
      void load(true);
      void loadDeliveries();
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const checks = data?.checks ?? null;
  const metrics = data?.metrics;
  const alerts = data?.alerts;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System health</h1>
          <p className="mt-1 text-sm text-muted">
            Dependency checks, live metrics and alert rules — refreshed automatically every 30s.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : "Run checks"}
        </Button>
      </div>

      {/* Dependencies */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Dependencies</h2>
      {!checks ? (
        <div className="mt-3 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {checks.map((c) => (
            <Card key={c.name} className="flex items-center justify-between p-5">
              <div>
                <p className="font-medium">{c.name}</p>
                {c.detail ? <p className="text-xs text-muted">{c.detail}</p> : null}
              </div>
              <Badge tone={c.ok ? "success" : "danger"}>{c.ok ? "OK" : "DOWN"}</Badge>
            </Card>
          ))}
        </div>
      )}

      {/* Metrics */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Metrics</h2>
      {metrics ? (
        <div className="mt-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Payments 24h"
              value={`${metrics.payments24h.succeeded} ok`}
              sub={`${metrics.payments24h.failed} failed`}
              tone={metrics.payments24h.failed > 0 ? "warn" : undefined}
            />
            <StatCard
              label="Webhooks 24h"
              value={`${metrics.webhookDeliveries24h.succeeded} delivered`}
              sub={`${metrics.webhookDeliveries24h.failed} failed`}
              tone={metrics.webhookDeliveries24h.failed > 0 ? "warn" : undefined}
            />
            <StatCard label="Outbox unpublished" value={`${metrics.outboxUnpublished}`} sub="events awaiting relay" />
            <StatCard
              label="Worker heartbeat"
              value={metrics.workerHeartbeatAgeMs === null ? "never" : `${Math.max(0, Math.round(metrics.workerHeartbeatAgeMs / 1000))}s ago`}
              sub="written every 30s"
              tone={metrics.workerHeartbeatAgeMs !== null && metrics.workerHeartbeatAgeMs > 60_000 ? "warn" : undefined}
            />
            <StatCard label="Active API keys" value={`${metrics.activeApiKeys}`} sub="developer portal" />
            <StatCard
              label="Ledger health"
              value={metrics.ledger ? (metrics.ledger.ok ? "balanced" : "IMBALANCE") : "no data"}
              sub={metrics.ledger ? `${metrics.ledger.tenantsChecked} tenant(s) checked` : undefined}
              tone={metrics.ledger && !metrics.ledger.ok ? "warn" : undefined}
            />
            <div className="sm:col-span-2">
              <Card className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Queue backlog (critical queues)</p>
                <div className="mt-2 space-y-1.5">
                  {metrics.queueBacklogs.map((q) => (
                    <div key={q.queue} className="flex items-center justify-between text-sm">
                      <span className="font-mono text-xs text-slate-600">{q.queue}</span>
                      <span className="text-xs">
                        {q.waiting < 0 ? (
                          <span className="text-red-600">unreadable</span>
                        ) : (
                          <>
                            <span className={q.waiting > 0 ? "font-semibold text-amber-600" : ""}>{q.waiting} waiting</span>
                            <span className="text-slate-400"> · {q.active} active · {q.failed} failed</span>
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {/* Alert rules */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Alert rules</h2>
      {!alerts ? (
        <div className="mt-3 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <div className="mt-3 space-y-3">
          {alerts.rules.map((r) => (
            <Card key={`${r.rule}-${r.label}`} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{r.label}</p>
                <p className="text-xs text-muted">{r.detail}</p>
              </div>
              <Badge tone={sevTone[r.severity]}>{r.severity === "ok" ? "OK" : r.severity.toUpperCase()}</Badge>
            </Card>
          ))}
          {alerts.alertSends && alerts.alertSends.length > 0 ? (
            <p className="text-xs text-muted">
              Alert dispatch on this check:{" "}
              {alerts.alertSends
                .map((s) => `${s.rule} → ${s.sent ? `sent (${s.channels?.join("+") ?? ""})` : `suppressed (${s.skippedReason ?? "n/a"})`}`)
                .join(" · ")}
            </p>
          ) : (
            <p className="text-xs text-muted">All rules OK — no out-of-band alerts fired on this check.</p>
          )}
        </div>
      )}

      {/* Alert delivery */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Alert delivery</h2>
        <div className="flex items-center gap-3">
          {testMsg ? (
            <p className={`text-xs ${testMsg.ok ? "text-green-600" : "text-red-600"}`}>{testMsg.text}</p>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => void sendTestAlert()} disabled={testBusy}>
            {testBusy ? <Spinner className="h-4 w-4" /> : "Send test alert"}
          </Button>
        </div>
      </div>
      {!deliveries ? (
        <div className="mt-3 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : deliveries.length === 0 ? (
        <Card className="mt-3 p-5 text-sm text-muted">
          No ops alerts sent yet. Fail a rule (or use the test button) and deliveries appear here with their channel status.
        </Card>
      ) : (
        <div className="mt-3 space-y-2">
          {deliveries.map((d) => (
            <Card key={d.id} data-testid="ops-alert-row" className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{d.title}</p>
                <p className="mt-0.5 truncate text-xs text-muted" title={d.body}>
                  {d.body}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {d.channel} · {new Date(d.createdAt).toLocaleString()}
                </p>
              </div>
              <Badge tone={d.status === "SENT" ? "success" : d.status === "FAILED" ? "danger" : "warning"}>{d.status}</Badge>
            </Card>
          ))}
        </div>
      )}

      {/* Overall */}
      <Card className="mt-8 flex items-center justify-between p-5">
        <div>
          <p className="font-medium">Overall platform status</p>
          <p className="text-xs text-muted">
            {data ? `Checked at ${new Date(data.at).toLocaleTimeString()} · ${alerts?.warnCount ?? 0} warning(s), ${alerts?.criticalCount ?? 0} critical` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={data?.healthy ? "success" : "danger"}>
            {data ? (data.healthy ? "HEALTHY" : "DEGRADED") : "—"}
          </Badge>
        </div>
      </Card>
    </div>
  );
}
