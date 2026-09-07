import Link from "next/link";
import { MarketingHeader, MarketingFooter } from "@/components/brand";
import { Button, Card, Badge } from "@/components/ui";

const products = [
  {
    title: "Business payments",
    desc: "Send money to any M-Pesa phone, till, paybill or bank account in seconds — with built-in checks and approvals.",
    href: "/solutions/business-payments",
  },
  {
    title: "Corporate bills",
    desc: "Pay KPLC, water, internet and hundreds of billers on schedule. No more chasing manual payments.",
    href: "/solutions/corporate-bills",
  },
  {
    title: "Supplier & vendor payments",
    desc: "Keep verified supplier accounts, attach invoices and reconcile every payment back to the ledger.",
    href: "/solutions/supplier-payments",
  },
  {
    title: "Payroll",
    desc: "Run payroll batches from a spreadsheet. Validate accounts, approve and pay in one flow.",
    href: "/solutions/payroll",
  },
  {
    title: "Petty cash & expenses",
    desc: "Give teams spending authority, capture receipts and approve claims — with full visibility.",
    href: "/solutions/petty-cash",
  },
  {
    title: "Bulk airtime & data",
    desc: "Top up field teams across Safaricom, Airtel and Telkom in bulk, on schedule.",
    href: "/solutions/bulk-airtime",
  },
];

const steps = [
  { n: "01", t: "Fund your wallet", d: "Top up your operational balance through your bank or M-Pesa." },
  { n: "02", t: "Create a payment", d: "Single, bulk, bill, payroll or airtime — with invoices attached." },
  { n: "03", t: "Route through approvals", d: "Configurable policies decide who must review what amount." },
  { n: "04", t: "We execute & reconcile", d: "Payments run through verified rails; every cent is journaled and matched." },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:px-8 lg:py-28">
          <div>
            <Badge tone="info">Kenya-first business payments</Badge>
            <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              Business payments, <span className="text-primary">controlled</span> from one place.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              Disbursements, corporate bills, payroll, supplier payments and bulk airtime — with approvals,
              a full ledger and reconciliation built in. Made for Kenyan businesses.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login?register=1">
                <Button size="lg">Get started</Button>
              </Link>
              <Link href="/solutions">
                <Button size="lg" variant="secondary">Explore solutions</Button>
              </Link>
            </div>
            <div className="mt-10 grid grid-cols-3 gap-6 border-t border-borderline pt-8">
              <div>
                <p className="text-2xl font-bold">100%</p>
                <p className="text-sm text-muted">Journaled transactions</p>
              </div>
              <div>
                <p className="text-2xl font-bold">12h</p>
                <p className="text-sm text-muted">Session security window</p>
              </div>
              <div>
                <p className="text-2xl font-bold">50k</p>
                <p className="text-sm text-muted">Rows per bulk batch</p>
              </div>
            </div>
          </div>
          <div className="relative">
            <Card className="p-6 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-semibold">Acme Traders Ltd — Main Wallet</p>
                <Badge tone="success">Active</Badge>
              </div>
              <p className="text-3xl font-bold tracking-tight">KES 2,450,000.00</p>
              <p className="text-xs text-muted">Available balance · updated just now</p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {[
                  ["Pending approvals", "5", "warning"],
                  ["Today's outgoing", "KES 148,200", ""],
                  ["Succeeded", "30", "success"],
                  ["Failed", "5", "danger"],
                ].map(([label, value, tone]) => (
                  <div key={label} className="rounded-control border border-borderline p-3">
                    <p className="text-xs text-muted">{label}</p>
                    <p className={`mt-1 font-semibold ${tone ? (tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-success") : ""}`}>{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6 space-y-2">
                {[
                  ["Transfer to supplier", "KES 45,000.00", "Success"],
                  ["KPLC bill payment", "KES 8,420.00", "Awaiting approval"],
                  ["Payroll batch — 12 staff", "KES 486,000.00", "Processing"],
                ].map(([name, amount, status]) => (
                  <div key={name} className="flex items-center justify-between rounded-control bg-surface px-3 py-2.5 text-sm">
                    <span className="truncate">{name}</span>
                    <span className="ml-3 flex shrink-0 items-center gap-2">
                      <span className="font-medium">{amount}</span>
                      <Badge tone={status === "Success" ? "success" : status === "Processing" ? "info" : "warning"}>{status}</Badge>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-y border-borderline bg-surface py-8">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <p className="text-xs uppercase tracking-widest text-muted">
            Built for Kenyan payment rails · M-Pesa via Daraja · banks & PSPs · regulated partners execute payments
          </p>
        </div>
      </section>

      {/* Products */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Everything your finance team does daily</h2>
          <p className="mt-4 text-lg text-muted">One platform for every payment your business makes — with controls that scale from SME to enterprise.</p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <Link key={p.title} href={p.href} className="group">
              <Card className="h-full p-6 transition hover:border-primary/40 hover:shadow-md">
                <h3 className="text-lg font-semibold group-hover:text-primary">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{p.desc}</p>
                <p className="mt-4 text-sm font-medium text-primary">Learn more →</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-ink py-20 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">How it works</h2>
          <div className="mt-12 grid gap-10 md:grid-cols-4">
            {steps.map((s) => (
              <div key={s.n}>
                <p className="text-sm font-bold text-primary">STEP {s.n}</p>
                <h3 className="mt-2 text-lg font-semibold">{s.t}</h3>
                <p className="mt-2 text-sm text-white/60">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 py-20 text-center sm:px-6 lg:px-8">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Ready to take control of business payments?</h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted">Join the demo workspace and see a live payment lifecycle — sandbox rails, real workflows.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/login">
            <Button size="lg">Open the demo</Button>
          </Link>
          <Link href="/contact">
            <Button size="lg" variant="secondary">Talk to us</Button>
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
