/** POST /api/collections/bank — record a bank transfer / cheque received (credits the wallet, pays the invoice). */
import { getDb } from "@zfloat/database";
import { requirePermission, apiError } from "@/lib/api";
import { recordBankCollection } from "@zfloat/payments-core";
import { normalizeIdentity } from "@zfloat/validation";
import { jsonOk, parseKesToMinor, readJson, receivablesError } from "@/lib/receivables";

export async function POST(request: Request) {
  // Recording money you say arrived is a finance action — reconciliation rights, not just collections.
  const { user, response } = await requirePermission("reconciliation.manage");
  if (response) return response;
  const b = await readJson(request);
  if (!b) return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  const amountMinor = parseKesToMinor(b.amount);
  if (!amountMinor) return apiError(400, "INVALID_AMOUNT", "Enter a valid amount in KES");
  const bankReference = String(b.bankReference ?? "").trim();
  if (bankReference.length < 4) return apiError(400, "REFERENCE_REQUIRED", "Enter the bank transaction reference");
  const { db } = getDb();
  try {
    const identity = normalizeIdentity({ idType: b.idType as string, idNumber: b.idNumber as string, kraPin: b.kraPin as string });
    const collection = await recordBankCollection(db, {
      tenantId: user!.tenantId!,
      actorId: user!.userId,
      amountMinor,
      bankReference,
      invoiceId: b.invoiceId ? String(b.invoiceId) : null,
      customerId: b.customerId ? String(b.customerId) : null,
      description: b.description ? String(b.description) : undefined,
      payer: { name: b.payerName ? String(b.payerName) : null, phone: b.payerPhone ? String(b.payerPhone) : null, ...identity },
    });
    return jsonOk({ data: collection }, { status: 201 });
  } catch (err) {
    return receivablesError(err, "Could not record the transfer");
  }
}
