"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, PageHeader, StatusBadge, Badge, Button, Skeleton, Spinner } from "@/components/ui";
import { formatKESExact as fmt } from "@/lib/money";

interface Detail {
  id: string;
  paymentNumber: string;
  status: string;
  amountMinor: string;
  feeMinor: string;
  totalMinor: string;
  beneficiary: Record<string, unknown>;
  channel: string;
  product: string;
  remark: string | null;
  providerReference: string | null;
  failureReason: string | null;
  reversalReason: string | null;
  createdAt: string;
  history: Array<{ fromStatus: string | null; toStatus: string; reason: string | null; createdAt: string }>;
  attempts: Array<{ attemptNumber: number; status: string; errorMessage: string | null; latencyMs: number | null; createdAt: string }>;
  fee: { feeMinor: string; ruleSnapshot: Record<string, unknown> } | null;
}

export default function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    fetch(`/api/payments/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((x) => setD(x?.data ?? null))
      .catch(() => setError("Failed to load transaction"));
  }

  useEffect(load, [id]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/payments/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      // 202 = accepted for maker-checker sign-off (e.g. reversal request).
      if (res.status === 202) {
        setNotice(data?.data?.message ?? "Request submitted — pending approval by a checker.");
        load();
        return;
      }
      if (!res.ok) throw new Error(data.error?.message ?? "Action failed");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (!d && !error) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (error && !d) {
    return <Card className="p-8 text-danger">{error}</Card>;
  }
  if (!d) return null;

  const beneficiary = d.beneficiary ?? {};
  const feeSnapshot = d.fee?.ruleSnapshot ?? {};

  return (
    <div>
      <PageHeader
        title={d.paymentNumber}
        subtitle={`${d.product.replace(/_/g, " ")} · ${d.channel} · created ${new Date(d.createdAt).toLocaleString()}`}
        actions={<StatusBadge status={d.status} />}
      />

      {error ? (
        <p role="alert" className="mb-4 rounded-control border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p>
      ) : null}
      {notice ? (
        <p role="status" className="mb-4 rounded-control border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">{notice}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <h2 className="mb-4 font-semibold">Summary</h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div><dt className="text-xs uppercase text-muted">Amount</dt><dd className="mt-1 text-2xl font-bold">KES {fmt(d.amountMinor)}</dd></div>
              <div><dt className="text-xs uppercase text-muted">Fee</dt><dd className="mt-1 font-medium">KES {fmt(d.feeMinor)}</dd></div>
              <div><dt className="text-xs uppercase text-muted">Total</dt><dd className="mt-1 font-semibold">KES {fmt(d.totalMinor)}</dd></div>
              <div><dt className="text-xs uppercase text-muted">Provider reference</dt><dd className="mt-1 break-all font-mono text-sm">{d.providerReference ?? "—"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs uppercase text-muted">Beneficiary</dt><dd className="mt-1">{String(beneficiary.name ?? "")} {beneficiary.phone ? `· ${String(beneficiary.phone)}` : ""}</dd></div>
              {d.remark ? <div className="sm:col-span-2"><dt className="text-xs uppercase text-muted">Remark</dt><dd className="mt-1 text-sm">{d.remark}</dd></div> : null}
              {d.failureReason ? <div className="sm:col-span-2"><dt className="text-xs uppercase text-muted">Failure reason</dt><dd className="mt-1 text-sm text-danger">{d.failureReason}</dd></div> : null}
              {d.reversalReason ? <div className="sm:col-span-2"><dt className="text-xs uppercase text-muted">Reversal reason</dt><dd className="mt-1 text-sm text-warning">{d.reversalReason}</dd></div> : null}
            </dl>
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 font-semibold">Timeline</h2>
            <ol className="space-y-0">
              {[...d.history].reverse().map((h, i) => (
                <li key={i} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <span className={`mt-1.5 h-3 w-3 rounded-full ${h.toStatus === "SUCCESS" ? "bg-success" : h.toStatus === "FAILED" || h.toStatus === "REJECTED" ? "bg-danger" : "bg-primary"}`} />
                    {i < d.history.length - 1 ? <span className="w-px flex-1 bg-borderline" /> : null}
                  </div>
                  <div className="pb-5">
                    <p className="text-sm font-medium">{h.toStatus.replace(/_/g, " ")}{h.fromStatus ? <span className="text-muted"> (from {h.fromStatus})</span> : null}</p>
                    <p className="text-xs text-muted">{new Date(h.createdAt).toLocaleString()}{h.reason ? ` — ${h.reason}` : ""}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {d.attempts.length > 0 ? (
            <Card className="p-6">
              <h2 className="mb-4 font-semibold">Provider attempts</h2>
              <div className="space-y-2">
                {d.attempts.map((a) => (
                  <div key={a.attemptNumber} className="flex items-center justify-between rounded-control border border-borderline px-4 py-2.5 text-sm">
                    <span className="font-mono text-xs">Attempt #{a.attemptNumber}</span>
                    <Badge tone={a.status === "SUCCESS" ? "success" : a.status === "FAILED" || a.status === "UNKNOWN" ? "danger" : "info"}>{a.status}</Badge>
                    <span className="text-xs text-muted">{a.latencyMs != null ? `${a.latencyMs}ms` : ""}</span>
                    {a.errorMessage ? <span className="max-w-60 truncate text-xs text-danger">{a.errorMessage}</span> : null}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {d.fee ? (
            <Card className="p-6">
              <h2 className="mb-3 font-semibold">Fee snapshot (immutable)</h2>
              <p className="text-xs text-muted">The exact pricing rule that applied when this payment was created — future pricing changes never rewrite history.</p>
              <pre className="mt-3 max-h-48 overflow-auto rounded-control bg-surface p-3 text-xs">{JSON.stringify(feeSnapshot, null, 2)}</pre>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Actions</h2>
            {d.status === "DRAFT" ? (
              <div className="space-y-2">
                <Button className="w-full" onClick={() => act("submit")} disabled={busy}>{busy ? <Spinner className="h-4 w-4 text-white" /> : "Submit for execution"}</Button>
                <Button className="w-full" variant="secondary" onClick={() => act("cancel")} disabled={busy}>Cancel draft</Button>
              </div>
            ) : null}
            {d.status === "PENDING_APPROVAL" ? (
              <div className="space-y-2">
                <Button className="w-full" variant="success" onClick={() => act("approve", { decision: "approve" })} disabled={busy}>Approve</Button>
                <Button className="w-full" variant="danger" onClick={() => act("approve", { decision: "reject" })} disabled={busy}>Reject</Button>
              </div>
            ) : null}
            {d.status === "SUCCESS" ? (
              <Button className="w-full" variant="danger" onClick={() => act("reverse", { reason: "Requested by customer" })} disabled={busy}>Request reversal</Button>
            ) : null}
            {d.status === "PROVIDER_PENDING" ? (
              <p className="rounded-control bg-warning/10 p-3 text-xs text-warning">
                We have not yet received confirmation from the payment provider. Your payment is being checked.
                Do not submit the same payment again.
              </p>
            ) : null}
          </Card>
          <Card className="p-5 text-xs text-muted">
            <p className="font-medium text-ink">Compliance note</p>
            <p className="mt-1 leading-relaxed">
              No provider response is trusted solely because a request returned successfully. Final states are driven
              by verified callbacks or reconciliation jobs.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

