import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db, type Tx } from "@zfloat/database";

export class LedgerError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "LedgerError";
  }
}

export class InsufficientFundsError extends LedgerError {
  constructor(walletId: string) {
    super(`Insufficient available balance on wallet ${walletId}`, "INSUFFICIENT_FUNDS");
  }
}

export class JournalUnbalancedError extends LedgerError {
  constructor(details: string) {
    super(`Journal would be unbalanced: ${details}`, "JOURNAL_UNBALANCED");
  }
}

export class AccountNotFoundError extends LedgerError {
  constructor(code: string) {
    super(`Ledger account not found: ${code}`, "ACCOUNT_NOT_FOUND");
  }
}

/** System chart-of-accounts codes (per tenant). */
export const SYSTEM_CHART = {
  WALLET: "1000", // Cash in wallets (asset) — one ledger account per wallet
  PAYMENT_CLEARING: "1200", // Funds in flight (asset)
  FLOAT_LIABILITY: "2000", // Customer float liabilities
  FEE_REVENUE: "4000", // Fee revenue (revenue)
  PROVIDER_SETTLEMENT: "5000", // Amounts owed to/from providers
} as const;

export interface JournalEntryInput {
  ledgerAccountId: string;
  debitMinor?: bigint;
  creditMinor?: bigint;
  memo?: string;
}

export interface PostJournalInput {
  tenantId: string;
  referenceType: string;
  referenceId: string;
  description: string;
  entries: JournalEntryInput[];
  actorId?: string;
}

/**
 * Ensure the tenant's system chart of accounts + system ledger accounts exist.
 * Idempotent — safe to call on every tenant activation.
 */
export async function ensureSystemChart(db: Db, tenantId: string): Promise<void> {
  const chartDefs: Array<{ code: string; name: string; type: string }> = [
    { code: SYSTEM_CHART.WALLET, name: "Cash — Wallets", type: "ASSET" },
    { code: SYSTEM_CHART.PAYMENT_CLEARING, name: "Payment Clearing", type: "ASSET" },
    { code: SYSTEM_CHART.FLOAT_LIABILITY, name: "Customer Float Liabilities", type: "LIABILITY" },
    { code: SYSTEM_CHART.FEE_REVENUE, name: "Fee Revenue", type: "REVENUE" },
    { code: SYSTEM_CHART.PROVIDER_SETTLEMENT, name: "Provider Settlement", type: "LIABILITY" },
  ];
  await db.transaction(async (tx: Tx) => {
    for (const def of chartDefs) {
      await tx
        .insert(schema.chartOfAccounts)
        .values({ tenantId, code: def.code, name: def.name, type: def.type, isSystem: true })
        .onConflictDoNothing({ target: [schema.chartOfAccounts.tenantId, schema.chartOfAccounts.code] });
    }
    for (const def of chartDefs) {
      await tx
        .insert(schema.ledgerAccounts)
        .values({ tenantId, code: def.code, name: def.name, kind: "SYSTEM", currency: "KES" })
        .onConflictDoNothing({ target: [schema.ledgerAccounts.tenantId, schema.ledgerAccounts.code] });
    }
  });
}

/** Look up a system ledger account by code for a tenant. */
export async function getSystemAccount(db: Db, tenantId: string, code: string) {
  const [row] = await db
    .select()
    .from(schema.ledgerAccounts)
    .where(and(eq(schema.ledgerAccounts.tenantId, tenantId), eq(schema.ledgerAccounts.code, code)))
    .limit(1);
  if (!row) throw new AccountNotFoundError(`${code} (tenant ${tenantId})`);
  return row;
}

/** Get or create the ledger account mirroring a wallet. */
export async function getWalletLedgerAccount(
  db: Db,
  walletId: string,
  tenantId: string,
): Promise<typeof schema.ledgerAccounts.$inferSelect> {
  const [existing] = await db
    .select()
    .from(schema.ledgerAccounts)
    .where(eq(schema.ledgerAccounts.walletId, walletId))
    .limit(1);
  if (existing) return existing;
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.id, walletId)).limit(1);
  if (!wallet || wallet.tenantId !== tenantId) throw new AccountNotFoundError(`wallet ${walletId}`);
  const [created] = await db
    .insert(schema.ledgerAccounts)
    .values({
      tenantId,
      walletId,
      chartAccountId: undefined,
      kind: "WALLET",
      code: `wallet:${walletId}`,
      name: `Wallet — ${wallet.name}`,
      currency: wallet.currency as "KES",
    })
    .onConflictDoNothing()
    .returning();
  return created ?? (await getWalletLedgerAccount(db, walletId, tenantId));
}

/**
 * Post a double-entry journal inside a transaction.
 * Enforces balance in code AND relies on the DB deferred constraint trigger
 * as a second guard. Historic entries are immutable (trigger blocks UPDATE/DELETE).
 */
export async function postJournal(db: Db, input: PostJournalInput): Promise<{ journalId: string }> {
  return db.transaction(async (tx: Tx) => {
    const debitTotal = input.entries.reduce((acc, e) => acc + (e.debitMinor ?? 0n), 0n);
    const creditTotal = input.entries.reduce((acc, e) => acc + (e.creditMinor ?? 0n), 0n);
    if (debitTotal !== creditTotal) {
      throw new JournalUnbalancedError(`debits ${debitTotal} != credits ${creditTotal}`);
    }
    if (debitTotal <= 0n) {
      throw new JournalUnbalancedError("zero-value journal");
    }

    const [journal] = await tx
      .insert(schema.journals)
      .values({
        tenantId: input.tenantId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        description: input.description,
        createdById: input.actorId,
      })
      .returning({ id: schema.journals.id });
    if (!journal) throw new LedgerError("failed to create journal", "JOURNAL_CREATE_FAILED");

    for (const entry of input.entries) {
      const debit = entry.debitMinor ?? 0n;
      const credit = entry.creditMinor ?? 0n;
      if ((debit > 0n) === (credit > 0n)) {
        throw new JournalUnbalancedError("entry must be purely debit or credit");
      }
      await tx.insert(schema.journalEntries).values({
        journalId: journal.id,
        ledgerAccountId: entry.ledgerAccountId,
        debitMinor: debit,
        creditMinor: credit,
        memo: entry.memo,
      });
    }

    // Balance snapshot for the affected accounts (as-of posting time)
    const affected = [...new Set(input.entries.map((e) => e.ledgerAccountId))];
    const accounts = await tx
      .select()
      .from(schema.ledgerAccounts)
      .where(inArray(schema.ledgerAccounts.id, affected));
    for (const acc of accounts) {
      await tx.insert(schema.balanceSnapshots).values({
        ledgerAccountId: acc.id,
        asOf: new Date(),
        balanceMinor: acc.postedBalanceMinor,
      });
    }

    return { journalId: journal.id };
  });
}
