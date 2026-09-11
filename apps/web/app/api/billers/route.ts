
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

  let channel: string;
  let paybillNumber: string | undefined;
  let tillNumber: string | undefined;
  let paybillAccount: string | undefined;
  let name: string;
  let remark: string;

  let category = "utilities";
  if (billerId === "custom") {
    // Custom biller
    const customName = String(b.customName ?? "");
    const customChannel = String(b.customChannel ?? "paybill");
    const customAccountNumber = String(b.customAccountNumber ?? "");
    const customCategory = String(b.customCategory ?? "Utilities");

    if (!customName) return apiError(400, "INVALID_NAME", "Enter a biller name");
    if (!customAccountNumber) return apiError(400, "INVALID_ACCOUNT", "Enter the paybill/till number");
    if (Number(amount) <= 0) return apiError(400, "INVALID_AMOUNT", "Enter a valid amount");

    channel = customChannel;
    name = customName;
    category = customCategory || "utilities";
    remark = `Bill: ${customName} (${accountRef || customAccountNumber})`;

    if (customChannel === "till") {
      tillNumber = customAccountNumber;
    } else {
      paybillNumber = customAccountNumber;
      paybillAccount = accountRef || undefined;
    }
  } else {
    // Predefined biller
    const [biller] = await db.select().from(schema.billers).where(eq(schema.billers.id, billerId)).limit(1);
    if (!biller) return apiError(404, "NOT_FOUND", "Biller not found");

    channel = biller.channel === "till" ? "till" : "paybill";
    name = biller.name;
    category = biller.category || "utilities";
    remark = `Bill: ${biller.name} (${accountRef})`;

    if (biller.channel === "till") {
      tillNumber = biller.accountNumber;
    } else {
      paybillNumber = biller.accountNumber;
      paybillAccount = accountRef;
    }
  }

  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, user!.tenantId!)).limit(1);
  if (!wallet) return apiError(400, "NO_WALLET", "No wallet configured for this workspace");

  try {
    const recipient: { name: string; tillNumber?: string; paybillNumber?: string; paybillAccount?: string } = { name };
    if (channel === "till") {
      recipient.tillNumber = tillNumber!;
    } else {
      recipient.paybillNumber = paybillNumber!;
      if (paybillAccount) recipient.paybillAccount = paybillAccount;
    }

    const { payment } = await createPayment(db, {
      tenantId: user!.tenantId!,
      actorId: user!.userId,
      amount,
      channel: channel as "mpesa" | "till" | "paybill" | "bank",
      product: "bill_payment",
      sourceWalletId: wallet.id,
      category,
      remark,
      recipient,
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
