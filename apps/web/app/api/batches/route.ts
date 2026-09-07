import { getDb, schema, desc, eq, toJsonSafe } from "@zfloat/database";
import { createBatch, submitBatch } from "@zfloat/payments-core";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { resolveApprovalRulesForSubmit } from "@/lib/approval-gate";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const rows = await db
    .select()
    .from(schema.paymentBatches)
    .where(eq(schema.paymentBatches.tenantId, user!.tenantId!))
    .orderBy(desc(schema.paymentBatches.createdAt))
    .limit(100);
  return apiOk({ data: toJsonSafe(rows) });
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
  const rawRows = (b.rows ?? []) as Array<Record<string, unknown>>;

  try {
    const batch = await createBatch(db, {
      tenantId: user!.tenantId!,
      actorId: user!.userId,
      name: String(b.name ?? "Bulk upload"),
      channel: String(b.channel ?? "mpesa") as "mpesa" | "till" | "paybill",
      product: String(b.product ?? "bulk_payment") as "bulk_payment" | "payroll" | "airtime",
      rows: rawRows.map((r) => ({
        rowNumber: Number(r.rowNumber),
        recipientName: String(r.recipientName ?? ""),
        phone: String(r.phone ?? ""),
        amountMinor: BigInt(Math.round(Number(r.amount) * 100)),
        reference: r.reference ? String(r.reference) : undefined,
        category: r.category ? String(r.category) : undefined,
      })),
    });

    const policy = await resolveApprovalRulesForSubmit(db, user!.tenantId!);
    if (!policy.ok) return apiError(409, policy.code, policy.message);
    const submitted = await submitBatch(db, { tenantId: user!.tenantId!, batchId: batch.batchId, actorId: user!.userId, policyRules: policy.rules });
    return apiOk({ data: { ...batch, status: submitted.status } }, { status: 201 });
  } catch (err) {
    return apiError(400, "BATCH_FAILED", err instanceof Error ? err.message : "Batch creation failed");
  }
}
