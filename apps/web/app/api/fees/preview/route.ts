import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { computeFee } from "@zfloat/payments-core";
import { getSessionUser, apiOk, apiError } from "@/lib/api";

/** Live fee preview — server-computed, never trusted from the client. */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in to continue");
  const channel = request.nextUrl.searchParams.get("channel") ?? "mpesa";
  const amount = request.nextUrl.searchParams.get("amount") ?? "0";
  const product = request.nextUrl.searchParams.get("product") ?? "single_payment";

  const { db } = getDb();
  try {
    const fee = await computeFee(db, BigInt(Math.round(Number(amount) * 100)), {
      tenantId: user.tenantId ?? "00000000-0000-0000-0000-000000000000",
      product,
      channel,
      providerCode: "local-sandbox",
    });
    return apiOk({ data: { feeMinor: fee.feeMinor.toString(), currency: fee.currency } });
  } catch {
    return apiOk({ data: { feeMinor: "0", currency: "KES" } });
  }
}
