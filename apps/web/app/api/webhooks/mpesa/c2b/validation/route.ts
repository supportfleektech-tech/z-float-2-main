/**
 * Daraja C2B validation — called before M-Pesa completes a paybill/till
 * payment (only if "external validation" is enabled on the shortcode).
 * Rejects account numbers that match no business so the payer is refunded
 * instantly instead of money landing unallocated.
 */
import { NextResponse } from "next/server";
import { getDb } from "@zfloat/database";
import { parseC2BConfirmation } from "@zfloat/providers";
import { validateC2BPayment } from "@zfloat/payments-core";
import { secretsReady } from "@/lib/secret-guard";
import { c2bTokenOk } from "@/lib/c2b";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await secretsReady();
  if (!c2bTokenOk(request)) return NextResponse.json({ ResultCode: "C2B00016", ResultDesc: "Rejected" }, { status: 401 });
  const c2b = parseC2BConfirmation(await request.text());
  if (!c2b) return NextResponse.json({ ResultCode: "C2B00016", ResultDesc: "Rejected" });
  try {
    const { db } = getDb();
    const r = await validateC2BPayment(db, c2b);
    return NextResponse.json({ ResultCode: r.resultCode, ResultDesc: r.resultDesc });
  } catch {
    // Fail open: never block a payer because our DB hiccuped; confirmation will orphan it for recon.
    return NextResponse.json({ ResultCode: "0", ResultDesc: "Accepted" });
  }
}
