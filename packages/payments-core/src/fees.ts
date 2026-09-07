/**
 * Admin-configurable fee engine.
 *
 * Fee rules live in the DB (fee_rules) — NEVER hard-coded in payment code.
 * The exact rule that applied is snapshotted into fee_calculations so past
 * transactions keep their historical fee even if pricing changes later.
 */
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { schema, toJsonSafe, type Db, type Tx } from "@zfloat/database";
import { Money, parseMinor } from "@zfloat/money";

export interface FeeContext {
  tenantId: string;
  product: string;
  channel: string;
  providerCode: string;
}

export interface FeeResult {
  feeMinor: bigint;
  ruleId?: string;
  ruleSnapshot: Record<string, unknown>;
  currency: "KES";
}

export async function findFeeRule(db: Db, ctx: FeeContext) {
  const now = new Date();
  const rows = await db
    .select()
    .from(schema.feeRules)
    .where(
      and(
        eq(schema.feeRules.product, ctx.product),
        eq(schema.feeRules.channel, ctx.channel),
        eq(schema.feeRules.provider, ctx.providerCode),
        eq(schema.feeRules.status, "ACTIVE"),
        or(
          isNull(schema.feeRules.effectiveFrom),
          lte(schema.feeRules.effectiveFrom, now),
        ),
        or(isNull(schema.feeRules.effectiveTo), gte(schema.feeRules.effectiveTo, now)),
        or(eq(schema.feeRules.tenantId, ctx.tenantId), isNull(schema.feeRules.tenantId)),
      ),
    )
    .orderBy(schema.feeRules.createdAt)
    .limit(1);
  return rows[0] ?? null;
}

/** Compute the fee for an amount using the first matching active rule. */
export async function computeFee(db: Db, amountMinor: bigint, ctx: FeeContext): Promise<FeeResult> {
  const rule = await findFeeRule(db, ctx);
  if (!rule) {
    return {
      feeMinor: 0n,
      ruleSnapshot: { source: "no-rule" },
      currency: "KES",
    };
  }

  const amount = Money.fromMinor(amountMinor, "KES");
  let fee = Money.fromMinor(rule.flatFeeMinor, "KES").add(
    amount.percentFloor(BigInt(rule.percentBps)),
  );
  if (rule.minFeeMinor > 0n && fee.minor < BigInt(rule.minFeeMinor)) {
    fee = Money.fromMinor(rule.minFeeMinor, "KES");
  }
  if (rule.maxFeeMinor > 0n && fee.minor > BigInt(rule.maxFeeMinor)) {
    fee = Money.fromMinor(rule.maxFeeMinor, "KES");
  }

  const snapshot = toJsonSafe({
    ruleId: rule.id,
    product: rule.product,
    channel: rule.channel,
    provider: rule.provider,
    flatFeeMinor: rule.flatFeeMinor,
    percentBps: rule.percentBps,
    minFeeMinor: rule.minFeeMinor,
    maxFeeMinor: rule.maxFeeMinor,
    currency: rule.currency,
    version: rule.version,
    effectiveFrom: rule.effectiveFrom?.toISOString(),
    effectiveTo: rule.effectiveTo?.toISOString(),
  }) as Record<string, unknown>;

  return { feeMinor: fee.minor, ruleId: rule.id, ruleSnapshot: snapshot, currency: "KES" };
}

/** Persist the fee calculation snapshot (called inside the payment tx). */
export async function recordFeeCalculation(
  tx: Tx,
  input: { tenantId: string; paymentId: string; amountMinor: bigint; fee: FeeResult },
): Promise<void> {
  await tx.insert(schema.feeCalculations).values({
    tenantId: input.tenantId,
    paymentId: input.paymentId,
    ruleId: input.fee.ruleId,
    amountMinor: input.amountMinor,
    feeMinor: input.fee.feeMinor,
    currency: input.fee.currency,
    ruleSnapshot: input.fee.ruleSnapshot,
  });
}

/** Parse the stored snapshot back for display/audit. */
export function snapshotToDecimalString(snapshot: Record<string, unknown>, key: string): string {
  const v = snapshot[key];
  return typeof v === "string" ? minorToDecimal(v) : "0.00";
}

function minorToDecimal(v: string): string {
  const minor = parseMinor(v);
  return Money.fromMinor(minor).toDecimalString();
}
