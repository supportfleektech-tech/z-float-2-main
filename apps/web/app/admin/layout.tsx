"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand";
import { Spinner } from "@/components/ui";

const ADMIN_NAV = [
  { label: "Overview", href: "/admin", icon: "▦" },
  { label: "Tenants & merchants", href: "/admin/tenants", icon: "▤" },
  { label: "Pricing & fees", href: "/admin/pricing", icon: "₰" },
  { label: "Providers & routing", href: "/admin/providers", icon: "⇄" },
  { label: "Feature flags", href: "/admin/flags", icon: "⚑" },
  { label: "Catalogs", href: "/admin/catalogs", icon: "▤" },
  { label: "Approval policies", href: "/admin/policies", icon: "☑" },
  { label: "Config approvals", href: "/admin/approvals", icon: "✍" },
  { label: "Reconciliation ops", href: "/admin/reconciliation", icon: "≋" },
  { label: "KYC & AML cases", href: "/admin/kyc", icon: "⚖" },
  { label: "Audit log", href: "/admin/audit", icon: "📋" },
  { label: "System health", href: "/admin/health", icon: "♥" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ fullName: string; email: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    fetch("/api/admin/session", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) {
          setDenied(true);
          setLoading(false);
          return;
        }
        setUser(d.user);
        setLoading(false);
      })
      .catch(() => {
        setDenied(true);
        setLoading(false);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (denied || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink px-4 text-center">
        <div className="max-w-md text-white">
          <h1 className="text-xl font-semibold">
            Platform admin access required
          </h1>
          <p className="mt-2 text-sm text-white/60">
            Sign in with a platform administrator account to continue.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-control bg-white px-5 py-2.5 text-sm font-medium text-ink"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-white/10 bg-ink lg:flex">
        <div className="flex h-16 items-center border-b border-white/10 px-5">
          <Link href="/admin">
            <Logo light />
          </Link>
          <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/70">
            Admin
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-0.5">
            {ADMIN_NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`focus-ring flex items-center gap-3 rounded-control px-3 py-2 text-sm ${
                      active
                        ? "bg-white/10 font-medium text-white"
                        : "text-white/60 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span className="w-4 text-center" aria-hidden="true">
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-white/10 p-4 text-white">
          <p className="text-sm font-medium">{user.fullName}</p>
          <p className="truncate text-xs text-white/50">{user.email}</p>
          <button
            onClick={logout}
            className="mt-2 text-xs font-medium text-white/70 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="flex min-h-screen flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-borderline bg-white/90 px-4 backdrop-blur sm:px-6">
          <p className="text-sm font-semibold">
            Z-float Platform Administration
          </p>
          <span className="rounded-full border border-danger/30 bg-danger/5 px-2.5 py-0.5 text-xs font-medium text-danger">
            Production guardrails active
          </span>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
