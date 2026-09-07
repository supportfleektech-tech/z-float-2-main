import Link from "next/link";
import { Button } from "@/components/ui";

/** Z-float logo mark — original brand, rendered inline (no external assets). */
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill={light ? "#FFFFFF" : "#0F5BFF"} />
        <path d="M9 22V10l9 8 5-8v12" stroke={light ? "#0F5BFF" : "#FFFFFF"} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <span className={`text-lg font-bold tracking-tight ${light ? "text-white" : "text-ink"}`}>
        Z-<span className={light ? "text-white" : "text-primary"}>float</span>
      </span>
    </span>
  );
}

const NAV = [
  { label: "Solutions", href: "/solutions" },
  { label: "Pricing", href: "/pricing" },
  { label: "Resources", href: "/resources" },
  { label: "Security", href: "/security" },
  { label: "Contact", href: "/contact" },
];

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-borderline bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="focus-ring rounded">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="focus-ring rounded text-sm font-medium text-muted hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="focus-ring rounded px-3 py-2 text-sm font-medium text-ink hover:text-primary">
            Login
          </Link>
          <Link href="/login?register=1">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-borderline bg-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4 lg:px-8">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-muted">
            Kenya-first business payment operations: disbursements, bills, payroll, suppliers and approvals — one platform.
          </p>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold">Product</p>
          <ul className="space-y-2 text-sm text-muted">
            <li><Link className="hover:text-ink" href="/solutions/business-payments">Business payments</Link></li>
            <li><Link className="hover:text-ink" href="/solutions/corporate-bills">Corporate bills</Link></li>
            <li><Link className="hover:text-ink" href="/solutions/supplier-payments">Supplier payments</Link></li>
            <li><Link className="hover:text-ink" href="/solutions/payroll">Payroll</Link></li>
            <li><Link className="hover:text-ink" href="/solutions/petty-cash">Petty cash</Link></li>
            <li><Link className="hover:text-ink" href="/solutions/bulk-airtime">Bulk airtime</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold">Company</p>
          <ul className="space-y-2 text-sm text-muted">
            <li><Link className="hover:text-ink" href="/about">About</Link></li>
            <li><Link className="hover:text-ink" href="/faq">FAQ</Link></li>
            <li><Link className="hover:text-ink" href="/resources">Blog & resources</Link></li>
            <li><Link className="hover:text-ink" href="/contact">Contact</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold">Legal</p>
          <ul className="space-y-2 text-sm text-muted">
            <li><Link className="hover:text-ink" href="/security">Security</Link></li>
            <li><Link className="hover:text-ink" href="/privacy">Privacy policy</Link></li>
            <li><Link className="hover:text-ink" href="/terms">Terms of service</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-borderline py-5 text-center text-xs text-muted">
        © {new Date().getFullYear()} Z-float. Software platform demo — Z-float is not a licensed payment service provider. Payment execution is performed by regulated partners.
      </div>
    </footer>
  );
}
