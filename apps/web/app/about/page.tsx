import { MarketingHeader, MarketingFooter } from "@/components/brand";
import { Card, Badge } from "@/components/ui";

const values = [
  { t: "Money moves safely", d: "Immutable ledgers, atomic reservations, verified callbacks — correctness is a feature." },
  { t: "Controls scale", d: "Approval policies that grow with your team: from sole trader to multi-signer enterprise." },
  { t: "Kenya-first", d: "M-Pesa, paybills, tills and Kenyan bank rails are the centre of the product, not an afterthought." },
  { t: "Honest by design", d: "No regulatory claims we can't back up, no hidden fees, no silent reconciliation gaps." },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6 lg:px-8">
        <Badge tone="info">About</Badge>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">We build the operations layer for business payments in Kenya</h1>
        <p className="mt-6 text-lg leading-relaxed text-muted">
          Z-float started from a simple observation: Kenyan businesses move money every day — salaries, suppliers, bills,
          airtime — yet most still juggle spreadsheets, bank apps and approval chats. We build software that turns that
          chaos into a controlled, auditable operation: one ledger, one approval policy, one place to reconcile.
        </p>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          The platform you can explore here is a full demonstration build: sandbox rails, real workflows, real ledgers,
          real security controls. Payment execution in production is performed by regulated partners.
        </p>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {values.map((v) => (
            <Card key={v.t} className="p-6">
              <h2 className="font-semibold">{v.t}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{v.d}</p>
            </Card>
          ))}
        </div>
      </section>
      <MarketingFooter />
    </div>
  );
}
