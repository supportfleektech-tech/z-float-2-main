"use client";

import { useEffect, useState } from "react";
import { TableShell, Badge, Skeleton } from "@/components/ui";

interface TenantRow {
  id: string;
  name: string;
  status: string;
  userCount: number;
  paymentCount: number;
  volumeMinor: string;
  createdAt: string;
}

export default function AdminTenantsPage() {
  const [rows, setRows] = useState<TenantRow[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/tenants")
      .then((r) => r.json())
      .then((d) => setRows(d.data ?? []))
      .catch(() => setRows([]));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Tenants & merchants</h1>
      <p className="mt-1 text-sm text-muted">Every workspace on the platform, with usage at a glance.</p>
      {!rows ? (
        <div className="mt-6 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <div className="mt-6">
          <TableShell headers={["Tenant", "Status", "Users", "Payments", "Volume (SUCCESS)", "Created"]}>
            {rows.map((t) => (
              <tr key={t.id} className="hover:bg-surface/60">
                <td className="px-4 py-3 font-medium">{t.name}</td>
                <td className="px-4 py-3"><Badge tone={t.status === "ACTIVE" ? "success" : "neutral"}>{t.status}</Badge></td>
                <td className="px-4 py-3">{t.userCount}</td>
                <td className="px-4 py-3">{t.paymentCount}</td>
                <td className="px-4 py-3 font-medium">KES {(BigInt(t.volumeMinor) / 100n).toLocaleString()}</td>
                <td className="px-4 py-3 text-xs text-muted">{new Date(t.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </TableShell>
        </div>
      )}
    </div>
  );
}
