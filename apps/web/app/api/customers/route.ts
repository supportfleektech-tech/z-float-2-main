/**
 * Customers (payers / buyers) with full identity: phone + national ID /
 * passport + KRA PIN. The KRA PIN flows onto eTIMS invoices (custTin) so the
 * buyer can claim input VAT.
 *  GET  /api/customers?q=   — search by name, phone, ID number or KRA PIN
 *  POST /api/customers      — create
 */
import { getDb, schema, and, eq, desc } from "@zfloat/database";
import { ilike, or, type SQL } from "drizzle-orm";
import { requireUser, requirePermission, apiError } from "@/lib/api";
import { classifyIdentityQuery, normalizeIdentity, normalizeKenyanPhone, normalizeKraPin } from "@zfloat/validation";
import { jsonOk, readJson, receivablesError } from "@/lib/receivables";

export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const conds: SQL[] = [eq(schema.customers.tenantId, user!.tenantId!)];
  if (q) {
    const kind = classifyIdentityQuery(q);
    const compact = q.toUpperCase().replace(/[\s-]/g, "");
    if (kind === "KRA_PIN") conds.push(eq(schema.customers.kraPin, normalizeKraPin(q) ?? compact));
    else if (kind === "PHONE") conds.push(eq(schema.customers.phone, normalizeKenyanPhone(q) ?? q));
    else if (kind === "ID_NUMBER") conds.push(or(eq(schema.customers.idNumber, compact), ilike(schema.customers.name, `%${q}%`))!);
    else conds.push(or(ilike(schema.customers.name, `%${q}%`), ilike(schema.customers.email, `%${q}%`))!);
  }
  const rows = await db.select().from(schema.customers).where(and(...conds)).orderBy(desc(schema.customers.createdAt)).limit(200);
  return jsonOk({ data: rows });
}

export async function POST(request: Request) {
  const { user, response } = await requirePermission("collections.manage");
  if (response) return response;
  const b = await readJson(request);
  if (!b) return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  const name = String(b.name ?? "").trim();
  if (!name) return apiError(400, "NAME_REQUIRED", "Customer name is required");
  let phone: string | null = null;
  if (b.phone) {
    phone = normalizeKenyanPhone(String(b.phone));
    if (!phone) return apiError(400, "INVALID_PHONE", "Enter a valid Kenyan phone number");
  }
  const { db } = getDb();
  try {
    const identity = normalizeIdentity({ idType: b.idType as string, idNumber: b.idNumber as string, kraPin: b.kraPin as string });
    if (identity.kraPin || identity.idNumber) {
      const dup: SQL[] = [];
      if (identity.kraPin) dup.push(eq(schema.customers.kraPin, identity.kraPin));
      if (identity.idNumber) dup.push(eq(schema.customers.idNumber, identity.idNumber));
      const [existing] = await db
        .select({ id: schema.customers.id, name: schema.customers.name })
        .from(schema.customers)
        .where(and(eq(schema.customers.tenantId, user!.tenantId!), or(...dup)))
        .limit(1);
      if (existing) return apiError(409, "DUPLICATE_IDENTITY", `A customer with this ID/KRA PIN already exists: ${existing.name}`, { existingId: existing.id });
    }
    const [row] = await db
      .insert(schema.customers)
      .values({
        tenantId: user!.tenantId!,
        type: b.type === "business" ? "business" : "individual",
        name,
        phone,
        email: b.email ? String(b.email).trim().toLowerCase() : null,
        address: b.address ? String(b.address) : null,
        notes: b.notes ? String(b.notes) : null,
        ...identity,
        createdById: user!.userId,
      })
      .returning();
    return jsonOk({ data: row }, { status: 201 });
  } catch (err) {
    return receivablesError(err, "Could not create customer");
  }
}
