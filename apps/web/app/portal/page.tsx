"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, StatCard, Button, StatusBadge, Skeleton, PageHeader } from "@/components/ui";

interface Payment {
  id: string;
  paymentNumber: string;
  status: string;
  amountMinor: string;
  beneficiaryName: string;
  createdAt: string;
  product: string;
}

interface DashboardData {
  balance: string;
  pendingApprovals: number;
  todayOutgoing: string;
  failedCount: number;
  scheduledCount: number;
  recent: Payment[];
}

export default function PortalDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    fetch("/api/portal/dashboard")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d?.data ?? null))
      .catch(() => setData(null));
  }, []);

  if (!data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const shortcuts = [
    { label: "Send money", href: "/portal/payments/new", icon: "→" },
    { label: "Upload payments", href: "/portal/payments/bulk", icon: "⇧" },
    { label: "Pay a bill", href: "/portal/bills", icon: "▤" },
    { label: "Add supplier", href: "/portal/suppliers", icon: "⚑" },
    { label: "Run payroll", href: "/portal/payroll", icon: "👥" },
    { label: "Buy airtime", href: "/portal/airtime", icon: "✆" },
  ];

  return (
    <div>
      <PageHeader
        title="Good day 👋"
        subtitle="Here's what's happening across your business today."
        actions={
          <Link href="/portal/payments/new">
            <Button>+ New payment</Button>
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Available balance" value={data.balance} />
        <StatCard label="Pending approvals" value={String(data.pendingApprovals)} tone="warning" />
        <StatCard label="Today's outgoing" value={data.todayOutgoing} />
        <StatCard label="Failed (7 days)" value={String(data.failedCount)} tone="danger" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Recent payments</h2>
            <Link href="/portal/transactions" className="text-sm font-medium text-primary hover:underline">View all</Link>
          </div>
          <div className="space-y-2">
            {data.recent.map((p) => (
              <Link
                key={p.id}
                href={`/portal/transactions/${p.id}`}
                className="flex items-center justify-between rounded-control border border-borderline px-4 py-3 transition hover:border-primary/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.beneficiaryName}</p>
                  <p className="text-xs text-muted">{p.paymentNumber} · {new Date(p.createdAt).toLocaleString()}</p>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-3">
                  <span className="font-medium">KES {formatMinor(p.amountMinor)}</span>
                  <StatusBadge status={p.status} />
                </div>
              </Link>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-4 font-semibold">Quick actions</h2>
            <div className="grid grid-cols-2 gap-3">
              {shortcuts.map((s) => (
                <Link key={s.label} href={s.href} className="focus-ring flex flex-col items-center gap-2 rounded-control border border-borderline p-4 text-center text-xs font-medium hover:border-primary/40">
                  <span className="text-lg" aria-hidden="true">{s.icon}</span>
                  {s.label}
                </Link>
              ))}
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-2 font-semibold">Scheduled payments</h2>
            <p className="text-sm text-muted">{data.scheduledCount} active schedules · next run in 5 days</p>
            <Link href="/portal/schedules" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">Manage schedules</Link>
          </Card>
        </div>
      </div>
    </div>
  );
}

function formatMinor(minor: string): string {
  const n = BigInt(minor);
  const whole = (n / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (n % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}`;
}
