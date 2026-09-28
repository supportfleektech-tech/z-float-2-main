/**
 * eTIMS tax invoices & receipts.
 *  GET  /api/invoices?type=INVOICE|RECEIPT|CREDIT_NOTE|PAYMENT_RECEIPT&status=&q=
 *  POST /api/invoices  { docType, customerId? | customer{…}, lines[{description, qty, unitPrice, taxType}], pricesIncludeTax, fiscalise }
 */
import { getDb, schema, and, eq } from "@zfloat/database";
import { requireUser, requirePermission, apiError } from "@/lib/api";
import { createDocument, fiscaliseDocument, listDocuments, getDevice, isTaxType, parseQtyMilli, type LineInput } from "@zfloat/etims";
import { normalizeIdentity, normalizeKenyanPhone } from "@zfloat/validation";
import { jsonOk, parseKesToMinor, readJson, receivablesError } from "@/lib/receivables";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const sp = new URL(request.url).searchParams;
  const { db } = getDb();
  const [rows, device] = await Promise.all([
    listDocuments(db, user!.tenantId!, {
      docType: sp.get("type") || undefined,
      status: sp.get("status") || undefined,
      q: sp.get("q") || undefined,
    }),
    getDevice(db, user!.tenantId!),
  ]);
  return jsonOk({ data: rows, device });
}

export async function POST(request: Request) {
  const { user, response } = await requirePermission("invoices.manage");
  if (response) return response;
  const b = await readJson(request);
  if (!b) return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  const docType = b.docType === "RECEIPT" ? "RECEIPT" : "INVOICE";
  const rawLines = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : [];
  if (rawLines.length === 0) return apiError(400, "LINES_REQUIRED", "Add at least one line item");
  if (rawLines.length > 100) return apiError(400, "TOO_MANY_LINES", "An invoice can have at most 100 lines");

  const lines: LineInput[] = [];
  for (const [i, l] of rawLines.entries()) {
    const description = String(l.description ?? "").trim();
    const unitPriceMinor = parseKesToMinor(l.unitPrice);
    const taxType = String(l.taxType ?? "B").toUpperCase();
    if (!description) return apiError(400, "INVALID_LINE", `Line ${i + 1}: description is required`);
    if (!unitPriceMinor) return apiError(400, "INVALID_LINE", `Line ${i + 1}: enter a valid unit price`);
    if (!isTaxType(taxType)) return apiError(400, "INVALID_LINE", `Line ${i + 1}: tax type must be A, B, C, D or E`);
    let qtyMilli: bigint;
    try {
      qtyMilli = parseQtyMilli(String(l.qty ?? "1"));
    } catch {
      return apiError(400, "INVALID_LINE", `Line ${i + 1}: enter a valid quantity`);
    }
    lines.push({
      description: description.slice(0, 200),
      qtyMilli,
      unitPriceMinor,
      discountMinor: l.discount ? parseKesToMinor(l.discount) ?? 0n : 0n,
      taxType,
      itemCode: l.itemCode ? String(l.itemCode).slice(0, 20) : undefined,
      itemClassCode: l.itemClassCode ? String(l.itemClassCode).slice(0, 10) : undefined,
    });
  }

  const { db } = getDb();
  try {
    // Customer: pick an existing customer or type one in (identity validated either way).
    let customer: Record<string, string | null> = {};
    if (b.customerId) {
      const [c] = await db
        .select()
        .from(schema.customers)
        .where(and(eq(schema.customers.id, String(b.customerId)), eq(schema.customers.tenantId, user!.tenantId!)))
        .limit(1);
      if (!c) return apiError(404, "CUSTOMER_NOT_FOUND", "Customer not found");
      customer = { customerId: c.id, name: c.name, phone: c.phone, email: c.email, kraPin: c.kraPin, idType: c.idType, idNumber: c.idNumber };
    } else if (b.customer && typeof b.customer === "object") {
      const c = b.customer as Record<string, unknown>;
      const identity = normalizeIdentity({ idType: c.idType as string, idNumber: c.idNumber as string, kraPin: c.kraPin as string });
      customer = {
        name: c.name ? String(c.name).trim() : null,
        phone: c.phone ? normalizeKenyanPhone(String(c.phone)) : null,
        email: c.email ? String(c.email).trim() : null,
        ...identity,
      };
    }
    const doc = await createDocument(db, {
      tenantId: user!.tenantId!,
      actorId: user!.userId,
      docType,
      customer,
      lines,
      pricesIncludeTax: b.pricesIncludeTax !== false,
      paymentMethod: b.paymentMethod ? String(b.paymentMethod) : undefined,
      dueAt: b.dueAt ? new Date(String(b.dueAt)) : null,
      notes: b.notes ? String(b.notes).slice(0, 1000) : null,
    });
    if (b.fiscalise === true) {
      try {
        const signed = await fiscaliseDocument(db, { tenantId: user!.tenantId!, documentId: doc.id, actorName: user!.fullName ?? undefined });
        return jsonOk({ data: signed }, { status: 201 });
      } catch (err) {
        // The draft exists; tell the caller why it is not signed yet.
        const [fresh] = await db.select().from(schema.etimsDocuments).where(eq(schema.etimsDocuments.id, doc.id)).limit(1);
        return jsonOk({ data: fresh ?? doc, fiscaliseError: err instanceof Error ? err.message : "eTIMS signing failed" }, { status: 201 });
      }
    }
    return jsonOk({ data: doc }, { status: 201 });
  } catch (err) {
    return receivablesError(err, "Could not create the document");
  }
}
