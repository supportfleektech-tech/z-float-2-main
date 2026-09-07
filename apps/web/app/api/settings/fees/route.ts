
import { getDb, schema, eq } from "@zfloat/database";
import { requireUser, apiOk } from "@/lib/api";

/** Effective fee rules visible to a tenant (platform-wide ACTIVE rules). */
export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const rules = await db
    .select()
    .from(schema.feeRules)
    .where(eq(schema.feeRules.status, "ACTIVE"));
  const plans = await db.select().from(schema.pricingPlans);
  return apiOk({
    data: {
      rules: rules.map((r) => ({
        id: r.id,
        product: r.product,
        channel: r.channel,
        provider: r.provider,
        flatFeeMinor: r.flatFeeMinor.toString(),
        percentBps: r.percentBps.toString(),
        minFeeMinor: r.minFeeMinor.toString(),
        maxFeeMinor: r.maxFeeMinor.toString(),
        version: r.version,
      })),
      plans,
    },
  });
}
