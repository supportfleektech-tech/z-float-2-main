/**
 * Reconciliation engine — match provider records against payments and surface
 * exceptions. Statuses per architecture.md:
 * MATCHED | PARTIAL | UNMATCHED | DUPLICATE | UNKNOWN
 */
import { and, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";

export async function runReconciliation(
  db: Db,
  opts: { runId?: string; limit?: number } = {},
): Promise<{ matched: number; exceptions: number }> {
  const items = opts.runId
    ? await db.select().from(schema.reconItems).where(eq(schema.reconItems.runId, opts.runId))
    : await db
        .select()
        .from(schema.reconItems)
        .where(and(eq(schema.reconItems.status, "PENDING"), sql`${schema.reconItems.createdAt} >= now() - interval '30 days'`))
        .limit(opts.limit ?? 500);

  let matched = 0;
  let exceptions = 0;
  for (const item of items) {
    const [payment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.providerReference, item.providerReference))
      .limit(1);

    if (payment && BigInt(payment.amountMinor) === BigInt(item.amountMinor)) {
      await db.insert(schema.reconMatches).values({ itemId: item.id, paymentId: payment.id, matchType: "EXACT" });
      await db.update(schema.reconItems).set({ status: "MATCHED", paymentId: payment.id }).where(eq(schema.reconItems.id, item.id));
      matched += 1;
    } else if (payment) {
      await db.update(schema.reconItems).set({ status: "PARTIAL", paymentId: payment.id }).where(eq(schema.reconItems.id, item.id));
      await db.insert(schema.reconExceptions).values({
        tenantId: item.tenantId,
        itemId: item.id,
        paymentId: payment.id,
        kind: "AMOUNT_MISMATCH",
        severity: "HIGH",
        status: "OPEN",
      });
      exceptions += 1;
    } else {
      await db.update(schema.reconItems).set({ status: "UNMATCHED" }).where(eq(schema.reconItems.id, item.id));
      await db.insert(schema.reconExceptions).values({
        tenantId: item.tenantId,
        itemId: item.id,
        kind: "UNMATCHED",
        severity: "MEDIUM",
        status: "OPEN",
      });
      exceptions += 1;
    }
  }
  return { matched, exceptions };
}

export interface StatementRow {
  providerReference: string;
  amountMinor: bigint;
  occurredAt: Date;
  currency?: string;
}

export interface StatementReconResult {
  runId: string;
  rowsImported: number;
  matched: number;
  unmatched: number;
  partial: number;
  exceptions: number;
}

/**
 * Statement-import reconciliation — ingest provider/bank statement rows
 * (CSV uploads) and match them against tenant payments by provider reference
 * + amount. Unmatched and amount-mismatched rows become recon items with
 * exceptions, exactly like the API-poll path.
 */
export async function reconcileStatement(
  db: Db,
  opts: { tenantId: string; periodStart: Date; periodEnd: Date; rows: StatementRow[]; actorId?: string },
): Promise<StatementReconResult> {
  const [run] = await db
    .insert(schema.reconRuns)
    .values({
      tenantId: opts.tenantId,
      periodStart: opts.periodStart,
      periodEnd: opts.periodEnd,
      source: "PROVIDER_STATEMENT",
      status: "RUNNING",
      createdById: opts.actorId,
    })
    .returning({ id: schema.reconRuns.id });
  const runId = run!.id;

  let matched = 0;
  let unmatched = 0;
  let partial = 0;

  for (const row of opts.rows) {
    const [item] = await db
      .insert(schema.reconItems)
      .values({
        tenantId: opts.tenantId,
        runId,
        source: "PROVIDER_STATEMENT",
        providerReference: row.providerReference,
        amountMinor: row.amountMinor,
        currency: row.currency ?? "KES",
        occurredAt: row.occurredAt,
        status: "PENDING",
      })
      .returning({ id: schema.reconItems.id });

    const [payment] = await db
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.tenantId, opts.tenantId), eq(schema.payments.providerReference, row.providerReference)))
      .limit(1);

    if (payment && BigInt(payment.amountMinor) === row.amountMinor) {
      await db.insert(schema.reconMatches).values({ itemId: item!.id, paymentId: payment.id, matchType: "EXACT" });
      await db.update(schema.reconItems).set({ status: "MATCHED", paymentId: payment.id }).where(eq(schema.reconItems.id, item!.id));
      matched += 1;
    } else if (payment) {
      await db.update(schema.reconItems).set({ status: "PARTIAL", paymentId: payment.id }).where(eq(schema.reconItems.id, item!.id));
      await db.insert(schema.reconExceptions).values({
        tenantId: opts.tenantId,
        itemId: item!.id,
        paymentId: payment.id,
        kind: "AMOUNT_MISMATCH",
        severity: "HIGH",
      });
      partial += 1;
    } else {
      await db.update(schema.reconItems).set({ status: "UNMATCHED" }).where(eq(schema.reconItems.id, item!.id));
      await db.insert(schema.reconExceptions).values({
        tenantId: opts.tenantId,
        itemId: item!.id,
        kind: "UNMATCHED",
        severity: "MEDIUM",
      });
      unmatched += 1;
    }
  }

  await db.update(schema.reconRuns).set({ status: "COMPLETED" }).where(eq(schema.reconRuns.id, runId));
  const exceptions = partial + unmatched;
  return { runId, rowsImported: opts.rows.length, matched, unmatched, partial, exceptions };
}
