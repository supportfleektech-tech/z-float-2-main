/** POST /api/invoices/:id/request-payment { phone? } — STK push for the invoice's outstanding balance. */
import { getDb, schema, and, eq } from "@zfloat/database";
import { requirePermission, apiError } from "@/lib/api";
import { requestStkCollection } from "@zfloat/payments-core";
import { collectionProvider, jsonOk, readJson, receivablesError } from "@/lib/receivables";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requirePermission("collections.manage");
  if (response) return response;
  const b = (await readJson(request)) ?? {};
  const { db } = getDb();
  const [inv] = await db
    .select()
    .from(schema.etimsDocuments)
    .where(and(eq(schema.etimsDocuments.id, params.id), eq(schema.etimsDocuments.tenantId, user!.tenantId!)))
    .limit(1);
  if (!inv) return apiError(404, "NOT_FOUND", "Invoice not found");
  const phone = String(b.phone ?? inv.customerPhone ?? "").trim();
  if (!phone) return apiError(400, "PHONE_REQUIRED", "This customer has no phone number — enter one");
  try {
    const { collection, replayed } = await requestStkCollection(
      db,
      {
        tenantId: user!.tenantId!,
        actorId: user!.userId,
        phone,
        invoiceId: inv.id,
        idempotencyKey: String(request.headers.get("idempotency-key") ?? crypto.randomUUID()),
      },
      collectionProvider(),
    );
    return jsonOk({ data: collection, replayed }, { status: 201 });
  } catch (err) {
    return receivablesError(err, "Could not send the payment request");
  }
}
