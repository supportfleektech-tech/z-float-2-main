import { NextRequest } from "next/server";
import { getDb, schema, eq, and } from "@zfloat/database";
import { apiOk, apiError, rateLimit } from "@/lib/api";
import { collectViaPaymentLink } from "@zfloat/payments-core";

/**
 * POST /api/pay/:token — public payment-link completion (no session).
 * Rate-limited per IP; idempotent per (token, payerRef) so double-clicks
 * never double-fund. Simulates the M-Pesa STK-push acceptance; the sandbox
 * rails settle it immediately into the merchant wallet.
 */
export async function POST(request: NextRequest, ctx: { params: { token: string } }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await rateLimit(`paylink:${ip}`, { windowMs: 60_000, max: 10 }))) {
    return apiError(429, "RATE_LIMITED", "Too many attempts — try again shortly");
  }
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const payerRef = String(b.payerRef ?? "").trim();
  const payerName = b.payerName ? String(b.payerName).slice(0, 120) : undefined;
  if (!payerRef || payerRef.length < 8) {
    return apiError(400, "PAYER_REF_REQUIRED", "Missing payer reference");
  }

  const { db } = getDb();
  const token = ctx.params.token;

  // Idempotency: one settlement per (token, payerRef).
  const [link] = await db
    .select({ tenantId: schema.paymentLinks.tenantId })
    .from(schema.paymentLinks)
    .where(eq(schema.paymentLinks.token, token))
    .limit(1);
  if (!link) return apiError(404, "NOT_FOUND", "Payment link not found");

  const idemKey = `paylink:${token}:${payerRef}`;
  const [existing] = await db
    .select()
    .from(schema.idempotencyRecords)
    .where(and(eq(schema.idempotencyRecords.tenantId, link.tenantId), eq(schema.idempotencyRecords.scope, "paylink.collect"), eq(schema.idempotencyRecords.key, idemKey)))
    .limit(1);
  if (existing?.response) {
    return apiOk({ data: { ...(existing.response as Record<string, unknown>), replayed: true } });
  }

  try {
    const result = await collectViaPaymentLink(db, { token, payerRef, payerName });
    await db.insert(schema.idempotencyRecords).values({
      tenantId: link.tenantId,
      scope: "paylink.collect",
      key: idemKey,
      status: "COMPLETED",
      response: {
        fundedMinor: result.fundedMinor.toString(),
        walletBalanceMinor: result.walletBalanceMinor,
        paymentLinkId: result.paymentLinkId,
      },
      completedAt: new Date(),
    });
    return apiOk({
      data: {
        fundedMinor: result.fundedMinor.toString(),
        walletBalanceMinor: result.walletBalanceMinor,
        paymentLinkId: result.paymentLinkId,
        reference: `LNK-${token.slice(0, 8).toUpperCase()}-${payerRef.slice(0, 6).toUpperCase()}`,
      },
      status: 201,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Payment failed";
    const code = /not found/i.test(msg) ? 404 : /expired|not active|limit/i.test(msg) ? 410 : 400;
    return apiError(code, "PAYMENT_LINK_FAILED", msg);
  }
}
