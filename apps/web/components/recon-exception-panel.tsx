"use client";
/** Recon exception workflow panel — shared by the portal (tenant) and admin
 * (cross-tenant) reconciliation pages. Shows exception context, append-only
 * activity history and the resolve/reopen/comment actions, each audited.
 * Fetches /api/reconciliation/exceptions/[id] which resolves actor names. */
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Label, Skeleton, Spinner, Textarea } from "@/components/ui";
import { formatKES } from "@/lib/money";

interface ActivityActor {
  id: string;
  name: string;
  email: string;
}

interface ActivityItem {
  id: string;
  action: "resolve" | "reopen" | "comment";
  note: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
  actor: ActivityActor | null;
}

interface Detail {
  id: string;
  tenantId: string;
  kind: string;
  severity: string;
  status: string;
  resolution: string | null;
  resolvedAt: string | null;
  providerReference: string | null;
  amountMinor: string | null;
  occurredAt: string | null;
  paymentProviderReference: string | null;
  createdAt: string;
  activity: ActivityItem[];
}

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  OPEN: "warning",
  INVESTIGATING: "info",
  RESOLVED: "success",
  ESCALATED: "danger",
};

const ACTION_LABEL: Record<string, string> = {
  resolve: "Resolved",
  reopen: "Reopened",
  comment: "Comment",
};

function kes(amountMinor: string | null): string {
  if (amountMinor === null) return "—";
  return formatKES(amountMinor);
}

export function ReconExceptionPanel({
  exceptionId,
  tenantName,
  onMutated,
}: {
  exceptionId: string;
  tenantName?: string;
  onMutated: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    setError(null);
    fetch(`/api/reconciliation/exceptions/${exceptionId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error.message);
        else setDetail(d.data);
      })
      .catch(() => setError("Failed to load exception details"));
  }, [exceptionId]);

  useEffect(load, [load]);

  async function act(action: "resolve" | "reopen" | "comment") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reconciliation/exceptions/${exceptionId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error?.message ?? "Action failed");
        return;
      }
      setNote("");
      // Refetch the enriched detail (actor names resolved server-side) so the
      // history stays complete and human-readable after every action.
      load();
      onMutated();
      return;
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) {
    return (
      <Card className="mt-4 border-danger/30 p-6">
        <p className="text-sm text-danger">{error}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={load}>
          Retry
        </Button>
      </Card>
    );
  }
  if (!detail) {
    return (
      <Card className="mt-4 p-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="mt-3 h-4 w-2/3" />
        <Skeleton className="mt-2 h-4 w-1/2" />
      </Card>
    );
  }

  const isResolved = detail.status === "RESOLVED";
  const canResolve = !isResolved;

  return (
    <Card className="mt-4 overflow-hidden" data-testid="recon-exception-panel">
      <div className="border-b border-borderline px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="danger">{detail.kind.replace(/_/g, " ")}</Badge>
          <Badge tone={detail.severity === "HIGH" ? "danger" : "warning"}>{detail.severity}</Badge>
          <Badge tone={STATUS_TONE[detail.status] ?? "neutral"}>{detail.status}</Badge>
          {tenantName ? <span className="text-xs text-muted">Tenant: {tenantName}</span> : null}
          <span className="ml-auto font-mono text-xs text-muted">{detail.id.slice(0, 8)}</span>
        </div>
        <div className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted">Provider reference</span>{" "}
            <span className="font-mono">{detail.providerReference ?? "—"}</span>
          </p>
          <p>
            <span className="text-muted">Statement amount</span>{" "}
            <span className="font-medium">{kes(detail.amountMinor)}</span>
          </p>
          <p>
            <span className="text-muted">Payment reference</span>{" "}
            <span className="font-mono">{detail.paymentProviderReference ?? "—"}</span>
          </p>
          <p>
            <span className="text-muted">Raised</span>{" "}
            {detail.createdAt ? new Date(detail.createdAt).toLocaleString() : "—"}
          </p>
        </div>
        {detail.resolution ? (
          <div className="mt-3 rounded-control bg-success/10 px-3 py-2 text-sm">
            <span className="font-medium text-success">Resolution:</span> {detail.resolution}
            {detail.resolvedAt ? <span className="text-xs text-muted"> · {new Date(detail.resolvedAt).toLocaleString()}</span> : null}
          </div>
        ) : null}
      </div>

      {/* Actions */}
      <div className="border-b border-borderline px-6 py-4">
        <Label htmlFor={`recon-note-${detail.id}`}>
          {isResolved ? "Reopen note (optional)" : canResolve ? "Resolution note (required to resolve)" : "Note"}
        </Label>
        <Textarea
          id={`recon-note-${detail.id}`}
          rows={2}
          className="mt-1 text-sm"
          placeholder={isResolved ? "Why is this back on the desk?" : "What did you check, and what was the outcome?"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canResolve ? (
            <Button onClick={() => act("resolve")} disabled={busy || note.trim().length === 0}>
              {busy ? <Spinner className="h-4 w-4 text-white" /> : "Resolve exception"}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => act("reopen")} disabled={busy}>
              {busy ? <Spinner className="h-4 w-4" /> : "Reopen"}
            </Button>
          )}
          <Button variant="secondary" onClick={() => act("comment")} disabled={busy || note.trim().length === 0}>
            {busy ? <Spinner className="h-4 w-4" /> : "Add comment"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          {isResolved
            ? "Resolved exceptions can be reopened; every action is recorded in the audit trail."
            : "Resolving requires a note explaining the outcome; comments never change status."}
        </p>
      </div>

      {/* History */}
      <div className="px-6 py-4">
        <h3 className="mb-3 text-sm font-semibold">Activity history</h3>
        {detail.activity.length === 0 ? (
          <p className="text-sm text-muted">No activity yet — raised by the reconciliation engine.</p>
        ) : (
          <ul className="space-y-3">
            {detail.activity.map((a) => (
              <li key={a.id} className="flex gap-3 text-sm">
                <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
                <div className="min-w-0">
                  <p>
                    <Badge tone={a.action === "comment" ? "neutral" : a.action === "resolve" ? "success" : "warning"}>
                      {ACTION_LABEL[a.action]}
                    </Badge>
                    {a.fromStatus && a.toStatus ? (
                      <span className="ml-2 font-mono text-xs text-muted">
                        {a.fromStatus} → {a.toStatus}
                      </span>
                    ) : null}
                    <span className="ml-2 text-xs text-muted">
                      {a.actor ? `${a.actor.name} (${a.actor.email})` : "System"} · {new Date(a.createdAt).toLocaleString()}
                    </span>
                  </p>
                  {a.note ? <p className="mt-1 text-ink/90">{a.note}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
