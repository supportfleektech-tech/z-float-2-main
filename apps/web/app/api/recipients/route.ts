
import { getDb, schema, desc, eq } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { normalizeKenyanPhone } from "@zfloat/validation";
import { registerBeneficiary } from "@zfloat/payments-core";
import { loadUserPermissions } from "@zfloat/auth";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const rows = await db
    .select()
    .from(schema.beneficiaries)
    .where(eq(schema.beneficiaries.tenantId, user!.tenantId!))
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

  // Payee-book maker-checker: creating a payee only registers it (PENDING) —
  // an independent approver must activate it in the Approval center before
  // anyone can move funds to it.
  const perms = await loadUserPermissions(db, user!.userId);
  if (!perms.has("recipient.manage")) return apiError(403, "FORBIDDEN", "You do not have recipient management rights");
  try {
    const { beneficiaryId, approvalRequestId } = await registerBeneficiary(db, {
      tenantId: user!.tenantId!,
      createdById: user!.userId,
      type: String(b.type ?? "person"),
      name,
      phone: b.phone ? normalizeKenyanPhone(String(b.phone)) ?? undefined : undefined,
      email: b.email ? String(b.email) : undefined,
      notes: b.notes ? String(b.notes) : undefined,
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
