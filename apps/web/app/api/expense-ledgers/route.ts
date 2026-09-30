import { NextRequest } from "next/server";
import { getDb, schema, eq } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const rows = await db
    .select()
    .from(schema.expenseLedgers)
    .where(eq(schema.expenseLedgers.tenantId, user!.tenantId!))
    .orderBy(schema.expenseLedgers.name);
  return apiOk({ data: rows });
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
  const name = String(b.name ?? "").trim();
  const description = b.description ? String(b.description) : null;
  if (!name) return apiError(400, "MISSING_FIELDS", "Ledger name is required");
  if (name.length > 120) return apiError(400, "BAD_NAME", "Ledger name must be 120 characters or fewer");

  const existing = await db
    .select()
    .from(schema.expenseLedgers)
    .where(eq(schema.expenseLedgers.tenantId, user!.tenantId!))
    .orderBy(schema.expenseLedgers.name);
  if (existing.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
    return apiError(409, "DUPLICATE_LEDGER", "A ledger with this name already exists");
  }

  try {
    const [ledger] = await db
      .insert(schema.expenseLedgers)
      .values({ tenantId: user!.tenantId!, name, description })
      .returning();
    return apiOk({ data: ledger }, { status: 201 });
  } catch (err) {
    return apiError(400, "LEDGER_FAILED", err instanceof Error ? err.message : "Failed to create ledger");
  }
}
