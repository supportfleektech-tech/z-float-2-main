import { NextRequest } from "next/server";
import { getDb, schema, eq, and } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { writeAuditEvent } from "@zfloat/audit";
import { createWhtRuleVersion, type WhtCategory } from "@zfloat/etims";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const { db } = getDb();

  const [rule] = await db
    .select()
    .from(schema.withholdingTaxRules)
    .where(and(eq(schema.withholdingTaxRules.id, id), eq(schema.withholdingTaxRules.tenantId, user!.tenantId!)))
    .limit(1);

  if (!rule) return apiError(404, "NOT_FOUND", "WHT rule not found");

  return apiOk({ data: rule });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const { db } = getDb();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const b = (body ?? {}) as Record<string, unknown>;

  const [existing] = await db
    .select()
    .from(schema.withholdingTaxRules)
    .where(and(eq(schema.withholdingTaxRules.id, id), eq(schema.withholdingTaxRules.tenantId, user!.tenantId!)))
    .for("update")
    .limit(1);

  if (!existing) return apiError(404, "NOT_FOUND", "WHT rule not found");

  // Validate updates
  const category = b.category ? String(b.category).toUpperCase() : existing.category;
  const validCategories = ["RENT", "PROFESSIONAL_FEES", "MANAGEMENT_FEES", "CONTRACTS", "ROYALTIES", "INTEREST", "DIVIDENDS", "NON_RESIDENT", "OTHER"];
  if (!validCategories.includes(category)) {
    return apiError(400, "INVALID_CATEGORY", `Category must be one of: ${validCategories.join(", ")}`);
  }

  const rateBps = b.rateBps !== undefined ? Number(b.rateBps) : existing.rateBps;
  if (rateBps < 0 || rateBps > 10000) {
    return apiError(400, "INVALID_RATE", "Rate must be between 0 and 10000 basis points (0%-100%)");
  }

  const thresholdMinor = b.thresholdMinor !== undefined ? BigInt(String(b.thresholdMinor)) : existing.thresholdMinor;
  const isResident = b.isResident !== undefined ? Boolean(b.isResident) : existing.isResident;
  const effectiveFrom = b.effectiveFrom ? new Date(String(b.effectiveFrom)) : existing.effectiveFrom;
  const effectiveTo = b.effectiveTo ? new Date(String(b.effectiveTo)) : existing.effectiveTo;
  const description = b.description !== undefined ? String(b.description) : existing.description;
  const status = b.status !== undefined ? String(b.status) : existing.status;
  const changeComment = String(b.changeComment ?? "Updated via API");

  // Create version snapshot before updating
  await createWhtRuleVersion(db, id, existing.version + 1, changeComment, user!.userId);

  const [updated] = await db
    .update(schema.withholdingTaxRules)
    .set({
      category: category as WhtCategory,
      description,
      rateBps,
      thresholdMinor,
      isResident,
      effectiveFrom,
      effectiveTo,
      status: status as "ACTIVE" | "DRAFT" | "DISABLED",
      version: existing.version + 1,
      changeComment,
      updatedAt: new Date(),
    })
    .where(eq(schema.withholdingTaxRules.id, id))
    .returning();

  await writeAuditEvent(db, {
    tenantId: user!.tenantId!,
    actorId: user!.userId,
    action: "wht_rule.updated",
    resourceType: "wht_rule",
    resourceId: id,
    before: existing,
    after: updated,
  });

  return apiOk({ data: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const { db } = getDb();

  const [existing] = await db
    .select()
    .from(schema.withholdingTaxRules)
    .where(and(eq(schema.withholdingTaxRules.id, id), eq(schema.withholdingTaxRules.tenantId, user!.tenantId!)))
    .limit(1);

  if (!existing) return apiError(404, "NOT_FOUND", "WHT rule not found");

  await db.delete(schema.withholdingTaxRules).where(eq(schema.withholdingTaxRules.id, id));

  await writeAuditEvent(db, {
    tenantId: user!.tenantId!,
    actorId: user!.userId,
    action: "wht_rule.deleted",
    resourceType: "wht_rule",
    resourceId: id,
    before: existing,
  });

  return apiOk({ data: { success: true } });
}