/**
 * Daraja C2B confirmation — money has arrived on the paybill/till.
 * Resolves the business from BillRefNumber (ACME, ACME-INV-000007, ACME#7),
 * credits the wallet, marks the invoice paid and (via outbox) issues the
 * eTIMS receipt. Unmatched payments become reconciliation items. Idempotent
 * on TransID, so Safaricom retries are harmless.
 */
import { NextResponse } from "next/server";
import { getDb } from "@zfloat/database";
import { parseC2BConfirmation } from "@zfloat/providers";
import { recordC2BPayment } from "@zfloat/payments-core";
import { secretsReady } from "@/lib/secret-guard";
import { c2bTokenOk } from "@/lib/c2b";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await secretsReady();
  if (!c2bTokenOk(request)) return NextResponse.json({ ResultCode: 1, ResultDesc: "Unauthorised" }, { status: 401 });
  const c2b = parseC2BConfirmation(await request.text());
  if (!c2b) return NextResponse.json({ ResultCode: 1, ResultDesc: "Malformed confirmation" }, { status: 400 });
  try {
    const { db } = getDb();
    const r = await recordC2BPayment(db, c2b);
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted", status: r.status });
  } catch (err) {
    // 5xx → Safaricom retries; the TransID dedupe makes the retry safe.
    return NextResponse.json({ ResultCode: 1, ResultDesc: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
