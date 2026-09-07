
import { NextRequest } from "next/server";
import { getDb, schema, desc, eq, and } from "@zfloat/database";
import { createPayment, submitPayment } from "@zfloat/payments-core";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { writeAuditEvent } from "@zfloat/audit";
import { resolveApprovalRulesForSubmit } from "@/lib/approval-gate";

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  const status = request.nextUrl.searchParams.get("status");

  const rows = await db
    .select({
      id: schema.payments.id,
      paymentNumber: schema.payments.paymentNumber,
      status: schema.payments.status,
      amountMinor: schema.payments.amountMinor,
      feeMinor: schema.payments.feeMinor,
      beneficiarySnapshot: schema.payments.beneficiarySnapshot,
      channel: schema.payments.channel,
      product: schema.payments.product,
      createdAt: schema.payments.createdAt,
    })
    .from(schema.payments)
    .where(and(eq(schema.payments.tenantId, user!.tenantId!), ...(status ? [eq(schema.payments.status, status)] : [])))
    .orderBy(desc(schema.payments.createdAt))
    .limit(Math.min(limit, 200));

  return apiOk({
    data: rows.map((r) => {
      const ben = (r.beneficiarySnapshot ?? {}) as Record<string, unknown>;
      return { ...r, amountMinor: r.amountMinor.toString(), feeMinor: r.feeMinor.toString(), beneficiaryName: String(ben.name ?? "") };
    }),
  });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const amount = String(b.amount ?? "");
  const channel = String(b.channel ?? "mpesa") as "mpesa" | "till" | "paybill" | "bank";
  const idempotencyKey = String(b.idempotencyKey ?? `web-${crypto.randomUUID()}`);
  const walletId = String(b.walletId ?? "");
  const recipient = (b.recipient ?? {}) as Record<string, unknown>;

  try {
    const { payment, replayed } = await createPayment(db, {
      tenantId: user!.tenantId!,
      actorId: user!.userId,
      amount,
      channel,
      product: String(b.product ?? "single_payment") as "single_payment",
      sourceWalletId: walletId,
      branchId: b.branchId ? String(b.branchId) : undefined,
      departmentId: b.departmentId ? String(b.departmentId) : undefined,
      category: b.category ? String(b.category) : undefined,
      remark: b.remark ? String(b.remark) : undefined,
      recipient: {
        name: String(recipient.name ?? ""),
        phone: recipient.phone ? String(recipient.phone) : undefined,
        email: recipient.email ? String(recipient.email) : undefined,
        bankAccountName: recipient.bankAccountName ? String(recipient.bankAccountName) : undefined,
        bankAccountNumber: recipient.bankAccountNumber ? String(recipient.bankAccountNumber) : undefined,
        bankCode: recipient.bankCode ? String(recipient.bankCode) : undefined,
        tillNumber: recipient.tillNumber ? String(recipient.tillNumber) : undefined,
        paybillNumber: recipient.paybillNumber ? String(recipient.paybillNumber) : undefined,
        paybillAccount: recipient.paybillAccount ? String(recipient.paybillAccount) : undefined,
      },
      idempotencyKey,
    });

    await writeAuditEvent(db, { tenantId: user!.tenantId!, actorId: user!.userId, action: "payment.created", resourceType: "payment", resourceId: payment.paymentId });

    // If the requester chose to submit immediately and no approval policy is set
    // (demo default), queue it directly.
    if (b.submit === true) {
      // Idempotent replay: the payment already exists — return its CURRENT state
      // instead of re-running submission (never double-submit).
      if (replayed) {
        const [current] = await db
          .select({ status: schema.payments.status })
          .from(schema.payments)
          .where(eq(schema.payments.id, payment.paymentId))
          .limit(1);
        return apiOk({ data: { ...payment, status: current?.status ?? payment.status } }, { status: 201 });
      }
      // Maker-checker: resolve the tenant's approval policy at submit time
      // (never an empty rule set — fail closed when no policy is published).
      const policy = await resolveApprovalRulesForSubmit(db, user!.tenantId!);
      if (!policy.ok) return apiError(409, policy.code, policy.message);
      const submitted = await submitPayment(db, {
        tenantId: user!.tenantId!,
        paymentId: payment.paymentId,
        actorId: user!.userId,
        policyRules: policy.rules,
      });
      return apiOk({ data: { ...payment, status: submitted.status } }, { status: 201 });
    }

    return apiOk({ data: payment }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Payment creation failed";
    return apiError(400, "PAYMENT_FAILED", message);
  }
}
