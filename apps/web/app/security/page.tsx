import { MarketingHeader, MarketingFooter } from "@/components/brand";
import { Card, Badge } from "@/components/ui";

const pillars = [
  {
    title: "Defense in depth",
    items: [
      "Passwords hashed with scrypt (n=16384, r=8, p=1, 64-byte salt+hash)",
      "Opaque session tokens stored SHA-256 hashed, 12-hour TTL",
      "TOTP multi-factor step-up (RFC 6238) for sensitive actions",
      "Field-level AES-256-GCM encryption for secrets (v1:iv:tag:data)",
      "Login throttling: rate limits, lockout after 5 failures (15 min)",
    ],
  },
  {
    title: "Payment integrity",
    items: [
      "Mandatory idempotency keys — replays are detected, never double-executed",
      "Immutable double-entry ledger; corrections only via journaled reversals",
      "Atomic wallet reservations — funds can never be over-committed",
      "Provider timeouts never mark payments failed; verified callbacks decide",
      "Full state machine with payment status history on every transition",
    ],
  },
  {
    title: "Isolation & governance",
    items: [
      "Tenant isolation at the query layer — cross-tenant access is tested",
      "Role-based access control (RBAC) with least-privilege defaults",
      "Configurable multi-level approval policies, versioned and audited",
      "Complete audit trail of admin changes (who, what, when)",
      "Data protection: encryption in transit, keys external to app code",
    ],
  },
  {
    title: "Operations & resilience",
    items: [
      "Webhook gateway: verify → persist → dedupe → enqueue → transition → ledger → notify → ack",
      "Outbox pattern — every state change survives crashes",
      "Automated reconciliation flags mismatches instead of hiding them",
      "Structured logging without PII or secrets",
      "Restore drills and documented runbooks",
    ],
  },
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <Badge tone="info">Security</Badge>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Security built into every layer</h1>
          <p className="mt-4 text-lg text-muted">
            Z-float treats money movement like the trust operation it is. These controls are enforced by the platform,
            not by policy documents.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {pillars.map((p) => (
            <Card key={p.title} className="p-7">
              <h2 className="text-lg font-semibold">{p.title}</h2>
              <ul className="mt-4 space-y-2.5">
                {p.items.map((i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-ink/80">
                    <span className="mt-0.5 text-primary">✓</span>
                    <span>{i}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>

        <Card className="mt-10 p-7">
          <h2 className="font-semibold">Compliance posture</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Z-float is a software platform. Payments are executed by regulated partners (payment service providers, banks
            and mobile money operators) in line with their licenses and terms. We align operations with data protection
            principles under the Kenyan Data Protection Act and follow the guidance of the Central Bank of Kenya on
            cybersecurity for payment service providers. Nothing on this page constitutes a regulatory claim or legal advice.
          </p>
        </Card>
      </section>
      <MarketingFooter />
    </div>
  );
}
