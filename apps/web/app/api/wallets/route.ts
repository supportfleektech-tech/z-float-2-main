
import { getDb, schema, eq } from "@zfloat/database";
import { requireUser, apiOk } from "@/lib/api";
import { minorToDisplay } from "@zfloat/money";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  const result = await db
    .select({
      wallet: schema.wallets,
      branchName: schema.branches.name,
      branchCode: schema.branches.code,
      branchEtimsId: schema.branches.etimsBranchId,
    })
    .from(schema.wallets)
    .leftJoin(schema.branches, eq(schema.wallets.branchId, schema.branches.id))
    .where(eq(schema.wallets.tenantId, user!.tenantId!))
    .orderBy(schema.wallets.createdAt);

  return apiOk({
    data: result.map((r) => ({
      id: r.wallet.id,
      name: r.wallet.name,
      branchId: r.wallet.branchId,
      branchName: r.branchName,
      branchCode: r.branchCode,
      branchEtimsId: r.branchEtimsId,
      availableMinor: r.wallet.availableMinor.toString(),
      reservedMinor: r.wallet.reservedMinor.toString(),
      availableDisplay: minorToDisplay(BigInt(r.wallet.availableMinor)),
      status: r.wallet.status,
      currency: r.wallet.currency,
    })),
  });
}
