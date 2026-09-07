
import { getDb, schema, count, sum, eq } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";

export async function GET() {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();

  const [tenantCount] = await db.select({ n: count() }).from(schema.tenants);
  const [userCount] = await db.select({ n: count() }).from(schema.users);
  const [paymentCount] = await db.select({ n: count() }).from(schema.payments);
  const [volume] = await db.select({ total: sum(schema.payments.amountMinor) }).from(schema.payments).where(eq(schema.payments.status, "SUCCESS"));
  const [feeRules] = await db.select({ n: count() }).from(schema.feeRules).where(eq(schema.feeRules.status, "ACTIVE"));
  const [openRecon] = await db.select({ n: count() }).from(schema.reconExceptions).where(eq(schema.reconExceptions.status, "OPEN"));
  const [pendingApprovals] = await db.select({ n: count() }).from(schema.approvalRequests).where(eq(schema.approvalRequests.status, "PENDING"));
  const [auditCount] = await db.select({ n: count() }).from(schema.auditEvents);

  return apiOk({
    data: {
      tenants: tenantCount?.n ?? 0,
      users: userCount?.n ?? 0,
      payments: paymentCount?.n ?? 0,
      volumeMinor: (volume?.total ?? 0n).toString(),
      activeFeeRules: feeRules?.n ?? 0,
      openReconExceptions: openRecon?.n ?? 0,
      pendingApprovals: pendingApprovals?.n ?? 0,
      auditEvents: auditCount?.n ?? 0,
    },
  });
}
