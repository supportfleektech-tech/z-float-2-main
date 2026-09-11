"use client";
import { useEffect, useState } from "react";
import {
  PageHeader,
  Button,
  Label,
  TableShell,
  Badge,
  Skeleton,
  EmptyState,
  Spinner,
  Card,
  Textarea,
} from "@/components/ui";
import { formatKES } from "@/lib/money";
import { ReconExceptionPanel } from "@/components/recon-exception-panel";

interface Exception {
  id: string;
  kind: string;
  severity: string;
  status: string;
  providerReference: string;
  amountMinor: string;
  createdAt: string;
}

interface ImportResult {
  runId: string;
  rowsImported: number;
  matched: number;
  unmatched: number;
  partial: number;
  exceptions: number;
  skipped: number;
  csvRows: number;
}

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  OPEN: "warning",
  INVESTIGATING: "info",
  RESOLVED: "success",
  ESCALATED: "danger",
};

export default function ReconciliationPage() {
  const [items, setItems] = useState<Exception[] | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [importCsv, setImportCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function load() {
    fetch("/api/reconciliation")
      .then((r) => r.json())
      .then((d) => setItems(d.data ?? []))
      .catch(() => setItems([]));
  }
  useEffect(load, []);

  async function run() {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/reconciliation/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Run failed");
      setMessage(data.data?.message ?? "Reconciliation run completed");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
      load();
    }
  }

  async function importStatement(e: React.FormEvent) {
    e.preventDefault();
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await fetch("/api/reconciliation/statement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: importCsv }),
      });
      const d = await res.json();
      if (!res.ok) {
        setImportError(d.error?.message ?? "Import failed");
        return;
      }
      setImportResult(d.data);
      setImportCsv("");
      load();
    } catch {
      setImportError("Network error — try again");
    } finally {
      setImporting(false);
    }
  }

  const selected = items?.find((x) => x.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="Reconciliation"
        subtitle="Provider records matched against the Z-float ledger — mismatches surface here, never silently."
        actions={
          <Button onClick={run} disabled={running}>
            {running ? <Spinner className="h-4 w-4 text-white" /> : "Run reconciliation"}
          </Button>
        }
      />
      {message ? (
        <p className="mb-4 rounded-control border border-success/20 bg-success/5 px-4 py-3 text-sm text-success">{message}</p>
      ) : null}

      <Card className="mb-6 p-6">
        <h2 className="mb-1 font-semibold">Import provider statement (CSV)</h2>
        <p className="mb-3 text-xs text-muted">
          Columns: <code>provider_reference</code>, <code>amount</code> (KES), <code>date</code>. Rows are matched against
          payments by provider reference + amount; unmatched rows become exceptions.
        </p>
        <form onSubmit={importStatement} className="space-y-3">
          <Label htmlFor="recon-csv">Statement CSV</Label>
          <Textarea
            id="recon-csv"
            rows={4}
            required
            className="font-mono text-xs"
            placeholder={"provider_reference,amount,date\nMOCK-ZF-ZF-2026-B926-8F2F64,12345,2026-09-01\nUNKNOWN-REF-99,5000,2026-09-01"}
            value={importCsv}
            onChange={(e) => setImportCsv(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <Button type="submit" variant="secondary" disabled={importing}>
              {importing ? <Spinner className="h-4 w-4 text-white" /> : "Import & match"}
            </Button>
            {importError ? <p className="text-sm text-danger">{importError}</p> : null}
          </div>
        </form>
        {importResult ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-control bg-surface p-3 text-center">
              <p className="text-2xl font-bold">{importResult.rowsImported}</p>
              <p className="text-xs text-muted">Matched</p>
            </div>
            <div className="rounded-control bg-surface p-3 text-center">
              <p className="text-2xl font-bold text-warning">{importResult.partial}</p>
              <p className="text-xs text-muted">Amount mismatch</p>
            </div>
            <div className="rounded-control bg-surface p-3 text-center">
              <p className="text-2xl font-bold text-danger">{importResult.unmatched}</p>
              <p className="text-xs text-muted">Unmatched</p>
            </div>
            <div className="rounded-control bg-surface p-3 text-center">
              <p className="text-2xl font-bold">{importResult.csvRows}</p>
              <p className="text-xs text-muted">CSV rows</p>
            </div>
          </div>
        ) : null}
      </Card>

      {!items ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No exceptions" description="Provider records and the ledger are in perfect agreement." />
      ) : (
        <div>
          <TableShell headers={["Provider reference", "Kind", "Amount", "Severity", "Status", "Raised", ""]}>
            {items.map((x) => (
              <tr
                key={x.id}
                className={`cursor-pointer hover:bg-surface/60 ${selectedId === x.id ? "bg-surface/70" : ""}`}
                onClick={() => setSelectedId(selectedId === x.id ? null : x.id)}
                data-testid={`recon-row-${x.kind}`}
              >
                <td className="px-4 py-3 font-mono text-xs">{x.providerReference}</td>
                <td className="px-4 py-3">
                  <Badge tone="danger">{x.kind.replace(/_/g, " ")}</Badge>
                </td>
                <td className="px-4 py-3 font-medium">{formatKES(x.amountMinor)}</td>
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
                    {selectedId === x.id ? "Close" : "Review"}
                  </Button>
                </td>
              </tr>
            ))}
          </TableShell>
          {selected ? <ReconExceptionPanel exceptionId={selected.id} onMutated={load} /> : null}
        </div>
      )}
    </div>
  );
}
