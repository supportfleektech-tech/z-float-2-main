"use client";

import { useEffect, useState } from "react";
import { TableShell, Badge, Skeleton } from "@/components/ui";

interface Provider {
  id: string;
  code: string;
  name: string;
  kind: string;
  enabled: boolean;
  priority: number | null;
  createdAt: string;
}

export default function AdminProvidersPage() {
  const [rows, setRows] = useState<Provider[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/providers")
      .then((r) => r.json())
      .then((d) => setRows(d.data ?? []))
      .catch(() => setRows([]));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Providers & routing</h1>
      <p className="mt-1 text-sm text-muted">Rails behind the adapter layer. All execution goes through the provider registry.</p>
      {!rows ? (
        <div className="mt-6 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <div className="mt-6">
          <TableShell headers={["Code", "Name", "Kind", "Priority", "State"]}>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-surface/60">
                <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 text-xs uppercase text-muted">{p.kind}</td>
                <td className="px-4 py-3">{p.priority ?? "—"}</td>
                <td className="px-4 py-3"><Badge tone={p.enabled ? "success" : "neutral"}>{p.enabled ? "ENABLED" : "DISABLED"}</Badge></td>
              </tr>
            ))}
          </TableShell>
        </div>
      )}
    </div>
  );
}
