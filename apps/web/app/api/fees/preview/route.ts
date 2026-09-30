import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { computeFee } from "@zfloat/payments-core";
import { apiOk, apiError } from "@/lib/api";

const SAMPLE_AMOUNTS = [500, 1000, 5000, 10000];

/** Public fee preview for the marketing pricing page. */
export async function GET(_request: NextRequest) {
  const { db } = getDb();
  try {
    const fees = [];
    for (const amount of SAMPLE_AMOUNTS) {
      const amountMinor = BigInt(amount * 100);
      const fee = await computeFee(db, amountMinor, {
        tenantId: "00000000-0000-0000-0000-000000000000",
        product: "single_payment",
        channel: "mpesa",
        providerCode: "local-sandbox",
      });
      fees.push({
        amount,
        feeMinor: fee.feeMinor.toString(),
        currency: fee.currency,
      });
    }
    return apiOk({ fees });
  } catch {
    return apiError(500, "FEE_COMPUTE_ERROR", "Unable to compute fees");
  }
}
