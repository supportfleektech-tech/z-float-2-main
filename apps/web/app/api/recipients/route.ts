import { getDb, schema, desc, eq } from "@zfloat/database";
import { and, ilike, or, type SQL } from "drizzle-orm";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { normalizeKenyanPhone, normalizeIdentity, IdentityValidationError, classifyIdentityQuery, normalizeKraPin } from "@zfloat/validation";
import { registerBeneficiary } from "@zfloat/payments-core";
import { loadUserPermissions } from "@zfloat/auth";

/**
 * GET /api/recipients?q=… — one search box finds a payee by name, phone,
 * national ID / passport number or KRA PIN.
 */
export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const conds: SQL[] = [eq(schema.beneficiaries.tenantId, user!.tenantId!)];
  if (q) {
    const kind = classifyIdentityQuery(q);
    const compact = q.toUpperCase().replace(/[\s-]/g, "");
    if (kind === "KRA_PIN") conds.push(eq(schema.beneficiaries.kraPin, normalizeKraPin(q) ?? compact));
    else if (kind === "PHONE") conds.push(eq(schema.beneficiaries.phone, normalizeKenyanPhone(q) ?? q));
    else if (kind === "ID_NUMBER")
      conds.push(or(eq(schema.beneficiaries.idNumber, compact), ilike(schema.beneficiaries.name, `%${q}%`))!);
    else conds.push(or(ilike(schema.beneficiaries.name, `%${q}%`), ilike(schema.beneficiaries.email, `%${q}%`))!);
  }
  const rows = await db
    .select()
    .from(schema.beneficiaries)
    .where(and(...conds))
    .orderBy(desc(schema.beneficiaries.createdAt))
    .limit(200);
  return apiOk({ data: rows });
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
  const name = String(b.name ?? "").trim();
  if (!name) return apiError(400, "INVALID_NAME", "Recipient name is required");

  // Identity: ID number + KRA PIN make a payee unambiguous (two "John Otieno"s
  // with shared/recycled phone numbers are common). Optional, but validated.
  let identity;
  try {
    identity = normalizeIdentity({
      idType: b.idType ? String(b.idType) : null,
      idNumber: b.idNumber ? String(b.idNumber) : null,
      kraPin: b.kraPin ? String(b.kraPin) : null,
    });
  } catch (err) {
    if (err instanceof IdentityValidationError) return apiError(400, "INVALID_IDENTITY", err.message, { field: err.field });
    throw err;
  }

  // Payee-book maker-checker: creating a payee only registers it (PENDING) —
  // an independent approver must activate it in the Approval center before
  // anyone can move funds to it.
  const perms = await loadUserPermissions(db, user!.userId);
  if (!perms.has("recipient.manage")) return apiError(403, "FORBIDDEN", "You do not have recipient management rights");

  // Duplicate guard: the same KRA PIN / ID number already on file.
  if (identity.kraPin || identity.idNumber) {
    const dupConds: SQL[] = [];
    if (identity.kraPin) dupConds.push(eq(schema.beneficiaries.kraPin, identity.kraPin));
    if (identity.idNumber) dupConds.push(eq(schema.beneficiaries.idNumber, identity.idNumber));
    const [dupe] = await db
      .select({ id: schema.beneficiaries.id, name: schema.beneficiaries.name })
      .from(schema.beneficiaries)
      .where(and(eq(schema.beneficiaries.tenantId, user!.tenantId!), or(...dupConds)))
      .limit(1);
    if (dupe && b.allowDuplicate !== true) {
      return apiError(409, "DUPLICATE_IDENTITY", `A recipient with this ID/KRA PIN already exists: ${dupe.name}`, { existingId: dupe.id });
    }
  }

  try {
    const { beneficiaryId, approvalRequestId } = await registerBeneficiary(db, {
      tenantId: user!.tenantId!,
      createdById: user!.userId,
      type: String(b.type ?? "person"),
      name,
      phone: b.phone ? normalizeKenyanPhone(String(b.phone)) ?? undefined : undefined,
      email: b.email ? String(b.email) : undefined,
      notes: b.notes ? String(b.notes) : undefined,
      ...identity,
    });
    const [row] = await db
      .select()
      .from(schema.beneficiaries)
      .where(eq(schema.beneficiaries.id, beneficiaryId))
      .limit(1);
    return apiOk({ data: { ...row, approvalRequestId } }, { status: 201 });
  } catch (err) {
    return apiError(400, "CREATE_FAILED", err instanceof Error ? err.message : "Failed to create recipient");
  }
}
