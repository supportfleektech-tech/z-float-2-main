import { MarketingHeader, MarketingFooter } from "@/components/brand";
import { Card, Badge } from "@/components/ui";
import { getSiteContent } from "@/lib/site";

export const dynamic = "force-dynamic";

const DEFAULT_FAQ = [
  { q: "How do I fund my wallet?", a: "Top up through your bank (EFT or RTGS) or via M-Pesa. Funds are journaled to your wallet instantly." },
  { q: "What does a payment cost?", a: "A flat platform fee per successful payment, quoted before you confirm. Partner rail charges pass through at cost." },
  { q: "Can I run bulk payments?", a: "Yes — CSV/XLSX upload with server-side validation, row-level errors and batch approvals." },
  { q: "Is my money safe?", a: "Money sits in regulated partner accounts; Z-float keeps an immutable double-entry ledger and never mixes client funds." },
  { q: "What rails are supported?", a: "Sandbox demonstration of M-Pesa (Daraja-style), paybill, till and bank flows. Live rails are enabled per merchant." },
];

export default async function FaqPage() {
  const { settings } = await getSiteContent();
  const faqs = (settings["site.faq.items"] as Array<{ q: string; a: string }> | undefined) ?? DEFAULT_FAQ;

  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="text-center">
          <Badge tone="info">FAQ</Badge>
          <h1 className="mt-4 text-4xl font-bold tracking-tight">Frequently asked questions</h1>
        </div>
        <div className="mt-12 space-y-4">
          {faqs.map((f) => (
            <Card key={f.q} className="p-6">
              <h2 className="font-semibold">{f.q}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p>
            </Card>
          ))}
        </div>
      </section>
      <MarketingFooter />
    </div>
  );
}
