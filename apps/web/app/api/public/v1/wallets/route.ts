import { NextRequest, NextResponse } from "next/server";
import { getDb, schema, eq } from "@zfloat/database";
import { requirePublicApiKey } from "@/lib/public-api";
import { minorToDisplay } from "@zfloat/money";

/** GET /api/public/v1/wallets — tenant wallet balances (read-only, key-auth). */
export async function GET(request: NextRequest) {
  const { ctx, response } = await requirePublicApiKey(request);
  if (response) return response;
  const { db } = getDb();
  const wallets = await db
    .select()
    .from(schema.wallets)
    .where(eq(schema.wallets.tenantId, ctx!.auth.tenantId))
    .orderBy(schema.wallets.createdAt);
  return NextResponse.json({
    data: wallets.map((w) => ({
      id: w.id,
      name: w.name,
      currency: w.currency,
      status: w.status,
      availableMinor: w.availableMinor.toString(),
      availableDisplay: minorToDisplay(BigInt(w.availableMinor)),
      reservedMinor: w.reservedMinor.toString(),
    })),
  });
}
