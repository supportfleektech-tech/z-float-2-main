import { MarketingHeader, MarketingFooter } from "@/components/brand";
import { Card, Badge } from "@/components/ui";

const posts = [
  { title: "How approval workflows keep payments safe", excerpt: "Why a configurable approval policy matters and how Z-float enforces it server-side.", date: "2026-08-12", tag: "Operations" },
  { title: "Bulk payments done right: validation before execution", excerpt: "Row-level validation, duplicate detection and chunked execution for CSV payroll runs.", date: "2026-07-30", tag: "Guides" },
  { title: "What reconciliation actually catches", excerpt: "Provider statements vs your ledger — and why mismatches should surface loudly.", date: "2026-07-08", tag: "Engineering" },
];

export default function ResourcesPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6 lg:px-8">
        <Badge tone="info">Resources</Badge>
        <h1 className="mt-4 text-4xl font-bold tracking-tight">Blog & resources</h1>
        <p className="mt-3 text-muted">Guides and deep dives on payment operations for Kenyan businesses.</p>
        <div className="mt-10 space-y-5">
          {posts.map((p) => (
            <Card key={p.title} className="p-6">
              <div className="flex items-center gap-3 text-xs text-muted">
                <Badge tone="neutral">{p.tag}</Badge>
                <span>{new Date(p.date).toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" })}</span>
              </div>
              <h2 className="mt-2 text-lg font-semibold">{p.title}</h2>
              <p className="mt-1 text-sm text-muted">{p.excerpt}</p>
            </Card>
          ))}
        </div>
        <p className="mt-8 text-xs text-muted">Demo content — resources are seeded for illustration.</p>
      </section>
      <MarketingFooter />
    </div>
  );
}
