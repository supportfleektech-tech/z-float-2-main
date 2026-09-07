"use client";

import { useEffect, useState } from "react";
import { TableShell, Badge, Skeleton, Button, Spinner } from "@/components/ui";

interface Flag {
  id: string;
  key: string;
  enabled: boolean;
  tenantId: string | null;
  percentage: number;
  description: string | null;
}

export default function AdminFlagsPage() {
  const [rows, setRows] = useState<Flag[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/flags")
      .then((r) => r.json())
      .then((d) => setRows(d.data ?? []))
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  // Maker-checker: the toggle is STAGED (202). A second platform admin must
  // approve it in Config approvals before the flag actually flips.
  async function toggle(f: Flag) {
    setNotice(null);
    setError(null);
    setBusyId(f.id);
    try {
      const res = await fetch("/api/admin/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagId: f.id, enabled: !f.enabled }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error?.message ?? "Toggle failed");
        return;
      }
      const label = (d.data as { label?: string } | undefined)?.label;
      setNotice(`${label ? `${label} — ` : ""}change submitted. A second platform admin must approve it in Config approvals.`);
      load();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Feature flags</h1>
      <p className="mt-1 text-sm text-muted">Toggle platform behaviour without deploying. Changes are staged and audited.</p>
      {notice ? (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>⏳ {notice}</span>
          <button className="text-emerald-600 hover:underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {!rows ? (
        <div className="mt-6 space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <div className="mt-6">
          <TableShell headers={["Flag", "Scope", "Description", "State", ""]}>
            {rows.map((f) => (
              <tr key={f.id} className="hover:bg-surface/60">
                <td className="px-4 py-3 font-mono text-xs">{f.key}</td>
                <td className="px-4 py-3 text-xs text-muted">{f.tenantId ? `tenant ${f.tenantId.slice(0, 8)}` : "platform"}</td>
                <td className="px-4 py-3 text-sm text-muted">{f.description ?? "—"}</td>
                <td className="px-4 py-3"><Badge tone={f.enabled ? "success" : "neutral"}>{f.enabled ? "ON" : "OFF"}</Badge></td>
                <td className="px-4 py-3">
                  <Button size="sm" variant={f.enabled ? "secondary" : "primary"} onClick={() => toggle(f)} disabled={busyId === f.id}>
                    {busyId === f.id ? <Spinner className="h-3.5 w-3.5" /> : f.enabled ? "Disable" : "Enable"}
                  </Button>
                </td>
              </tr>
            ))}
          </TableShell>
        </div>
      )}
    </div>
  );
}
