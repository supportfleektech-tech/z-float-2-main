import Link from "next/link";
import { MarketingHeader, MarketingFooter } from "@/components/brand";
import { Card } from "@/components/ui";
import { getSiteContent } from "@/lib/site";

export const dynamic = "force-dynamic";

interface Solution {
  title: string;
  desc: string;
  href: string;
}

const DEFAULT_SOLUTIONS: Solution[] = [
  { title: "Business payments", desc: "Send money to any M-Pesa phone, till, paybill or bank account in seconds — with checks and approvals.", href: "/solutions/business-payments" },
  { title: "Corporate bills", desc: "Pay KPLC, water, internet and hundreds of billers on schedule.", href: "/solutions/corporate-bills" },
  { title: "Supplier & vendor payments", desc: "Verified supplier accounts, invoices attached, fully reconciled.", href: "/solutions/supplier-payments" },
  { title: "Payroll", desc: "Run payroll batches from a spreadsheet with validation and approvals.", href: "/solutions/payroll" },
  { title: "Petty cash & expenses", desc: "Team spending authority with receipts and approvals.", href: "/solutions/petty-cash" },
  { title: "Bulk airtime & data", desc: "Top up field teams across Safaricom, Airtel and Telkom.", href: "/solutions/bulk-airtime" },
];

export default async function SolutionsPage() {
  const { settings } = await getSiteContent();
  const solutions = (settings["site.features.solutions"] as Solution[] | undefined) ?? DEFAULT_SOLUTIONS;

  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Solutions for every payment</h1>
          <p className="mt-4 text-lg text-muted">Pick a workflow below — each one shares the same controls, ledger and audit trail.</p>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {solutions.map((s) => (
            <Link key={s.href} href={s.href} className="group">
              <Card className="h-full p-6 transition hover:border-primary/40 hover:shadow-md">
                <h2 className="text-lg font-semibold group-hover:text-primary">{s.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.desc}</p>
                <p className="mt-4 text-sm font-medium text-primary">Learn more →</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>
      <MarketingFooter />
    </div>
  );
}
