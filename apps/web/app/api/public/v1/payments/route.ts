import { NextRequest, NextResponse } from "next/server";
import { getDb, schema, eq, and } from "@zfloat/database";
import { requirePublicApiKey } from "@/lib/public-api";
import { createPayment, submitPayment, PaymentError } from "@zfloat/payments-core";
import { minorToDisplay } from "@zfloat/money";
import { desc } from "drizzle-orm";
import { resolveApprovalRulesForSubmit } from "@/lib/approval-gate";

/**
 * Public API v1 — programmatic payments for tenants with a valid API key.
 * POST /api/public/v1/payments  { amount, channel, recipient, remark, idempotencyKey }
 * GET  /api/public/v1/payments?limit=20 — tenant-scoped list.
 * Auth: Authorization: Bearer zf_live_… | x-api-key.
 * Errors: { error: { code, message, requestId } } with 4xx/5xx semantics;
 * idempotencyKey replays return the existing payment without double-execution.
 */

async function tenantWallet(tenantId: string) {
  const { db } = getDb();
  const [wallet] = await db
    .select()
    .from(schema.wallets)
    .where(and(eq(schema.wallets.tenantId, tenantId), eq(schema.wallets.status, "ACTIVE")))
    .orderBy(schema.wallets.createdAt)
    .limit(1);
  return wallet ?? null;
}

/** The tenant's first user — the actor for API-originated payment actions. */
async function tenantActorId(tenantId: string): Promise<string> {
  const { db } = getDb();
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.tenantId, tenantId))
    .orderBy(schema.users.createdAt)
    .limit(1);
  if (!user) throw new Error("tenant has no users");
  return user.id;
}

export async function POST(request: NextRequest) {
  const { ctx, response } = await requirePublicApiKey(request);
  if (response) return response;
  const { db } = getDb();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body." } }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const amount = String(b.amount ?? "");
  const channel = String(b.channel ?? "mpesa") as "mpesa" | "till" | "paybill" | "bank";
  const recipient = (b.recipient ?? {}) as Record<string, unknown>;
  const idempotencyKey = String(b.idempotencyKey ?? "");

  const wallet = await tenantWallet(ctx!.auth.tenantId);
  if (!wallet) {
    return NextResponse.json({ error: { code: "NO_WALLET", message: "Tenant has no active wallet." } }, { status: 409 });
  }

  let actorId: string;
  try {
    actorId = await tenantActorId(ctx!.auth.tenantId);
  } catch {
    return NextResponse.json({ error: { code: "NO_ACTOR", message: "Tenant has no user to attribute API actions to." } }, { status: 409 });
  }

  try {
    const { payment, replayed } = await createPayment(db, {
      tenantId: ctx!.auth.tenantId,
      actorId,
      amount,
      channel,
      product: "single_payment",
      sourceWalletId: wallet.id,
      remark: b.remark ? String(b.remark) : undefined,
      recipient: {
        name: String(recipient.name ?? ""),
        phone: recipient.phone ? String(recipient.phone) : undefined,
        email: recipient.email ? String(recipient.email) : undefined,
      },
      idempotencyKey: idempotencyKey || `pub-${crypto.randomUUID()}`,
    });
    if (replayed) {
      const [current] = await db
        .select({ status: schema.payments.status })
        .from(schema.payments)
        .where(eq(schema.payments.id, payment.paymentId))
        .limit(1);
      return NextResponse.json(
        { data: { paymentId: payment.paymentId, status: current?.status ?? payment.status, amount, currency: "KES", replayed: true } },
        { status: 200 },
      );
    }
    const policy = await resolveApprovalRulesForSubmit(db, ctx!.auth.tenantId);
    if (!policy.ok) {
      return NextResponse.json({ error: { code: policy.code, message: policy.message } }, { status: 409 });
    }
    const submitted = await submitPayment(db, {
      tenantId: ctx!.auth.tenantId,
      paymentId: payment.paymentId,
      actorId,
      policyRules: policy.rules,
    });
    return NextResponse.json(
      {
        data: {
          paymentId: payment.paymentId,
          status: submitted.status,
          approvalRequired: submitted.status === "PENDING_APPROVAL",
          amount,
          currency: "KES",
          replayed,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    const code = err instanceof PaymentError ? err.code : "PAYMENT_FAILED";
    return NextResponse.json({ error: { code, message: (err as Error).message } }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const { ctx, response } = await requirePublicApiKey(request);
  if (response) return response;
  const { db } = getDb();
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 20), 1), 100);

  const rows = await db
    .select({
      id: schema.payments.id,
      paymentNumber: schema.payments.paymentNumber,
      amountMinor: schema.payments.amountMinor,
      feeMinor: schema.payments.feeMinor,
      channel: schema.payments.channel,
      status: schema.payments.status,
      providerReference: schema.payments.providerReference,
      createdAt: schema.payments.createdAt,
    })
    .from(schema.payments)
    .where(eq(schema.payments.tenantId, ctx!.auth.tenantId))
    .orderBy(desc(schema.payments.createdAt))
    .limit(limit);

  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      paymentNumber: r.paymentNumber,
      amountMinor: r.amountMinor.toString(),
      amountDisplay: minorToDisplay(BigInt(r.amountMinor)),
      channel: r.channel,
      status: r.status,
      providerReference: r.providerReference,
      createdAt: r.createdAt,
    })),
  });
}
