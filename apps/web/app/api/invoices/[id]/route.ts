/** GET /api/invoices/:id — document + the collections that paid it. */
import { getDb, schema, and, eq, desc } from "@zfloat/database";
import { requireUser, apiError } from "@/lib/api";
import { getDocument } from "@zfloat/etims";
import { jsonOk } from "@/lib/receivables";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const doc = await getDocument(db, user!.tenantId!, params.id);
  if (!doc) return apiError(404, "NOT_FOUND", "Document not found");
  const payments = await db
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.tenantId, user!.tenantId!), eq(schema.collections.invoiceId, doc.id)))
    .orderBy(desc(schema.collections.createdAt));
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return jsonOk({ data: { ...doc, publicUrl: `${base}/r/${doc.publicToken}` }, payments });
}
