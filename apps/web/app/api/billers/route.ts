
import { getDb, schema, eq, desc } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { createPayment, submitPayment } from "@zfloat/payments-core";
import { writeAuditEvent } from "@zfloat/audit";
import { resolveApprovalRulesForSubmit } from "@/lib/approval-gate";

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const billers = await db.select().from(schema.billers).where(eq(schema.billers.enabled, true)).orderBy(desc(schema.billers.createdAt)).limit(100);
  return apiOk({
    data: billers.map((b) => ({ ...b, amountMinor: null })),
  });
}

export async function POST(request: Request) {
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
  const billerId = String(b.billerId ?? "");
  const accountRef = String(b.accountRef ?? "");
  const amount = String(b.amount ?? "0");

  const [biller] = await db.select().from(schema.billers).where(eq(schema.billers.id, billerId)).limit(1);
  if (!biller) return apiError(404, "NOT_FOUND", "Biller not found");

  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, user!.tenantId!)).limit(1);
  if (!wallet) return apiError(400, "NO_WALLET", "No wallet configured for this workspace");

  try {
    const { payment } = await createPayment(db, {
      tenantId: user!.tenantId!,
      actorId: user!.userId,
      amount,
      channel: biller.channel === "till" ? "till" : "paybill",
      product: "bill_payment",
      sourceWalletId: wallet.id,
      category: "utilities",
      remark: `Bill: ${biller.name} (${accountRef})`,
      recipient: {
        name: biller.name,
        ...(biller.channel === "till" ? { tillNumber: biller.accountNumber } : { paybillNumber: biller.accountNumber, paybillAccount: accountRef }),
      },
      idempotencyKey: String(b.idempotencyKey ?? `bill-${crypto.randomUUID()}`),
    });
    await writeAuditEvent(db, { tenantId: user!.tenantId!, actorId: user!.userId, action: "bill.payment.created", resourceType: "payment", resourceId: payment.paymentId });
    const policy = await resolveApprovalRulesForSubmit(db, user!.tenantId!);
    if (!policy.ok) return apiError(409, policy.code, policy.message);
    const submitted = await submitPayment(db, { tenantId: user!.tenantId!, paymentId: payment.paymentId, actorId: user!.userId, policyRules: policy.rules });
    return apiOk({ data: { ...payment, status: submitted.status } }, { status: 201 });
  } catch (err) {
    return apiError(400, "BILL_FAILED", err instanceof Error ? err.message : "Bill payment failed");
  }
}
