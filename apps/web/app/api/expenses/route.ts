import { NextRequest } from "next/server";
import { getDb, schema, eq, desc } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { createPayment, submitPayment } from "@zfloat/payments-core";
import { resolveApprovalRulesForSubmit } from "@/lib/approval-gate";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const rows = await db
    .select()
    .from(schema.charges)
    .where(eq(schema.charges.tenantId, user!.tenantId!))
    .orderBy(desc(schema.charges.createdAt))
    .limit(100);
  return apiOk({ data: rows.map((r) => ({ ...r, amountMinor: r.amountMinor.toString() })) });
}

/** Record an expense claim; optionally pay it from a wallet. */
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
  const description = String(b.description ?? "");
  const amount = String(b.amount ?? "0");
  const payNow = b.payNow === true;
  if (!description || !amount) return apiError(400, "MISSING_FIELDS", "Description and amount are required");
  try {
    const [charge] = await db
      .insert(schema.charges)
      .values({ tenantId: user!.tenantId!, description, amountMinor: BigInt(Math.round(Number(amount) * 100)) })
      .returning();
    if (!charge) throw new Error("Failed to record expense");
    if (payNow) {
      const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, user!.tenantId!)).limit(1);
      if (!wallet) throw new Error("No wallet configured");
      const { payment } = await createPayment(db, {
        tenantId: user!.tenantId!,
        actorId: user!.userId,
        amount,
        channel: "mpesa",
        product: "expense",
        sourceWalletId: wallet.id,
        category: "expenses",
        remark: description,
        recipient: { name: "Expense claim" },
        idempotencyKey: `exp-${crypto.randomUUID()}`,
      });
      // Maker-checker: resolve the tenant's approval policy at submit time.
      const policy = await resolveApprovalRulesForSubmit(db, user!.tenantId!);
      if (!policy.ok) throw new Error(policy.message);
      await submitPayment(db, {
        tenantId: user!.tenantId!,
        paymentId: payment.paymentId,
        actorId: user!.userId,
        policyRules: policy.rules,
      });
      return apiOk({ data: { ...charge, amountMinor: charge.amountMinor.toString(), paymentCreated: true } }, { status: 201 });
    }
    return apiOk({ data: { ...charge, amountMinor: charge.amountMinor.toString(), paymentCreated: false } }, { status: 201 });
  } catch (err) {
    return apiError(400, "EXPENSE_FAILED", err instanceof Error ? err.message : "Expense creation failed");
  }
}
