/**
 * Wallet top-up via M-PESA STK push.
 *  POST /api/wallet/top-up  { amountMinor, phoneNumber }
 * Creates a PENDING collection, pushes the STK prompt, and returns the
 * transaction id + provider reference. The final outcome arrives on the
 * M-PESA webhook (see /api/webhooks/mpesa).
 */
import { getDb } from "@zfloat/database";
import { requireUser, apiError, rateLimit } from "@/lib/api";
import { initiateStkPush } from "@zfloat/payments-core";
import { collectionProvider, jsonOk, readJson, receivablesError } from "@/lib/receivables";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!(await rateLimit(`stk:${user!.tenantId}`, { windowMs: 60_000, max: 30 }))) {
    return apiError(429, "RATE_LIMITED", "Too many top-up requests — wait a minute and try again");
  }
  const b = await readJson(request);
  if (!b) return apiError(400, "BAD_REQUEST", "Invalid JSON body");

  const phoneNumber = String(b.phoneNumber ?? "").trim();
  if (!/^254\d{9}$/.test(phoneNumber)) {
    return apiError(400, "INVALID_PHONE", "Enter a valid Kenyan mobile number (254…)");
  }

  const rawAmount = b.amountMinor;
  let amountMinor: bigint | null = null;
  if (typeof rawAmount === "number" && Number.isInteger(rawAmount) && rawAmount > 0) {
    amountMinor = BigInt(rawAmount);
  } else if (typeof rawAmount === "string" && /^\d+$/.test(rawAmount)) {
    amountMinor = BigInt(rawAmount);
  }
  if (amountMinor === null || amountMinor <= 0n) {
    return apiError(400, "INVALID_AMOUNT", "Enter a valid amount in minor units (positive integer)");
  }

  const { db } = getDb();
  try {
    const result = await initiateStkPush(
      db,
      { tenantId: user!.tenantId! },
      {
        phoneNumber,
        amountMinor,
        accountReference: "WALLET-TOPUP",
        callbackUrl: `${process.env.APP_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/webhooks/mpesa`,
      },
      collectionProvider(),
    );
    return jsonOk({ data: result }, { status: 201 });
  } catch (err) {
    return receivablesError(err, "Could not start the wallet top-up");
  }
}
