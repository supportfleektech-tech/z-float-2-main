
import { NextRequest } from "next/server";
import { getDb, schema, eq, desc } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { createPayment, submitPayment } from "@zfloat/payments-core";
import { normalizeKenyanPhone } from "@zfloat/validation";
import { resolveApprovalRulesForSubmit } from "@/lib/approval-gate";

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const rows = await db.select().from(schema.airtimeCatalog).orderBy(desc(schema.airtimeCatalog.createdAt)).limit(100);
  return apiOk({
    data: rows.map((r) => ({ ...r, denominationMinor: r.denominationMinor.toString() })),
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
  const productId = String(b.productId ?? "");
  const phone = normalizeKenyanPhone(String(b.phone ?? ""));
  if (!phone) return apiError(400, "INVALID_PHONE", "Enter a valid Kenyan phone number");

  let amount: string;
  let product: string;
  let remark: string;
  let category = "airtime";

  if (productId === "custom") {
    // Custom amount airtime/data. Product stays "airtime" (the validated
    // product family for fee lookup); the AIRTIME/DATA distinction travels
    // in category + remark.
    const customAmount = String(b.customAmount ?? "");
    const customNetwork = String(b.customNetwork ?? "SAF");
    const customType = String(b.customType ?? "AIRTIME").toUpperCase();
    if (customType !== "AIRTIME" && customType !== "DATA") {
      return apiError(400, "INVALID_TYPE", "Type must be AIRTIME or DATA");
    }
    if (!customAmount || Number(customAmount) <= 0) {
      return apiError(400, "INVALID_AMOUNT", "Enter a valid amount");
    }
    amount = customAmount;
    product = "airtime";
    remark = `Custom ${customType} (${customNetwork})`;
    category = customType.toLowerCase();
  } else {
    // Predefined product
    const [predefinedProduct] = await db.select().from(schema.airtimeCatalog).where(eq(schema.airtimeCatalog.id, productId)).limit(1);
    if (!predefinedProduct) return apiError(404, "NOT_FOUND", "Airtime product not found");
    amount = (Number(predefinedProduct.denominationMinor) / 100).toFixed(2);
    product = predefinedProduct.type.toLowerCase();
    remark = `${predefinedProduct.name} (${predefinedProduct.network})`;
    category = predefinedProduct.type.toLowerCase();
  }

  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, user!.tenantId!)).limit(1);
  if (!wallet) return apiError(400, "NO_WALLET", "No wallet configured for this workspace");

  try {
    const { payment } = await createPayment(db, {
      tenantId: user!.tenantId!,
      actorId: user!.userId,
      amount,
      channel: "mpesa",
      product,
      sourceWalletId: wallet.id,
      category,
      remark,
      recipient: { name: `Airtime: ${phone}`, phone },
      idempotencyKey: `airtime-${crypto.randomUUID()}`,
    });
    const policy = await resolveApprovalRulesForSubmit(db, user!.tenantId!);
    if (!policy.ok) return apiError(409, policy.code, policy.message);
    const submitted = await submitPayment(db, { tenantId: user!.tenantId!, paymentId: payment.paymentId, actorId: user!.userId, policyRules: policy.rules });
    return apiOk({ data: { ...payment, status: submitted.status } }, { status: 201 });
  } catch (err) {
    return apiError(400, "AIRTIME_FAILED", err instanceof Error ? err.message : "Airtime purchase failed");
  }
}
