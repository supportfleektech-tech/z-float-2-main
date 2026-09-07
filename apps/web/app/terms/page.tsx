import { MarketingHeader, MarketingFooter } from "@/components/brand";

const sections: Array<[string, string[]]> = [
  [
    "1. Who we are",
    [
      "Z-float (\"the Platform\") is a business payment operations software provided as a demonstration product. Z-float is not a licensed payment service provider, bank, deposit-taking institution, or money remitter. Payment execution, custody of funds, and settlement are performed by regulated partners (payment service providers, banks, and mobile money operators) under their own licenses and terms.",
    ],
  ],
  [
    "2. What the Platform does",
    [
      "The Platform provides tools for initiating, approving, executing, tracking and reconciling payments: single and bulk disbursements, bill payments, payroll, supplier payments, expenses and airtime. The Platform maintains an internal ledger and workflow controls; it does not hold client funds.",
    ],
  ],
  [
    "3. Accounts and balances",
    [
      "Balances shown inside the Platform reflect the Platform's internal wallet ledger, backed by funds held with regulated partners. In the demonstration environment, all money movement is simulated on sandbox rails and no real value is transferred.",
    ],
  ],
  [
    "4. Your responsibilities",
    [
      "You are responsible for the accuracy of payment instructions you submit, for maintaining the confidentiality of your credentials, and for ensuring your use complies with applicable law, including anti-money laundering and sanctions obligations that apply to you.",
    ],
  ],
  [
    "5. Fees",
    [
      "Platform fees are quoted before you confirm a payment and are documented in your pricing schedule. Partner rail charges are passed through at cost and disclosed. Fees may be changed with notice; changes never alter completed transactions.",
    ],
  ],
  [
    "6. Limitation of liability",
    [
      "To the maximum extent permitted by law, the Platform provider is not liable for indirect, incidental or consequential losses, or for losses arising from instructions submitted with incorrect details, provider outages, or circumstances beyond its reasonable control. Nothing in these terms limits liability that cannot be limited by law.",
    ],
  ],
  [
    "7. Termination",
    [
      "Either party may terminate on written notice. Upon termination, outstanding payment instructions will be honoured or cancelled at your direction, and your data may be exported for a period stated in the agreement.",
    ],
  ],
  [
    "8. Governing law",
    [
      "These terms are governed by the laws of Kenya. Disputes are subject to the exclusive jurisdiction of the Kenyan courts. This is a demonstration product; nothing herein constitutes a regulatory claim or legal advice.",
    ],
  ],
];

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="text-4xl font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted">Effective date: 1 January 2026 · Demo software terms</p>
        <div className="mt-10 space-y-8">
          {sections.map(([title, paras]) => (
            <div key={title}>
              <h2 className="font-semibold">{title}</h2>
              {paras.map((p) => (
                <p key={p.slice(0, 24)} className="mt-2 text-sm leading-relaxed text-muted">{p}</p>
              ))}
            </div>
          ))}
        </div>
      </section>
      <MarketingFooter />
    </div>
  );
}
