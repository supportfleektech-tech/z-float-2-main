/**
 * Withholding Tax (WHT) calculation engine for Kenya.
 *
 * Kenya WHT rates (as of Finance Act 2023):
 * - Rent (resident): 5%
 * - Rent (non-resident): 30%
 * - Professional fees (resident): 5%
 * - Professional fees (non-resident): 20%
 * - Management fees (resident): 5%
 * - Management fees (non-resident): 20%
 * - Contracts (resident): 3%
 * - Contracts (non-resident): 20%
 * - Royalties (resident): 5%
 * - Royalties (non-resident): 20%
 * - Interest (resident): 15%
 * - Interest (non-resident): 15%
 * - Dividends (resident): 5%
 * - Dividends (non-resident): 15%
 *
 * Rates are stored as basis points (1% = 100 bps) in the database.
 * This module provides the calculation logic; authoritative rates come from
 * the `withholding_tax_rules` table maintained by platform ops.
 */

import { and, eq, lte, gte, or, isNull, sql } from "drizzle-orm";
import { schema, type Db, type Tx } from "@zfloat/database";
import { parseMinor } from "@zfloat/money";

/** WHT categories matching the database enum */
export const WHT_CATEGORIES = [
  "RENT",
  "PROFESSIONAL_FEES",
  "MANAGEMENT_FEES",
  "CONTRACTS",
  "ROYALTIES",
  "INTEREST",
  "DIVIDENDS",
  "NON_RESIDENT",
  "OTHER",
] as const;
export type WhtCategory = (typeof WHT_CATEGORIES)[number];

export const WHT_CATEGORY_LABELS: Record<WhtCategory, string> = {
  RENT: "Rent",
  PROFESSIONAL_FEES: "Professional Fees",
  MANAGEMENT_FEES: "Management Fees",
  CONTRACTS: "Contracts",
  ROYALTIES: "Royalties",
  INTEREST: "Interest",
  DIVIDENDS: "Dividends",
  NON_RESIDENT: "Non-Resident (Catch-all)",
  OTHER: "Other",
};

/** Default Kenya WHT rates in basis points (for reference/seeding) */
export const DEFAULT_KENYA_WHT_RATES: Record<WhtCategory, { resident: number; nonResident: number }> = {
  RENT: { resident: 500, nonResident: 3000 },
  PROFESSIONAL_FEES: { resident: 500, nonResident: 2000 },
  MANAGEMENT_FEES: { resident: 500, nonResident: 2000 },
  CONTRACTS: { resident: 300, nonResident: 2000 },
  ROYALTIES: { resident: 500, nonResident: 2000 },
  INTEREST: { resident: 1500, nonResident: 1500 },
  DIVIDENDS: { resident: 500, nonResident: 1500 },
  NON_RESIDENT: { resident: 0, nonResident: 2000 },
  OTHER: { resident: 0, nonResident: 0 },
};

/** Threshold in minor units (KES 24,000 = 24,000.00) below which WHT doesn't apply for some categories */
export const DEFAULT_WHT_THRESHOLD_MINOR = 2_400_000n; // KES 24,000

export interface WhtRule {
  id: string;
  tenantId: string | null;
  category: WhtCategory;
  rateBps: number;
  thresholdMinor: bigint;
  isResident: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface WhtCalculationInput {
  tenantId: string;
  category: WhtCategory;
  grossAmountMinor: bigint;
  isResident: boolean;
  paymentDate?: Date;
}

export interface WhtCalculationResult {
  applicable: boolean;
  category: WhtCategory;
  grossAmountMinor: bigint;
  rateBps: number;
  whtAmountMinor: bigint;
  netAmountMinor: bigint;
  rule: WhtRule | null;
  reason?: string;
}

export class WhtCalculationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "WhtCalculationError";
  }
}

/**
 * Calculate WHT for a payment based on the tenant's configured rules.
 * Falls back to default Kenya rates if no tenant-specific rule exists.
 */
export async function calculateWht(
  db: Db | Tx,
  input: WhtCalculationInput,
): Promise<WhtCalculationResult> {
  const { tenantId, category, grossAmountMinor, isResident, paymentDate = new Date() } = input;

  if (grossAmountMinor <= 0n) {
    throw new WhtCalculationError("Gross amount must be positive", "INVALID_AMOUNT");
  }

  // Find the applicable rule for this tenant, category, residency, and date
  const rule = await findApplicableRule(db, tenantId, category, isResident, paymentDate);

  if (!rule) {
    return {
      applicable: false,
      category,
      grossAmountMinor,
      rateBps: 0,
      whtAmountMinor: 0n,
      netAmountMinor: grossAmountMinor,
      rule: null,
      reason: "No applicable WHT rule found",
    };
  }

  // Check threshold
  if (grossAmountMinor < rule.thresholdMinor) {
    return {
      applicable: false,
      category,
      grossAmountMinor,
      rateBps: rule.rateBps,
      whtAmountMinor: 0n,
      netAmountMinor: grossAmountMinor,
      rule,
      reason: `Amount below threshold (${formatMinor(rule.thresholdMinor)})`,
    };
  }

  // Calculate WHT: (gross * rateBps) / 10000
  const whtAmountMinor = (grossAmountMinor * BigInt(rule.rateBps)) / 10000n;
  const netAmountMinor = grossAmountMinor - whtAmountMinor;

  return {
    applicable: true,
    category,
    grossAmountMinor,
    rateBps: rule.rateBps,
    whtAmountMinor,
    netAmountMinor,
    rule,
  };
}

/**
 * Find the applicable WHT rule for a tenant/category/residency/date combination.
 * Priority: tenant-specific rule > global (tenantId=null) rule.
 * Within same priority: most recent effectiveFrom <= paymentDate.
 */
async function findApplicableRule(
  db: Db | Tx,
  tenantId: string,
  category: WhtCategory,
  isResident: boolean,
  paymentDate: Date,
): Promise<WhtRule | null> {
  // First try tenant-specific rules
  const tenantRules = await db
    .select()
    .from(schema.withholdingTaxRules)
    .where(
      and(
        eq(schema.withholdingTaxRules.tenantId, tenantId),
        eq(schema.withholdingTaxRules.category, category),
        eq(schema.withholdingTaxRules.isResident, isResident),
        eq(schema.withholdingTaxRules.status, "ACTIVE"),
        lte(schema.withholdingTaxRules.effectiveFrom, paymentDate),
        or(isNull(schema.withholdingTaxRules.effectiveTo), gte(schema.withholdingTaxRules.effectiveTo, paymentDate)),
      ),
    )
    .orderBy(sql`${schema.withholdingTaxRules.effectiveFrom} DESC`)
    .limit(1);

  if (tenantRules.length > 0) {
    return mapRule(tenantRules[0]!);
  }

  // Fall back to global rules (tenantId = null)
  const globalRules = await db
    .select()
    .from(schema.withholdingTaxRules)
    .where(
      and(
        isNull(schema.withholdingTaxRules.tenantId),
        eq(schema.withholdingTaxRules.category, category),
        eq(schema.withholdingTaxRules.isResident, isResident),
        eq(schema.withholdingTaxRules.status, "ACTIVE"),
        lte(schema.withholdingTaxRules.effectiveFrom, paymentDate),
        or(isNull(schema.withholdingTaxRules.effectiveTo), gte(schema.withholdingTaxRules.effectiveTo, paymentDate)),
      ),
    )
    .orderBy(sql`${schema.withholdingTaxRules.effectiveFrom} DESC`)
    .limit(1);

  if (globalRules.length > 0) {
    return mapRule(globalRules[0]!);
  }

  return null;
}

function mapRule(row: typeof schema.withholdingTaxRules.$inferSelect): WhtRule {
  return {
    id: row.id,
    tenantId: row.tenantId,
    category: row.category as WhtCategory,
    rateBps: row.rateBps,
    thresholdMinor: row.thresholdMinor,
    isResident: row.isResident,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

/** Format minor units as KES string for error messages */
function formatMinor(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  return `${neg ? "-" : ""}KES ${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/**
 * Auto-detect WHT category from payment category/description.
 * This is a heuristic — the caller should override if needed.
 */
export function detectWhtCategory(paymentCategory?: string, description?: string): WhtCategory | null {
  const text = `${paymentCategory ?? ""} ${description ?? ""}`.toLowerCase();

  if (text.includes("rent") || text.includes("lease")) return "RENT";
  if (text.includes("professional") || text.includes("consult") || text.includes("legal") || text.includes("account")) return "PROFESSIONAL_FEES";
  if (text.includes("management") || text.includes("director") || text.includes("advisory")) return "MANAGEMENT_FEES";
  if (text.includes("contract") || text.includes("construction") || text.includes("supply") || text.includes("service contract")) return "CONTRACTS";
  if (text.includes("royalt") || text.includes("license") || text.includes("ip ")) return "ROYALTIES";
  if (text.includes("interest") || text.includes("loan") || text.includes("lending")) return "INTEREST";
  if (text.includes("dividend") || text.includes("share") || text.includes("distribution")) return "DIVIDENDS";

  return null;
}

/**
 * Get all active WHT rules for a tenant (for admin UI)
 */
export async function getWhtRulesForTenant(db: Db, tenantId: string): Promise<WhtRule[]> {
  const rows = await db
    .select()
    .from(schema.withholdingTaxRules)
    .where(and(eq(schema.withholdingTaxRules.tenantId, tenantId), eq(schema.withholdingTaxRules.status, "ACTIVE")))
    .orderBy(schema.withholdingTaxRules.category, schema.withholdingTaxRules.effectiveFrom);

  return rows.map(mapRule);
}

/**
 * Get global WHT rules (platform defaults)
 */
export async function getGlobalWhtRules(db: Db): Promise<WhtRule[]> {
  const rows = await db
    .select()
    .from(schema.withholdingTaxRules)
    .where(and(isNull(schema.withholdingTaxRules.tenantId), eq(schema.withholdingTaxRules.status, "ACTIVE")))
    .orderBy(schema.withholdingTaxRules.category, schema.withholdingTaxRules.effectiveFrom);

  return rows.map(mapRule);
}

/**
 * Seed default Kenya WHT rules for a tenant (or globally if tenantId is null)
 */
export async function seedDefaultWhtRules(
  db: Db,
  input: { tenantId?: string | null; actorId: string; effectiveFrom?: Date },
): Promise<void> {
  const effectiveFrom = input.effectiveFrom ?? new Date("2024-01-01");
  const rules = Object.entries(DEFAULT_KENYA_WHT_RATES).flatMap(([category, rates]) => [
    {
      tenantId: input.tenantId,
      category: category as WhtCategory,
      description: `Default Kenya WHT rate for ${WHT_CATEGORY_LABELS[category as WhtCategory]} (resident)`,
      rateBps: rates.resident,
      thresholdMinor: category === "INTEREST" || category === "DIVIDENDS" ? 0n : DEFAULT_WHT_THRESHOLD_MINOR,
      isResident: true,
      effectiveFrom,
      status: "ACTIVE" as const,
      version: 1,
      changeComment: "Seeded default Kenya WHT rates",
      createdById: input.actorId,
    },
    {
      tenantId: input.tenantId,
      category: category as WhtCategory,
      description: `Default Kenya WHT rate for ${WHT_CATEGORY_LABELS[category as WhtCategory]} (non-resident)`,
      rateBps: rates.nonResident,
      thresholdMinor: 0n,
      isResident: false,
      effectiveFrom,
      status: "ACTIVE" as const,
      version: 1,
      changeComment: "Seeded default Kenya WHT rates",
      createdById: input.actorId,
    },
  ]);

  await db
    .insert(schema.withholdingTaxRules)
    .values(rules)
    .onConflictDoNothing({ target: [schema.withholdingTaxRules.tenantId, schema.withholdingTaxRules.category, schema.withholdingTaxRules.effectiveFrom] });
}

/** Create a new version snapshot when a rule is updated */
export async function createWhtRuleVersion(
  tx: Tx,
  ruleId: string,
  version: number,
  changeComment: string,
  actorId: string,
): Promise<void> {
  const [rule] = await tx
    .select()
    .from(schema.withholdingTaxRules)
    .where(eq(schema.withholdingTaxRules.id, ruleId))
    .limit(1);

  if (!rule) throw new WhtCalculationError("WHT rule not found", "RULE_NOT_FOUND");

  await tx.insert(schema.withholdingTaxRuleVersions).values({
    ruleId,
    version,
    snapshot: {
      category: rule.category,
      rateBps: rule.rateBps,
      thresholdMinor: rule.thresholdMinor.toString(),
      isResident: rule.isResident,
      effectiveFrom: rule.effectiveFrom.toISOString(),
      effectiveTo: rule.effectiveTo?.toISOString() ?? null,
      status: rule.status,
    },
    changeComment,
    createdById: actorId,
  });
}