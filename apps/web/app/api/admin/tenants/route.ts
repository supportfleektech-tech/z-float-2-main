
import { getDb, schema, desc, eq, count, sum } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";

export async function GET() {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();

  const tenants = await db
    .select({ id: schema.tenants.id, name: schema.tenants.name, status: schema.tenants.status, createdAt: schema.tenants.createdAt })
    .from(schema.tenants)
    .orderBy(desc(schema.tenants.createdAt));

  const userCounts = await db
    .select({ tenantId: schema.users.tenantId, n: count() })
    .from(schema.users)
    .groupBy(schema.users.tenantId);
  const paymentAgg = await db
    .select({ tenantId: schema.payments.tenantId, n: count(), total: sum(schema.payments.amountMinor) })
    .from(schema.payments)
    .where(eq(schema.payments.status, "SUCCESS"))
    .groupBy(schema.payments.tenantId);

  const userMap = new Map(userCounts.map((r) => [r.tenantId, r.n]));
  const paymentMap = new Map(paymentAgg.map((r) => [r.tenantId, { n: r.n, total: r.total ?? 0n }]));

  return apiOk({
    data: tenants.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      createdAt: t.createdAt,
      userCount: userMap.get(t.id) ?? 0,
      paymentCount: paymentMap.get(t.id)?.n ?? 0,
      volumeMinor: (paymentMap.get(t.id)?.total ?? 0n).toString(),
    })),
  });
}
