"use client";

import { useEffect, useState } from "react";
import { Card, StatCard, Badge, Skeleton } from "@/components/ui";

interface Overview {
  tenants: number;
  users: number;
  payments: number;
  volumeMinor: string;
  activeFeeRules: number;
  openReconExceptions: number;
  pendingApprovals: number;
  auditEvents: number;
}

export default function AdminOverview() {
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    fetch("/api/admin/overview")
      .then((r) => r.json())
      .then((d) => setData(d.data ?? null))
      .catch(() => setData(null));
  }, []);

  if (!data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Platform overview</h1>
      <p className="mt-1 text-sm text-muted">Everything across every tenant — live from the database.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tenants" value={String(data.tenants)} />
        <StatCard label="Users" value={String(data.users)} />
        <StatCard label="Payments" value={String(data.payments)} />
        <StatCard label="Volume (SUCCESS)" value={`KES ${(BigInt(data.volumeMinor) / 100n).toLocaleString()}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 font-semibold">Needs attention</h2>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center justify-between rounded-control border border-borderline px-4 py-3">
              <span>Open reconciliation exceptions</span>
              <Badge tone={data.openReconExceptions > 0 ? "danger" : "success"}>{data.openReconExceptions}</Badge>
            </li>
            <li className="flex items-center justify-between rounded-control border border-borderline px-4 py-3">
              <span>Pending approval requests</span>
              <Badge tone={data.pendingApprovals > 0 ? "warning" : "success"}>{data.pendingApprovals}</Badge>
            </li>
            <li className="flex items-center justify-between rounded-control border border-borderline px-4 py-3">
              <span>Active fee rules (versioned)</span>
              <Badge tone="neutral">{data.activeFeeRules}</Badge>
            </li>
          </ul>
        </Card>
        <Card className="p-6">
          <h2 className="mb-4 font-semibold">Audit trail</h2>
          <p className="text-3xl font-bold">{data.auditEvents.toLocaleString()}</p>
          <p className="text-sm text-muted">audit events recorded — every admin change is versioned and immutable.</p>
          <p className="mt-4 rounded-control bg-surface p-3 text-xs text-muted">
            Admin actions (pricing edits, flag toggles, tenant changes) always write an audit event with actor, resource
            and before/after payload.
          </p>
        </Card>
      </div>
    </div>
  );
}
