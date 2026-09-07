import { getDb, schema, and, eq, gte, count, sum } from "@zfloat/database";
import { requireUser, apiOk } from "@/lib/api";
import { minorToDisplay } from "@zfloat/money";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const tenantId = user!.tenantId!;

  const byStatus = await db
    .select({ status: schema.payments.status, n: count(), total: sum(schema.payments.amountMinor) })
    .from(schema.payments)
    .where(eq(schema.payments.tenantId, tenantId))
    .groupBy(schema.payments.status);

  // 30-day series: fetch recent payments and bucket by day in JS (avoids raw SQL selects)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000);
  const recent = await db
    .select({ createdAt: schema.payments.createdAt, amountMinor: schema.payments.amountMinor })
    .from(schema.payments)
    .where(and(eq(schema.payments.tenantId, tenantId), eq(schema.payments.status, "SUCCESS"), gte(schema.payments.createdAt, thirtyDaysAgo)));
  const bucket = new Map<string, bigint>();
  for (const r of recent) {
    const day = r.createdAt.toISOString().slice(0, 10);
    bucket.set(day, (bucket.get(day) ?? 0n) + r.amountMinor);
  }
  const series = [...bucket.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, total]) => ({ day, totalMinor: total.toString() }));

  const [totals] = await db
    .select({ count: count(), sum: sum(schema.payments.amountMinor), fees: sum(schema.payments.feeMinor) })
    .from(schema.payments)
    .where(and(eq(schema.payments.tenantId, tenantId), eq(schema.payments.status, "SUCCESS")));

  return apiOk({
    data: {
      byStatus: byStatus.map((s) => ({ status: s.status, n: s.n, total: (s.total ?? 0n).toString() })),
      series,
      totals: {
        successfulPayments: totals?.count ?? 0,
        sumMinor: BigInt(totals?.sum ?? "0").toString(),
        feesMinor: BigInt(totals?.fees ?? "0").toString(),
        sumDisplay: minorToDisplay(BigInt(totals?.sum ?? "0")),
        feesDisplay: minorToDisplay(BigInt(totals?.fees ?? "0")),
      },
    },
  });
}
