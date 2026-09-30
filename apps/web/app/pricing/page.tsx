import Link from "next/link";
import { MarketingHeader, MarketingFooter } from "@/components/brand";
import { Button, Badge } from "@/components/ui";
import { getSiteContent } from "@/lib/site";

interface PricingPlan {
  name: string;
  pricePerPaymentMinor?: number;
  monthlyMinor?: number;
  features: string[];
  highlighted?: boolean;
  cta?: string;
}

interface FeePreview {
  amount: number;
  feeMinor: string;
  currency: string;
}

export const dynamic = "force-dynamic";

function money(minor?: number): string {
  if (minor === undefined) return "—";
  const whole = Math.floor(minor / 100).toLocaleString();
  const frac = (minor % 100).toString().padStart(2, "0");
  return `${whole}.${frac}`;
}

function moneyFromMinorString(minor: string): string {
  const whole = Math.floor(Number(minor) / 100).toLocaleString();
  const frac = (Number(minor) % 100).toString().padStart(2, "0");
  return `${whole}.${frac}`;
}

async function getFeePreview(): Promise<FeePreview[]> {
  try {
    const base = process.env.APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${base}/api/fees/preview`, { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { fees?: FeePreview[] };
    return json.fees ?? [];
  } catch {
    return [];
  }
}

export default async function PricingPage() {
  const { page, settings } = await getSiteContent("pricing");
  const feePreview = await getFeePreview();
  const hero = (page?.content as { hero?: { title: string; subtitle: string } })?.hero ?? {
    title: "Simple, honest pricing",
    subtitle: "One flat platform fee per successful payment. No setup costs, no monthly minimums.",
  };
  const plans = ((page?.content as { plans?: PricingPlan[] })?.plans ?? []).map((p) => ({
    ...p,
    name: String((settings["site.pricing.plans"] as Record<string, unknown> | undefined)?.[p.name] ?? p.name),
  }));
  const note = (page?.content as { note?: string })?.note ?? "";

  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <Badge tone="info">Pricing</Badge>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">{hero.title}</h1>
          <p className="mt-4 text-lg text-muted">{hero.subtitle}</p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.name}
              className={`rounded-2xl border p-8 ${
                p.highlighted ? "border-primary bg-primary text-white shadow-xl" : "border-borderline bg-white"
              }`}
            >
              <p className={`text-sm font-semibold uppercase tracking-wider ${p.highlighted ? "text-white/70" : "text-muted"}`}>{p.name}</p>
              <p className="mt-4 text-4xl font-bold">
                {p.pricePerPaymentMinor !== undefined && p.pricePerPaymentMinor > 0 ? (
                  <>
                    KES {money(p.pricePerPaymentMinor)}
                    <span className={`text-base font-medium ${p.highlighted ? "text-white/70" : "text-muted"}`}> / payment</span>
                  </>
                ) : p.monthlyMinor && p.monthlyMinor > 0 ? (
                  <>
                    KES {money(p.monthlyMinor)}
                    <span className={`text-base font-medium ${p.highlighted ? "text-white/70" : "text-muted"}`}> / month</span>
                  </>
                ) : (
                  "Custom"
                )}
              </p>
              <ul className={`mt-6 space-y-2.5 text-sm ${p.highlighted ? "text-white/90" : "text-ink/80"}`}>
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className={p.highlighted ? "text-white" : "text-primary"}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/login?register=1" className="mt-8 block">
                <Button variant={p.highlighted ? "light" : "primary"} className="w-full" size="lg">
                  {p.cta ?? "Get started"}
                </Button>
              </Link>
            </div>
          ))}
        </div>

        {feePreview.length > 0 && (
          <div className="mx-auto mt-16 max-w-2xl">
            <h2 className="text-center text-2xl font-bold tracking-tight">M-PESA payment fees</h2>
            <p className="mt-2 text-center text-sm text-muted">Live fees computed from active fee rules — what you see is what you pay.</p>
            <div className="mt-6 overflow-hidden rounded-2xl border border-borderline">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-borderline bg-muted/30">
                    <th className="px-4 py-3 text-left font-semibold">Amount</th>
                    <th className="px-4 py-3 text-right font-semibold">Fee</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {feePreview.map((f) => (
                    <tr key={f.amount} className="border-b border-borderline last:border-0">
                      <td className="px-4 py-3">KES {f.amount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">KES {moneyFromMinorString(f.feeMinor)}</td>
                      <td className="px-4 py-3 text-right font-medium">
                        KES {(f.amount + Number(f.feeMinor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {note ? <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-muted">{note}</p> : null}
        <p className="mx-auto mt-4 max-w-2xl text-center text-xs text-muted">
          Prices shown are indicative demo pricing managed by the platform administrator — they update live, with no code changes.
        </p>
      </section>
      <MarketingFooter />
    </div>
  );
}
