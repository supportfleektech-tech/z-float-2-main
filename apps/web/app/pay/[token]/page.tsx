import { getDb, schema, eq } from "@zfloat/database";
import { notFound } from "next/navigation";
import { PayButton } from "./pay-button";

/** Public payment-link page — no authentication, tenant-scoped view. */
export default async function PayLinkPage({ params }: { params: { token: string } }) {
  const { db } = getDb();
  const [link] = await db
    .select({
      name: schema.paymentLinks.name,
      description: schema.paymentLinks.description,
      amountMinor: schema.paymentLinks.amountMinor,
      currency: schema.paymentLinks.currency,
      status: schema.paymentLinks.status,
      tenantName: schema.tenants.name,
    })
    .from(schema.paymentLinks)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.paymentLinks.tenantId))
    .where(eq(schema.paymentLinks.token, params.token))
    .limit(1);
  if (!link) notFound();

  const ksh = (Number(link.amountMinor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });
  const inactive = link.status !== "ACTIVE";

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md rounded-2xl border border-borderline bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <p className="text-sm text-muted">{link.tenantName}</p>
          <h1 className="mt-1 text-xl font-bold">{link.name}</h1>
          {link.description ? <p className="mt-1 text-sm text-muted">{link.description}</p> : null}
        </div>

        <div className="mb-6 rounded-xl bg-surface p-6 text-center">
          <p className="text-xs uppercase tracking-widest text-muted">Amount due</p>
          <p className="mt-1 text-4xl font-bold tracking-tight">{link.currency} {ksh}</p>
        </div>

        <PayButton token={params.token} inactive={inactive} />

        <p className="mt-6 text-center text-[11px] leading-relaxed text-muted">
          Secured by Z-float · Powered by the sandbox payment rail · {link.tenantName} receives a notification and ledger
          entry when you pay.
        </p>
      </div>
    </div>
  );
}
