"use client";

import { useEffect, useState } from "react";
import { PageHeader, Button, TableShell, StatusBadge, Badge, Skeleton, EmptyState, Spinner } from "@/components/ui";
import { formatKESExact } from "@/lib/money";

interface ApprovalRow {
  id: string;
  status: string;
  mode: string;
  currentLevel: number;
  requiredApprovals: number;
  createdAt: string;
  kind: "payment" | "batch" | "beneficiary" | "reversal" | "invite";
  title: string;
  detail: string;
  amountMinor: string | null;
  refStatus: string | null;
  resourceType: string | null;
  resourceId: string | null;
}

const KIND_LABEL: Record<ApprovalRow["kind"], { label: string; tone: "success" | "info" | "warning" | "danger" | "neutral" }> = {
  payment: { label: "Payment", tone: "success" },
  batch: { label: "Batch", tone: "info" },
  beneficiary: { label: "Payee", tone: "warning" },
  reversal: { label: "Reversal", tone: "danger" },
  invite: { label: "Role grant", tone: "neutral" },
};

function fmt(minor: string | null): string {
  if (!minor) return "—";
  return formatKESExact(minor);
}

export default function ApprovalsPage() {
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/approvals?status=PENDING")
      .then((r) => r.json())
      .then((d) => setRows(d.data ?? []))
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  async function act(requestId: string, decision: "approve" | "reject") {
    setBusyId(requestId);
    setError(null);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Action failed");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Approval center"
        subtitle="Review and act on payments, payees, reversals and role grants that need your sign-off. The requester can never approve their own request."
      />
      {error ? (
        <p role="alert" className="mb-4 rounded-control border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {!rows ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing pending" description="All approval requests have been resolved. Nice work!" />
      ) : (
        <TableShell headers={["Request", "Detail", "Amount", "Level", "Created", "Status", "Actions"]}>
          {rows.map((r) => {
            const kind = KIND_LABEL[r.kind] ?? KIND_LABEL.payment;
            return (
              <tr key={r.id} className="hover:bg-surface/60">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Badge tone={kind.tone}>{kind.label}</Badge>
                    <span className="font-medium">{r.title}</span>
                  </div>
                </td>
                <td className="max-w-56 truncate px-4 py-3 text-sm text-muted">{r.detail || "—"}</td>
                <td className="px-4 py-3 font-medium">
                  {r.kind === "payment" || r.kind === "batch" || r.kind === "reversal"
                    ? `KES ${fmt(r.amountMinor)}`
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge tone="info">
                    Level {r.currentLevel} of {r.requiredApprovals}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-xs text-muted">{new Date(r.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button size="sm" variant="success" onClick={() => act(r.id, "approve")} disabled={busyId === r.id}>
                      {busyId === r.id ? <Spinner className="h-3.5 w-3.5 text-white" /> : "Approve"}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => act(r.id, "reject")} disabled={busyId === r.id}>
                      Reject
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </TableShell>
      )}
    </div>
  );
}
