"use client";

import { useEffect, useState } from "react";
import { TableShell, Badge, Skeleton, Button, Spinner, EmptyState } from "@/components/ui";
import { ReconExceptionPanel } from "@/components/recon-exception-panel";

interface Exception {
  id: string;
  tenantId: string;
  tenantName: string;
  kind: string;
  severity: string;
  status: string;
  resolution: string | null;
  providerReference: string;
  amountMinor: string;
  createdAt: string;
}

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  OPEN: "warning",
  INVESTIGATING: "info",
  RESOLVED: "success",
  ESCALATED: "danger",
};

export default function AdminReconPage() {
  const [rows, setRows] = useState<Exception[] | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function load() {
    fetch("/api/reconciliation?scope=all")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error.message);
          setRows([]);
        } else {
          setRows(d.data ?? []);
        }
      })
      .catch(() => {
        setError("Failed to load exceptions");
        setRows([]);
      });
  }
  useEffect(load, []);

  async function run() {
    setRunning(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/reconciliation/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Run failed");
      setMessage(data.data?.message ?? "Run completed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
      load();
    }
  }

  const selected = rows?.find((x) => x.id === selectedId) ?? null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reconciliation operations</h1>
          <p className="mt-1 text-sm text-muted">
            Exceptions across all tenants — resolve, comment and reopen with a full audit trail.
          </p>
        </div>
        <Button onClick={run} disabled={running}>
          {running ? <Spinner className="h-4 w-4 text-white" /> : "Run reconciliation"}
        </Button>
      </div>
      {message ? (
        <p className="mt-4 rounded-control border border-success/20 bg-success/5 px-4 py-3 text-sm text-success">{message}</p>
      ) : null}
      {error && rows?.length === 0 ? (
        <p className="mt-4 rounded-control border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p>
      ) : null}
      {!rows ? (
        <div className="mt-6 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No exceptions" description="Every tenant's provider records match the ledger." />
        </div>
      ) : (
        <div className="mt-6">
          <TableShell headers={["Tenant", "Provider reference", "Kind", "Severity", "Status", "Raised", ""]}>
            {rows.map((x) => (
              <tr
                key={x.id}
                className={`cursor-pointer hover:bg-surface/60 ${selectedId === x.id ? "bg-surface/70" : ""}`}
                onClick={() => setSelectedId(selectedId === x.id ? null : x.id)}
                data-testid="admin-recon-row"
              >
                <td className="px-4 py-3 text-sm font-medium">{x.tenantName}</td>
                <td className="px-4 py-3 font-mono text-xs">{x.providerReference}</td>
                <td className="px-4 py-3">
                  <Badge tone="danger">{x.kind.replace(/_/g, " ")}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={x.severity === "HIGH" ? "danger" : "warning"}>{x.severity}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={STATUS_TONE[x.status] ?? "neutral"}>{x.status}</Badge>
                </td>
                <td className="px-4 py-3 text-xs text-muted">{new Date(x.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(selectedId === x.id ? null : x.id);
                    }}
                  >
                    {selectedId === x.id ? "Close" : "Manage"}
                  </Button>
                </td>
              </tr>
            ))}
          </TableShell>
          {selected ? (
            <ReconExceptionPanel exceptionId={selected.id} tenantName={selected.tenantName} onMutated={load} />
          ) : null}
        </div>
      )}
    </div>
  );
}
