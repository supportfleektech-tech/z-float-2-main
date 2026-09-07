
import { getDb, schema, desc, eq, and, gte, count, sum } from "@zfloat/database";
import { getSessionUser, apiOk, apiError } from "@/lib/api";
import { minorToDisplay } from "@zfloat/money";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in to continue");
  if (!user.tenantId) return apiError(403, "NO_TENANT", "No business workspace");

  const { db } = getDb();
  const tenantId = user.tenantId;

  const [wallet] = await db.select().from(schema.wallets).where(and(eq(schema.wallets.tenantId, tenantId), eq(schema.wallets.status, "ACTIVE"))).limit(1);

  const [pending] = await db
    .select({ n: count() })
    .from(schema.approvalRequests)
    .where(and(eq(schema.approvalRequests.tenantId, tenantId), eq(schema.approvalRequests.status, "PENDING")));

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [today] = await db
    .select({ total: sum(schema.payments.amountMinor) })
    .from(schema.payments)
    .where(and(eq(schema.payments.tenantId, tenantId), eq(schema.payments.status, "SUCCESS"), gte(schema.payments.successAt, todayStart)));

  const [failed] = await db
    .select({ n: count() })
    .from(schema.payments)
    .where(and(eq(schema.payments.tenantId, tenantId), eq(schema.payments.status, "FAILED"), gte(schema.payments.createdAt, new Date(Date.now() - 7 * 86400_000))));

  const [scheduled] = await db
    .select({ n: count() })
    .from(schema.paymentSchedules)
    .where(and(eq(schema.paymentSchedules.tenantId, tenantId), eq(schema.paymentSchedules.status, "ACTIVE")));

  const recent = await db
    .select({
      id: schema.payments.id,
      paymentNumber: schema.payments.paymentNumber,
      status: schema.payments.status,
      amountMinor: schema.payments.amountMinor,
      beneficiarySnapshot: schema.payments.beneficiarySnapshot,
      createdAt: schema.payments.createdAt,
      product: schema.payments.product,
    })
    .from(schema.payments)
    .where(eq(schema.payments.tenantId, tenantId))
    .orderBy(desc(schema.payments.createdAt))
    .limit(8);

  return apiOk({
    data: {
      balance: wallet ? minorToDisplay(BigInt(wallet.availableMinor)) : "KES 0.00",
      pendingApprovals: pending?.n ?? 0,
      todayOutgoing: minorToDisplay(BigInt(today?.total ?? 0n)),
      failedCount: failed?.n ?? 0,
      scheduledCount: scheduled?.n ?? 0,
      recent: recent.map((r) => {
        const ben = (r.beneficiarySnapshot ?? {}) as Record<string, unknown>;
        return { ...r, amountMinor: r.amountMinor.toString(), beneficiaryName: String(ben.name ?? "Unknown") };
      }),
    },
  });
}
