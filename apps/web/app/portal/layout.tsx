"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand";
import { Spinner } from "@/components/ui";
import NotificationBell from "@/components/notification-bell";

const NAV = [
  {
    section: "Overview",
    items: [{ label: "Dashboard", href: "/portal", icon: "▦" }],
  },
  {
    section: "Payments",
    items: [
      { label: "Initiate payment", href: "/portal/payments/new", icon: "→" },
      { label: "Bulk upload", href: "/portal/payments/bulk", icon: "⇧" },
      { label: "Payment links", href: "/portal/payment-links", icon: "🔗" },
      { label: "Saved recipients", href: "/portal/recipients", icon: "☰" },
      { label: "Scheduled payments", href: "/portal/schedules", icon: "◷" },
    ],
  },
  {
    section: "Business",
    items: [
      { label: "Bills", href: "/portal/bills", icon: "▤" },
      { label: "Suppliers", href: "/portal/suppliers", icon: "⚑" },
      { label: "Payroll", href: "/portal/payroll", icon: "👥" },
      { label: "Airtime & data", href: "/portal/airtime", icon: "✆" },
      { label: "Expenses", href: "/portal/expenses", icon: "₰" },
    ],
  },
  {
    section: "Operations",
    items: [
      { label: "Approvals", href: "/portal/approvals", icon: "✓", badge: true },
      { label: "Transactions", href: "/portal/transactions", icon: "≡" },
      { label: "Reconciliation", href: "/portal/reconciliation", icon: "≋" },
      { label: "Webhooks", href: "/portal/webhooks", icon: "⇄" },
      { label: "Message center", href: "/portal/messages", icon: "✉" },
      { label: "Developer API", href: "/portal/developers", icon: "</>" },
      { label: "Compliance & KYC", href: "/portal/compliance", icon: "🛡" },
      { label: "Reports", href: "/portal/reports", icon: "▤" },
    ],
  },
  {
    section: "Administration",
    items: [
      { label: "Accounts & wallets", href: "/portal/accounts", icon: "◈" },
      { label: "Team & roles", href: "/portal/team", icon: "☺" },
      { label: "Settings", href: "/portal/settings", icon: "⚙" },
      { label: "Support", href: "/portal/support", icon: "?" },
    ],
  },
];

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{
    fullName: string;
    email: string;
    tenantId: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    fetch("/api/auth/me", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setUser(d?.user ?? null);
        setLoading(false);
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, []);

  // If the session is missing (expired / cookie not persisted), send to login.
  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, pathname, router]);

  // Live pending-approval count for the sidebar badge (no hardcoded demo value).
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/approvals?status=PENDING&limit=1`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const items = d?.data ?? d?.approvals ?? [];
        setPendingCount(Array.isArray(items) ? items.length : 0);
      })
      .catch(() => setPendingCount(0));
    return () => ctrl.abort();
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-borderline bg-white lg:flex">
        <div className="flex h-16 items-center border-b border-borderline px-5">
          <Link href="/portal">
            <Logo />
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Portal">
          {NAV.map((group) => (
            <div key={group.section} className="mb-5">
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-widest text-muted">
                {group.section}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`focus-ring flex items-center gap-3 rounded-control px-3 py-2 text-sm ${
                          active
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-ink/80 hover:bg-surface"
                        }`}
                      >
                        <span
                          className="w-4 text-center text-muted"
                          aria-hidden="true"
                        >
                          {item.icon}
                        </span>
                        <span className="flex-1">{item.label}</span>
                        {item.badge && pendingCount > 0 ? (
                          <span className="rounded-full bg-warning px-2 py-0.5 text-[10px] font-bold text-white">
                            {pendingCount}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-borderline p-4">
          <p className="text-sm font-medium">{user?.fullName ?? "User"}</p>
          <p className="truncate text-xs text-muted">{user?.email}</p>
          <button
            onClick={logout}
            className="focus-ring mt-2 text-xs font-medium text-danger hover:underline"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-h-screen flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-borderline bg-white/90 px-4 backdrop-blur sm:px-6">
          <p className="text-sm font-medium">
            Acme Traders Ltd — Main Operating Wallet
          </p>
          <div className="flex items-center gap-3 text-xs text-muted">
            <NotificationBell />
            <span className="hidden sm:inline">Sandbox mode</span>
            <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 font-medium text-success">
              ● Live demo
            </span>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
