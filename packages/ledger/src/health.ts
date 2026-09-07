/**
 * Ledger health — periodic double-entry invariant verification.
 * Checks, per tenant, that every journal balances (debits = credits) and that
 * the global debits/credits sums net to zero. Surfaces imbalances instead of
 * silently absorbing them (worker housekeeping writes audit events on failure).
 */
import { sql, eq } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";

export interface TenantLedgerHealth {
  tenantId: string;
  journalsChecked: number;
  unbalancedJournals: number;
  totalDebitMinor: bigint;
  totalCreditMinor: bigint;
  netZero: boolean;
  healthy: boolean;
}

/** Verify double-entry invariants per tenant. Pass tenantId to check a single tenant. */
export async function checkLedgerHealth(db: Db, tenantId?: string): Promise<TenantLedgerHealth[]> {
  const base = db
    .select({
      journalId: schema.journalEntries.journalId,
      tenantId: schema.journals.tenantId,
      debit: sql<bigint>`sum(${schema.journalEntries.debitMinor})`,
      credit: sql<bigint>`sum(${schema.journalEntries.creditMinor})`,
    })
    .from(schema.journalEntries)
    .innerJoin(schema.journals, eq(schema.journals.id, schema.journalEntries.journalId));

  const rows = tenantId
    ? await base.where(eq(schema.journals.tenantId, tenantId)).groupBy(schema.journalEntries.journalId, schema.journals.tenantId)
    : await base.groupBy(schema.journalEntries.journalId, schema.journals.tenantId);

  const byTenant = new Map<string, { journals: number; unbalanced: number; debit: bigint; credit: bigint }>();
  for (const r of rows) {
    const d = BigInt(String(r.debit ?? 0));
    const c = BigInt(String(r.credit ?? 0));
    const t = byTenant.get(r.tenantId) ?? { journals: 0, unbalanced: 0, debit: 0n, credit: 0n };
    t.journals += 1;
    if (d !== c) t.unbalanced += 1;
    t.debit += d;
    t.credit += c;
    byTenant.set(r.tenantId, t);
  }

  return [...byTenant.entries()].map(([tid, t]) => ({
    tenantId: tid,
    journalsChecked: t.journals,
    unbalancedJournals: t.unbalanced,
    totalDebitMinor: t.debit,
    totalCreditMinor: t.credit,
    netZero: t.debit === t.credit,
    healthy: t.unbalanced === 0 && t.debit === t.credit,
  }));
}
