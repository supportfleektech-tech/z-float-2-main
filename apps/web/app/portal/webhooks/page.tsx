"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card, Button, Input, Label, TableShell, Badge, Skeleton, Modal, Spinner } from "@/components/ui";

interface Sub {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: string;
  secretVersion: number;
  createdAt: string;
}

interface Delivery {
  id: string;
  subscriptionId: string;
  eventType: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  signature: string | null;
  createdAt: string;
  nextRetryAt: string | null;
}

interface DeliveryDetail extends Delivery {
  payload: Record<string, unknown>;
  payloadBody: string | null;
  updatedAt: string | null;
}

const ALL_EVENTS = ["payment.completed", "payment.failed", "payment.reversed", "batch.completed", "wallet.funded"];

const pretty = (v: unknown): string => {
  try {
    return JSON.stringify(v, null, 1);
  } catch {
    return String(v);
  }
};
const fmt = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : "—");

export default function WebhooksPage() {
  const [subs, setSubs] = useState<Sub[] | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", secret: "", events: ["payment.completed"] });
  const [createdSecret, setCreatedSecret] = useState<{ label: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "FAILED">("ALL");
  const [inspect, setInspect] = useState<DeliveryDetail | null>(null);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [busyReplay, setBusyReplay] = useState<string | null>(null);
  const [busyRotate, setBusyRotate] = useState<string | null>(null);

  function load() {
    fetch("/api/webhooks")
      .then((r) => r.json())
      .then((d) => {
        setSubs(d.data?.subscriptions ?? []);
        setDeliveries(d.data?.deliveries ?? []);
      })
      .catch(() => {
        setSubs([]);
        setDeliveries([]);
      });
  }
  useEffect(load, []);

  function toggleEvent(ev: string) {
    setForm((f) => ({
      ...f,
      events: f.events.includes(ev) ? f.events.filter((e) => e !== ev) : [...f.events, ev],
    }));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error?.message ?? "Could not subscribe");
        return;
      }
      setCreatedSecret({ label: "Endpoint created — signing secret (shown once)", secret: d.data.secret });
      setOpen(false);
      setForm({ name: "", url: "", secret: "", events: ["payment.completed"] });
      load();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/webhooks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function sendTest(id: string) {
    await fetch(`/api/webhooks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: true }),
    });
    setTimeout(load, 1500);
  }

  async function rotateSecret(s: Sub) {
    if (!window.confirm(`Rotate the signing secret for "${s.name}"?\n\nThe old secret stops working immediately — deliveries retried or replayed from now on are signed with the new one.`)) return;
    setBusyRotate(s.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/webhooks/${s.id}/rotate-secret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error?.message ?? "Rotation failed");
        return;
      }
      setCreatedSecret({ label: `Secret rotated — v${d.data.secretVersion} (shown once)`, secret: d.data.secret });
      setNotice("Update your verifier now. Deliveries from this point are signed with the new secret.");
      load();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusyRotate(null);
    }
  }

  async function openInspect(d: Delivery) {
    setInspectingId(d.id);
    setError(null);
    try {
      const res = await fetch(`/api/webhooks/deliveries/${d.id}`);
      const body = await res.json();
      if (res.ok) setInspect(body.data as DeliveryDetail);
      else setError(body.error?.message ?? "Could not load the delivery record");
    } catch {
      setError("Network error — try again");
    } finally {
      setInspectingId(null);
    }
  }

  async function replay(d: Delivery) {
    if (!window.confirm(`Replay this delivery to "${subName(d.subscriptionId)}"?\n\nIt will be sent again immediately (attempts reset) and re-signed with the endpoint's current secret.`)) return;
    setBusyReplay(d.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/webhooks/deliveries/${d.id}/replay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error?.message ?? "Replay failed");
        return;
      }
      setNotice(`Replay queued for ${d.eventType} — watch the delivery log for the new attempt.`);
      setTimeout(load, 800);
    } catch {
      setError("Network error — try again");
    } finally {
      setBusyReplay(null);
    }
  }

  const subName = (id: string) => subs?.find((s) => s.id === id)?.name ?? id.slice(0, 8);
  const visibleDeliveries = filter === "FAILED" ? deliveries.filter((d) => d.status === "FAILED") : deliveries;
  const failedCount = deliveries.filter((d) => d.status === "FAILED").length;

  return (
    <div>
      <PageHeader
        title="Outbound webhooks"
        subtitle="Deliver payment events to your own systems — signed, retried with backoff, and kept on a dead-letter queue you can inspect and replay."
        actions={<Button onClick={() => setOpen(true)}>+ Subscribe endpoint</Button>}
      />
      {error ? <p className="mb-4 rounded-control border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p> : null}
      {notice ? (
        <p className="mb-4 rounded-control border border-borderline bg-white px-4 py-3 text-sm">⏳ {notice}</p>
      ) : null}

      {createdSecret ? (
        <Card className="mb-6 border-success/40 bg-success/5 p-6">
          <h2 className="font-semibold text-success">{createdSecret.label}</h2>
          <p className="mt-1 text-sm text-muted">
            Use it to verify the x-zfloat-signature header (HMAC-SHA256 of the raw body). The old secret no longer verifies new deliveries.
          </p>
          <div className="mt-3 rounded-control bg-white px-3 py-2 font-mono text-xs break-all">{createdSecret.secret}</div>
          <Button className="mt-3" size="sm" variant="secondary" onClick={() => setCreatedSecret(null)}>Got it</Button>
        </Card>
      ) : null}

      {!subs ? (
        <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <Card className="mb-6 p-6">
          <h2 className="mb-3 font-semibold">Endpoints</h2>
          {subs.length === 0 ? (
            <p className="text-sm text-muted">No endpoints yet — subscribe one to start receiving events.</p>
          ) : (
            <TableShell headers={["Name", "URL", "Events", "Secret", "Status", ""]}>
              {subs.map((s) => (
                <tr key={s.id} className="hover:bg-surface/60">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="max-w-52 truncate px-4 py-3 font-mono text-xs">{s.url}</td>
                  <td className="px-4 py-3 text-xs">{s.events.join(", ")}</td>
                  <td className="px-4 py-3 text-xs text-muted">v{s.secretVersion}</td>
                  <td className="px-4 py-3"><Badge tone={s.status === "ACTIVE" ? "success" : "neutral"}>{s.status}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    <button className="mr-3 text-xs text-primary hover:underline" onClick={() => sendTest(s.id)}>Send test</button>
                    <button className="mr-3 text-xs text-primary hover:underline" onClick={() => void rotateSecret(s)}>
                      {busyRotate === s.id ? "Rotating…" : "Rotate secret"}
                    </button>
                    {s.status === "ACTIVE" ? (
                      <button className="mr-3 text-xs text-muted hover:underline" onClick={() => setStatus(s.id, "DISABLED")}>Disable</button>
                    ) : (
                      <button className="mr-3 text-xs text-primary hover:underline" onClick={() => setStatus(s.id, "ACTIVE")}>Enable</button>
                    )}
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </Card>
      )}

      <Card className="p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Delivery log</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setFilter("ALL")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === "ALL" ? "bg-primary text-white" : "border border-line bg-white text-muted hover:text-ink"}`}
            >
              All ({deliveries.length})
            </button>
            <button
              onClick={() => setFilter("FAILED")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === "FAILED" ? "bg-danger text-white" : "border border-line bg-white text-muted hover:text-danger"}`}
            >
              Failed / DLQ{failedCount > 0 ? ` (${failedCount})` : ""}
            </button>
          </div>
        </div>
        {deliveries.length === 0 ? (
          <p className="text-sm text-muted">No deliveries yet — events appear here as they are sent.</p>
        ) : visibleDeliveries.length === 0 ? (
          <p className="text-sm text-muted">No failed deliveries — the DLQ is empty. 🎉</p>
        ) : (
          <TableShell headers={["Endpoint", "Event", "Status", "Attempts", "HTTP", "Last error", "Sent", ""]}>
            {visibleDeliveries.map((d) => (
              <tr key={d.id} className="hover:bg-surface/60">
                <td className="px-4 py-2.5 text-xs text-muted">{subName(d.subscriptionId)}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{d.eventType}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={d.status === "DELIVERED" ? "success" : d.status === "FAILED" ? "danger" : "warning"}>{d.status}</Badge>
                </td>
                <td className="px-4 py-2.5 text-xs">{d.attempts}</td>
                <td className="px-4 py-2.5 text-xs">{d.responseStatus ?? "—"}</td>
                <td className="max-w-64 truncate px-4 py-2.5 text-xs text-danger" title={d.lastError ?? ""}>{d.lastError ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-muted">{fmt(d.createdAt)}</td>
                <td className="px-4 py-2.5 text-right">
                  <button className="mr-3 text-xs text-primary hover:underline" onClick={() => void openInspect(d)}>
                    {inspectingId === d.id ? "…" : "Inspect"}
                  </button>
                  {d.status === "FAILED" ? (
                    <button className="text-xs text-primary hover:underline" onClick={() => void replay(d)}>
                      {busyReplay === d.id ? "Queuing…" : "Replay"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </Card>

      {/* Delivery record inspector */}
      <Modal open={inspect !== null} onClose={() => setInspect(null)} title="Delivery record">
        {inspect ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-control bg-surface px-3 py-2"><span className="text-muted">Status</span><div><Badge tone={inspect.status === "DELIVERED" ? "success" : inspect.status === "FAILED" ? "danger" : "warning"}>{inspect.status}</Badge></div></div>
              <div className="rounded-control bg-surface px-3 py-2"><span className="text-muted">HTTP</span><div className="font-medium">{inspect.responseStatus ?? "—"}</div></div>
              <div className="rounded-control bg-surface px-3 py-2"><span className="text-muted">Attempts</span><div className="font-medium">{inspect.attempts}</div></div>
              <div className="rounded-control bg-surface px-3 py-2"><span className="text-muted">Event</span><div className="font-mono">{inspect.eventType}</div></div>
            </div>
            <div className="rounded-control bg-surface px-3 py-2 text-xs">
              <span className="text-muted">Sent</span> {fmt(inspect.createdAt)}
              {inspect.nextRetryAt ? <> · next retry {fmt(inspect.nextRetryAt)}</> : null} · <span className="text-muted">updated</span> {fmt(inspect.updatedAt)}
            </div>
            {inspect.lastError ? (
              <div className="rounded-control border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{inspect.lastError}</div>
            ) : null}
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">Payload (as stored)</p>
              <pre className="max-h-56 overflow-auto rounded-control bg-surface p-3 font-mono text-[11px] leading-relaxed">{pretty(inspect.payload)}</pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">Exact bytes sent (signed body)</p>
              <pre className="max-h-40 overflow-auto rounded-control bg-surface p-3 font-mono text-[11px] leading-relaxed">{inspect.payloadBody ?? pretty(inspect.payload)}</pre>
            </div>
            {inspect.signature ? (
              <p className="break-all rounded-control bg-surface px-3 py-2 font-mono text-[11px] text-muted">sig {inspect.signature}</p>
            ) : null}
            {inspect.status === "FAILED" ? (
              <div className="flex justify-end">
                <Button size="sm" onClick={() => { const d = inspect; setInspect(null); void replay(d); }}>Replay this delivery</Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} title="Subscribe an endpoint">
        <form onSubmit={create} className="space-y-4">
          <div>
            <Label htmlFor="wh-name">Name</Label>
            <Input id="wh-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Accounting sync" />
          </div>
          <div>
            <Label htmlFor="wh-url">Endpoint URL</Label>
            <Input id="wh-url" required type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://your-app.example.com/hooks/zfloat" />
          </div>
          <div>
            <Label>Signing secret (optional — generated if blank)</Label>
            <Input value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} placeholder="Leave blank to auto-generate" />
          </div>
          <div>
            <Label>Events</Label>
            <div className="flex flex-wrap gap-2">
              {ALL_EVENTS.map((ev) => (
                <button
                  key={ev}
                  type="button"
                  onClick={() => toggleEvent(ev)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${form.events.includes(ev) ? "border-primary bg-primary/10 text-primary" : "border-borderline text-muted"}`}
                >
                  {ev}
                </button>
              ))}
            </div>
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || form.events.length === 0}>{busy ? <Spinner className="h-4 w-4 text-white" /> : "Subscribe"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
