/**
 * GET /api/documents/:token — public, unauthenticated view of one invoice or
 * receipt (the link/QR a customer receives). The token is 96 random bits;
 * internal ids, raw KRA payloads and the business's device keys are never exposed.
 */
import { getDb, schema, eq } from "@zfloat/database";
import { getDocumentByToken } from "@zfloat/etims";
import { apiError, rateLimit } from "@/lib/api";
import { jsonOk } from "@/lib/receivables";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { token: string } }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
  if (!(await rateLimit(`doc:${ip}`, { windowMs: 60_000, max: 60 }))) return apiError(429, "RATE_LIMITED", "Slow down");
  if (!/^doc_[A-Za-z0-9_-]{10,40}$/.test(params.token)) return apiError(404, "NOT_FOUND", "Document not found");
  const { db } = getDb();
  const doc = await getDocumentByToken(db, params.token);
  if (!doc || doc.status === "DRAFT") return apiError(404, "NOT_FOUND", "Document not found");
  const [tenant] = await db
    .select({ name: schema.tenants.name, kraPin: schema.tenants.kraPin })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, doc.tenantId))
    .limit(1);
  return jsonOk({
    data: {
      docType: doc.docType,
      number: doc.number,
      status: doc.status,
      paymentStatus: doc.paymentStatus,
      issuedAt: doc.signedAt ?? doc.createdAt,
      seller: { name: tenant?.name ?? "", kraPin: tenant?.kraPin ?? null },
      customer: { name: doc.customerName, kraPin: doc.customerKraPin },
      lines: doc.lines,
      taxSummary: doc.taxSummary,
      subtotalMinor: doc.subtotalMinor,
      taxMinor: doc.taxMinor,
      totalMinor: doc.totalMinor,
      paidMinor: doc.paidMinor,
      etims: {
        cuInvoiceNo: doc.cuInvoiceNo,
        receiptSignature: doc.receiptSignature,
        sdcId: doc.sdcId,
        mrcNo: doc.mrcNo,
        invoiceNo: doc.invoiceNo,
        verificationUrl: doc.verificationUrl,
      },
      notes: doc.notes,
      sandbox: doc.sandbox,
    },
  });
}
