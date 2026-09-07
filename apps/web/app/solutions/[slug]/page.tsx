import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingHeader, MarketingFooter } from "@/components/brand";
import { Button, Card, Badge } from "@/components/ui";
import { getSiteContent } from "@/lib/site";

export const dynamic = "force-dynamic";

const DEFAULTS: Record<string, { title: string; desc: string; features: string[] }> = {
  "business-payments": {
    title: "Business payments",
    desc: "Send money to any M-Pesa phone, till, paybill or bank account in seconds — with built-in checks, fees quoted upfront and approvals.",
    features: ["Single and bulk send", "Tills, paybills and bank accounts", "Fee preview before you confirm", "Auditable payment history"],
  },
  "corporate-bills": {
    title: "Corporate bills",
    desc: "Pay KPLC, water, internet and hundreds of billers on schedule. No more chasing manual payments at the end of the month.",
    features: ["Biller catalog with account references", "Scheduled recurring bill payments", "Payment confirmation receipts", "Utility spend reporting"],
  },
  "supplier-payments": {
    title: "Supplier & vendor payments",
    desc: "Keep verified supplier accounts, attach invoices and reconcile every payment back to the ledger.",
    features: ["Verified supplier directory", "Invoice references on every payment", "Automatic reconciliation", "Supplier spend reports"],
  },
  payroll: {
    title: "Payroll",
    desc: "Run payroll batches from a spreadsheet. Validate accounts, approve and pay in one flow — every employee gets their own payment record.",
    features: ["CSV/XLSX payroll upload", "Per-employee validation", "Batch approval workflow", "Payroll history by period"],
  },
  "petty-cash": {
    title: "Petty cash & expenses",
    desc: "Give teams spending authority, capture receipts and approve claims — with full visibility into who spent what, when.",
    features: ["Expense claims with approvals", "Record or pay instantly", "Category tagging", "Team spend visibility"],
  },
  "bulk-airtime": {
    title: "Bulk airtime & data",
    desc: "Top up field teams across Safaricom, Airtel and Telkom in bulk, on schedule.",
    features: ["Safaricom / Airtel / Telkom", "Airtime and data bundles", "Bulk phone upload", "Monthly top-up schedules"],
  },
};

export default async function SolutionPage({ params }: { params: { slug: string } }) {
  const def = DEFAULTS[params.slug];
  if (!def) notFound();
  const { settings } = await getSiteContent();
  const solutions = (settings["site.features.solutions"] as Array<{ title: string; desc: string; href: string }> | undefined) ?? [];
  const fromSettings = solutions.find((s) => s.href.endsWith(`/${params.slug}`));
  const title = fromSettings?.title ?? def.title;
  const desc = fromSettings?.desc ?? def.desc;

  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6 lg:px-8">
        <Badge tone="info">Solution</Badge>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">{title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">{desc}</p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {def.features.map((f) => (
            <Card key={f} className="flex items-center gap-3 p-5">
              <span className="text-primary">✓</span>
              <span className="text-sm font-medium">{f}</span>
            </Card>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap gap-3">
          <Link href="/login?register=1"><Button size="lg">Try it in the demo</Button></Link>
          <Link href="/contact"><Button size="lg" variant="secondary">Talk to sales</Button></Link>
        </div>
        <p className="mt-6 text-xs text-muted">
          Demo only — live rails are enabled per merchant after onboarding and provider due diligence.
        </p>
      </section>
      <MarketingFooter />
    </div>
  );
}
