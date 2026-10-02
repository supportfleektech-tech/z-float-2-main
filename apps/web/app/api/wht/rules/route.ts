import { NextRequest } from "next/server";
import { getDb, schema, eq, and, desc, isNull, or } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { writeAuditEvent } from "@zfloat/audit";
import { seedDefaultWhtRules, getWhtRulesForTenant, getGlobalWhtRules, createWhtRuleVersion, type WhtCategory } from "@zfloat/etims";

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  const includeGlobal = request.nextUrl.searchParams.get("includeGlobal") === "true";

  // Get tenant-specific rules
  const tenantRules = await getWhtRulesForTenant(db, user!.tenantId!);

  // Optionally include global rules
  let globalRules: Awaited<ReturnType<typeof getGlobalWhtRules>> = [];
  if (includeGlobal) {
    globalRules = await getGlobalWhtRules(db);
  }

  return apiOk({
    data: {
      tenantRules,
      globalRules,
    },
  });
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

  // Validate required fields
  const category = String(b.category ?? "").toUpperCase();
  const validCategories = ["RENT", "PROFESSIONAL_FEES", "MANAGEMENT_FEES", "CONTRACTS", "ROYALTIES", "INTEREST", "DIVIDENDS", "NON_RESIDENT", "OTHER"];
  if (!validCategories.includes(category)) {
    return apiError(400, "INVALID_CATEGORY", `Category must be one of: ${validCategories.join(", ")}`);
  }

  const rateBps = Number(b.rateBps ?? 0);
  if (rateBps < 0 || rateBps > 10000) {
    return apiError(400, "INVALID_RATE", "Rate must be between 0 and 10000 basis points (0%-100%)");
  }

  const thresholdMinor = BigInt(b.thresholdMinor ?? "0");
  const isResident = Boolean(b.isResident ?? true);
  const effectiveFrom = b.effectiveFrom ? new Date(String(b.effectiveFrom)) : new Date();
  const effectiveTo = b.effectiveTo ? new Date(String(b.effectiveTo)) : null;
  const description = String(b.description ?? "");
  const changeComment = String(b.changeComment ?? "Created via API");
  const status = String(b.status ?? "ACTIVE");

  // Check if rule already exists for this tenant/category/residency/effectiveFrom
  const [existing] = await db
    .select()
    .from(schema.withholdingTaxRules)
    .where(
      and(
        eq(schema.withholdingTaxRules.tenantId, user!.tenantId!),
        eq(schema.withholdingTaxRules.category, category),
        eq(schema.withholdingTaxRules.isResident, isResident),
        eq(schema.withholdingTaxRules.effectiveFrom, effectiveFrom),
      ),
    )
    .limit(1);

  if (existing) {
    return apiError(409, "RULE_EXISTS", "A rule with the same category, residency, and effective date already exists");
  }

  const [rule] = await db
    .insert(schema.withholdingTaxRules)
    .values({
      tenantId: user!.tenantId!,
      category: category as WhtCategory,
      description,
      rateBps,
      thresholdMinor,
      isResident,
      effectiveFrom,
      effectiveTo,
      status: status as "ACTIVE" | "DRAFT" | "DISABLED",
      version: 1,
      changeComment,
      createdById: user!.userId,
    })
    .returning();

  if (!rule) return apiError(500, "CREATE_FAILED", "Failed to create WHT rule");

  await writeAuditEvent(db, {
    tenantId: user!.tenantId!,
    actorId: user!.userId,
    action: "wht_rule.created",
    resourceType: "wht_rule",
    resourceId: rule.id,
    after: rule,
  });

  return apiOk({ data: rule }, { status: 201 });
}