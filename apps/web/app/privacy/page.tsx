import { MarketingHeader, MarketingFooter } from "@/components/brand";

const sections: Array<[string, string[]]> = [
  [
    "1. Scope",
    [
      "This Privacy Policy describes how Z-float (\"we\") processes personal data in connection with the Platform, in line with the principles of the Kenyan Data Protection Act, 2019. We act as a processor for merchant account holders and as a controller for our own site visitors.",
    ],
  ],
  [
    "2. Data we process",
    [
      "Account data: name, work email, phone, role and credentials for platform accounts.",
      "Payment data: recipient names, phone numbers, bank details, amounts, references and transaction histories, processed on behalf of the merchant.",
      "Technical data: IP address, device and browser information, and security events, for protection and diagnostics.",
    ],
  ],
  [
    "3. How we use data",
    [
      "To operate the Platform: process payments, enforce approvals and limits, reconcile transactions, prevent fraud, and provide support. We do not sell personal data. We do not use payment data for advertising.",
    ],
  ],
  [
    "4. Sharing",
    [
      "Data is shared with regulated partners (PSPs, banks, mobile money operators) solely to execute payments you instruct, and with sub-processors such as cloud infrastructure and security tooling, under data processing agreements.",
    ],
  ],
  [
    "5. Retention & security",
    [
      "Payment records are retained for legal and audit periods (7 years for financial records where applicable), then deleted or anonymised. Data is protected in transit and at rest; access is logged and reviewed. You can request access, correction or deletion by contacting privacy@zfloat.app.",
    ],
  ],
  [
    "6. Data protection rights",
    [
      "Under the Data Protection Act you have rights to access, correction, deletion, restriction and portability, and the right to lodge a complaint with the Office of the Data Protection Commissioner (ODPC).",
    ],
  ],
  [
    "7. Contact",
    [
      "Data Protection Officer: dpo@zfloat.app. This is a demonstration product; nothing herein constitutes a regulatory claim or legal advice.",
    ],
  ],
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="text-4xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted">Effective date: 1 January 2026 · Demo software privacy policy</p>
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
