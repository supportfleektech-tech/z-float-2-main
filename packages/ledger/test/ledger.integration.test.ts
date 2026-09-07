/**
 * Ledger integration tests — run against a real PostgreSQL test database.
 * Prereqs: `pnpm db:migrate:test` (applies migrations to the test DB).
 * These prove the absolute financial-correctness rules:
 *  - journals must balance (code + DB trigger)
 *  - reservations are atomic (no double-spend)
 *  - historic entries are immutable
 *  - funding/success/reversal journals move money correctly
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, schema, type Db } from "@zfloat/database";
import {
  ensureSystemChart,
  getWalletLedgerAccount,
  getSystemAccount,
  postJournal,
  JournalUnbalancedError,
  InsufficientFundsError,
  reserveFunds,
  releaseReservation,
  applyReservation,
  getWalletBalance,
  recordWalletFunding,
  listWalletLedgerEntries,
  countDeniedReservations,
  postFundingJournal,
  postPaymentSuccessJournal,
  postReversalJournal,
  SYSTEM_CHART,
  checkLedgerHealth,
} from "../src/index.js";

let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
let TENANT = "00000000-0000-0000-0000-000000000001"; // replaced in beforeAll

async function clean() {
  await pool.query(`
  TRUNCATE journal_entries, journals, ledger_accounts, chart_of_accounts, wallets,
           wallet_reservations, wallet_ledger_entries, balance_snapshots, funding_events,
           payments, beneficiaries, tenants
    CASCADE
  `);
}

async function makeWallet(name = "Main Wallet") {
  const [wallet] = await db
    .insert(schema.wallets)
    .values({ tenantId: TENANT, name, currency: "KES" })
    .returning();
  return wallet!;
}

async function makePayment(walletId: string, amountMinor: bigint) {
  const [payment] = await db
    .insert(schema.payments)
    .values({
      tenantId: TENANT,
      paymentNumber: `ZF-TEST-${crypto.randomUUID().slice(0, 8)}`,
      channel: "mpesa",
      amountMinor,
      totalMinor: amountMinor,
      beneficiarySnapshot: { name: "Test Beneficiary", phone: "+254712345678" },
      sourceWalletId: walletId,
    })
    .returning();
  return payment!;
}

async function fundWallet(walletId: string, amountMinor: bigint) {
  await db
    .update(schema.wallets)
    .set({ availableMinor: sql`${schema.wallets.availableMinor} + ${amountMinor}` })
    .where(eq(schema.wallets.id, walletId));
  await postFundingJournal(db, { tenantId: TENANT, walletId, amountMinor });
}

beforeEach(async () => {
  ({ db, pool } = createDb());
  await clean();
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: "Ledger Test Co", slug: `ledger-test-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`, status: "ACTIVE" })
    .returning({ id: schema.tenants.id });
  TENANT = tenant!.id;
  await ensureSystemChart(db, TENANT);
});

afterAll(async () => {
  await clean();
  await pool.end();
});

describe("journal posting", () => {
  it("posts a balanced journal and updates account balances via trigger", async () => {
    const wallet = await makeWallet();
    const walletAcc = await getWalletLedgerAccount(db, wallet.id, TENANT);
    const clearing = await getSystemAccount(db, TENANT, SYSTEM_CHART.PAYMENT_CLEARING);

    await postJournal(db, {
      tenantId: TENANT,
      referenceType: "test",
      referenceId: crypto.randomUUID(),
      description: "balanced test journal",
      entries: [
        { ledgerAccountId: clearing.id, debitMinor: 500n },
        { ledgerAccountId: walletAcc.id, creditMinor: 500n },
      ],
    });

    const [clearingNow] = await db
      .select()
      .from(schema.ledgerAccounts)
      .where(eq(schema.ledgerAccounts.id, clearing.id));
    expect(clearingNow!.postedBalanceMinor).toBe(500n);
  });

  it("rejects an unbalanced journal in code", async () => {
    const wallet = await makeWallet();
    const walletAcc = await getWalletLedgerAccount(db, wallet.id, TENANT);
    const clearing = await getSystemAccount(db, TENANT, SYSTEM_CHART.PAYMENT_CLEARING);
    await expect(
      postJournal(db, {
        tenantId: TENANT,
        referenceType: "test",
        referenceId: crypto.randomUUID(),
        description: "unbalanced",
        entries: [
          { ledgerAccountId: clearing.id, debitMinor: 500n },
          { ledgerAccountId: walletAcc.id, creditMinor: 400n },
        ],
      }),
    ).rejects.toBeInstanceOf(JournalUnbalancedError);
  });

  it("DB trigger also rejects unbalanced journals even if code guard is bypassed", async () => {
    const wallet = await makeWallet();
    const walletAcc = await getWalletLedgerAccount(db, wallet.id, TENANT);
    const clearing = await getSystemAccount(db, TENANT, SYSTEM_CHART.PAYMENT_CLEARING);
    const [journal] = await db
      .insert(schema.journals)
      .values({ tenantId: TENANT, referenceType: "test", referenceId: crypto.randomUUID(), description: "bypass" })
      .returning();
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(schema.journalEntries).values([
          { journalId: journal!.id, ledgerAccountId: clearing.id, debitMinor: 100n },
          { journalId: journal!.id, ledgerAccountId: walletAcc.id, creditMinor: 50n },
        ]);
      }),
    ).rejects.toThrow(/unbalanced/i);
  });

  it("journal entries are immutable (no UPDATE/DELETE)", async () => {
    const wallet = await makeWallet();
    const walletAcc = await getWalletLedgerAccount(db, wallet.id, TENANT);
    const clearing = await getSystemAccount(db, TENANT, SYSTEM_CHART.PAYMENT_CLEARING);
    const { journalId } = await postJournal(db, {
      tenantId: TENANT,
      referenceType: "test",
      referenceId: crypto.randomUUID(),
      description: "immutability",
      entries: [
        { ledgerAccountId: clearing.id, debitMinor: 10n },
        { ledgerAccountId: walletAcc.id, creditMinor: 10n },
      ],
    });
    const [entry] = await db
      .select()
      .from(schema.journalEntries)
      .where(eq(schema.journalEntries.journalId, journalId))
      .limit(1);
    await expect(
      db.update(schema.journalEntries).set({ debitMinor: 999n }).where(eq(schema.journalEntries.id, entry!.id)),
    ).rejects.toThrow();
    await expect(
      db.delete(schema.journalEntries).where(eq(schema.journalEntries.id, entry!.id)),
    ).rejects.toThrow();
  });
});

describe("wallet reservations", () => {
  it("reserves atomically and cannot double-spend", async () => {
    const wallet = await makeWallet("Reserve Wallet");
    await fundWallet(wallet.id, 1000n);

    const first = await reserveFunds(db, {
      tenantId: TENANT,
      paymentId: (await makePayment(wallet.id, 800n)).id,
      walletId: wallet.id,
      amountMinor: 800n,
    });
    expect(first.balanceAfter.availableMinor).toBe(200n);
    expect(first.balanceAfter.reservedMinor).toBe(800n);

    // Second reservation of 300 exceeds available 200 -> must fail
    await expect(
      reserveFunds(db, {
        tenantId: TENANT,
        paymentId: (await makePayment(wallet.id, 300n)).id,
        walletId: wallet.id,
        amountMinor: 300n,
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    const balance = await getWalletBalance(db, wallet.id, TENANT);
    expect(balance.availableMinor).toBe(200n);
    expect(balance.reservedMinor).toBe(800n);
  });

  it("releases a reservation back to available", async () => {
    const wallet = await makeWallet("Release Wallet");
    await fundWallet(wallet.id, 1000n);
    const { reservationId } = await reserveFunds(db, {
      tenantId: TENANT,
      paymentId: (await makePayment(wallet.id, 400n)).id,
      walletId: wallet.id,
      amountMinor: 400n,
    });
    await releaseReservation(db, reservationId);
    const balance = await getWalletBalance(db, wallet.id, TENANT);
    expect(balance.availableMinor).toBe(1000n);
    expect(balance.reservedMinor).toBe(0n);
    // releasing twice is idempotent
    await releaseReservation(db, reservationId);
  });

  it("applies a reservation on success", async () => {
    const wallet = await makeWallet("Apply Wallet");
    await fundWallet(wallet.id, 1000n);
    const { reservationId } = await reserveFunds(db, {
      tenantId: TENANT,
      paymentId: (await makePayment(wallet.id, 600n)).id,
      walletId: wallet.id,
      amountMinor: 600n,
    });
    await applyReservation(db, reservationId);
    const balance = await getWalletBalance(db, wallet.id, TENANT);
    expect(balance.availableMinor).toBe(400n);
    expect(balance.reservedMinor).toBe(0n);
  });
});

describe("payment lifecycle journals", () => {
  it("success journal: clearing = principal + fee; wallet = principal; fee revenue = fee", async () => {
    const wallet = await makeWallet("Lifecycle Wallet");
    await fundWallet(wallet.id, 10_000n);
    const paymentId = crypto.randomUUID();

    await postPaymentSuccessJournal(db, {
      tenantId: TENANT,
      paymentId,
      walletId: wallet.id,
      amountMinor: 9_500n,
      feeMinor: 500n,
    });

    const clearing = await getSystemAccount(db, TENANT, SYSTEM_CHART.PAYMENT_CLEARING);
    const feeRevenue = await getSystemAccount(db, TENANT, SYSTEM_CHART.FEE_REVENUE);
    const walletAcc = await getWalletLedgerAccount(db, wallet.id, TENANT);

    expect(clearing.postedBalanceMinor).toBe(10_000n);
    expect(feeRevenue.postedBalanceMinor).toBe(-500n); // revenue accounts increase on credit
    // wallet account: +10,000 funding (debit) then -9,500 payment (credit)
    expect(walletAcc.postedBalanceMinor).toBe(500n);
  });

  it("reversal journal returns principal to the wallet", async () => {
    const wallet = await makeWallet("Reversal Wallet");
    await fundWallet(wallet.id, 5_000n);
    const paymentId = crypto.randomUUID();
    await postPaymentSuccessJournal(db, {
      tenantId: TENANT,
      paymentId,
      walletId: wallet.id,
      amountMinor: 3_000n,
      feeMinor: 100n,
    });
    await postReversalJournal(db, {
      tenantId: TENANT,
      paymentId,
      walletId: wallet.id,
      amountMinor: 3_000n,
    });
    const walletAcc = await getWalletLedgerAccount(db, wallet.id, TENANT);
    // funding +5000, success -3000, reversal +3000 => +5000
    expect(walletAcc.postedBalanceMinor).toBe(5_000n);
  });
});

describe("ledger health check", () => {
  it("reports the tenant ledger healthy after balanced posting", async () => {
    const wallet = await makeWallet();
    await fundWallet(wallet.id, 5000n);

    const results = await checkLedgerHealth(db, TENANT);
    expect(results.length).toBe(1);
    expect(results[0].tenantId).toBe(TENANT);
    expect(results[0].unbalancedJournals).toBe(0);
    expect(results[0].netZero).toBe(true);
    expect(results[0].healthy).toBe(true);
    expect(results[0].totalDebitMinor).toBe(results[0].totalCreditMinor);
  });

  it("returns an empty list for a tenant with no journals", async () => {
    const results = await checkLedgerHealth(db, TENANT);
    expect(results).toEqual([]);
  });

  it("aggregates across all tenants when no tenant is given", async () => {
    const wallet = await makeWallet();
    await fundWallet(wallet.id, 3000n);
    const results = await checkLedgerHealth(db);
    const ours = results.find((r) => r.tenantId === TENANT);
    expect(ours).toBeDefined();
    expect(ours!.healthy).toBe(true);
  });
});

describe("C-3 wallet reservation ledger", () => {
  async function creditWallet(walletId: string, amountMinor: bigint) {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.wallets)
        .set({ availableMinor: sql`${schema.wallets.availableMinor} + ${amountMinor}` })
        .where(eq(schema.wallets.id, walletId));
      await recordWalletFunding(tx, {
        tenantId: TENANT,
        walletId,
        refType: "funding",
        refId: crypto.randomUUID(),
        amountMinor,
        note: "test credit",
      });
    });
  }

  it("records a FUND entry with exact balance-after on credit", async () => {
    const wallet = await makeWallet();
    await creditWallet(wallet.id, 1000n);

    const entries = await listWalletLedgerEntries(db, { walletId: wallet.id });
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.entryType).toBe("FUND");
    expect(e.amountMinor).toBe(1000n);
    expect(e.deltaAvailableMinor).toBe(1000n);
    expect(e.deltaReservedMinor).toBe(0n);
    expect(e.availableAfterMinor).toBe(1000n);
    expect(e.reservedAfterMinor).toBe(0n);
    const balance = await getWalletBalance(db, wallet.id, TENANT);
    expect(balance.availableMinor).toBe(e.availableAfterMinor);
  });

  it("writes RESERVE then APPLY for a settled payment, with exact deltas", async () => {
    const wallet = await makeWallet();
    await creditWallet(wallet.id, 1000n);
    const payment = await makePayment(wallet.id, 400n);

    const { reservationId } = await reserveFunds(db, {
      tenantId: TENANT,
      paymentId: payment.id,
      walletId: wallet.id,
      amountMinor: 400n,
    });
    await applyReservation(db, reservationId);

    const entries = await listWalletLedgerEntries(db, { walletId: wallet.id });
    expect(entries.map((e) => e.entryType)).toEqual(["APPLY", "RESERVE", "FUND"]); // newest first
    const reserve = entries[1]!;
    const apply = entries[0]!;
    expect(reserve.deltaAvailableMinor).toBe(-400n);
    expect(reserve.deltaReservedMinor).toBe(400n);
    expect(reserve.availableAfterMinor).toBe(600n);
    expect(reserve.reservedAfterMinor).toBe(400n);
    expect(apply.deltaAvailableMinor).toBe(0n);
    expect(apply.deltaReservedMinor).toBe(-400n);
    expect(apply.availableAfterMinor).toBe(600n);
    expect(apply.reservedAfterMinor).toBe(0n);
    expect(apply.refId).toBe(payment.id);
    // wallet end state
    const balance = await getWalletBalance(db, wallet.id, TENANT);
    expect(balance.availableMinor).toBe(600n);
    expect(balance.reservedMinor).toBe(0n);
  });

  it("writes RESERVE then RELEASE when a payment fails", async () => {
    const wallet = await makeWallet();
    await creditWallet(wallet.id, 1000n);
    const payment = await makePayment(wallet.id, 300n);

    const { reservationId } = await reserveFunds(db, {
      tenantId: TENANT,
      paymentId: payment.id,
      walletId: wallet.id,
      amountMinor: 300n,
    });
    await releaseReservation(db, reservationId);

    const entries = await listWalletLedgerEntries(db, { walletId: wallet.id });
    expect(entries.map((e) => e.entryType)).toEqual(["RELEASE", "RESERVE", "FUND"]);
    expect(entries[0]!.deltaAvailableMinor).toBe(300n);
    expect(entries[0]!.deltaReservedMinor).toBe(-300n);
    expect(entries[0]!.availableAfterMinor).toBe(1000n);
    const balance = await getWalletBalance(db, wallet.id, TENANT);
    expect(balance.availableMinor).toBe(1000n);
    expect(balance.reservedMinor).toBe(0n);
  });

  it("audits a denied (double-spend) attempt with zero deltas and unchanged wallet", async () => {
    const wallet = await makeWallet();
    await creditWallet(wallet.id, 100n);
    const payment = await makePayment(wallet.id, 200n);

    await expect(
      reserveFunds(db, {
        tenantId: TENANT,
        paymentId: payment.id,
        walletId: wallet.id,
        amountMinor: 200n,
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    expect(await countDeniedReservations(db, wallet.id)).toBe(1);
    const entries = await listWalletLedgerEntries(db, { walletId: wallet.id });
    expect(entries.map((e) => e.entryType)).toEqual(["RESERVE_DENIED", "FUND"]);
    const denied = entries[0]!;
    expect(denied.deltaAvailableMinor).toBe(0n);
    expect(denied.deltaReservedMinor).toBe(0n);
    expect(denied.amountMinor).toBe(200n);
    expect(denied.refId).toBe(payment.id);
    expect(denied.availableAfterMinor).toBe(100n);
    const balance = await getWalletBalance(db, wallet.id, TENANT);
    expect(balance.availableMinor).toBe(100n);
    expect(balance.reservedMinor).toBe(0n);
  });

  it("parallel reservations on the same funds: exactly one wins, loser is audited", async () => {
    const wallet = await makeWallet();
    await creditWallet(wallet.id, 1000n);
    const p1 = await makePayment(wallet.id, 800n);
    const p2 = await makePayment(wallet.id, 800n);

    const results = await Promise.allSettled([
      reserveFunds(db, { tenantId: TENANT, paymentId: p1.id, walletId: wallet.id, amountMinor: 800n }),
      reserveFunds(db, { tenantId: TENANT, paymentId: p2.id, walletId: wallet.id, amountMinor: 800n }),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const entries = await listWalletLedgerEntries(db, { walletId: wallet.id });
    expect(entries.filter((e) => e.entryType === "RESERVE")).toHaveLength(1);
    expect(entries.filter((e) => e.entryType === "RESERVE_DENIED")).toHaveLength(1);
    const balance = await getWalletBalance(db, wallet.id, TENANT);
    expect(balance.availableMinor).toBe(200n);
    expect(balance.reservedMinor).toBe(800n);
  });

  it("is append-only: UPDATE and DELETE are blocked at the DB", async () => {
    const wallet = await makeWallet();
    await creditWallet(wallet.id, 500n);
    const payment = await makePayment(wallet.id, 100n);
    await reserveFunds(db, { tenantId: TENANT, paymentId: payment.id, walletId: wallet.id, amountMinor: 100n });

    const [row] = await db.select().from(schema.walletLedgerEntries).limit(1);
    await expect(
      db.update(schema.walletLedgerEntries).set({ note: "tampered" }).where(eq(schema.walletLedgerEntries.id, row!.id)),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.delete(schema.walletLedgerEntries).where(eq(schema.walletLedgerEntries.id, row!.id)),
    ).rejects.toThrow(/append-only/);
  });

  it("rejects a ledger row whose balance-after does not match the wallet (trigger guard)", async () => {
    const wallet = await makeWallet();
    await creditWallet(wallet.id, 500n);
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(schema.walletLedgerEntries).values({
          tenantId: TENANT,
          walletId: wallet.id,
          entryType: "FUND",
          refType: "funding",
          refId: crypto.randomUUID(),
          amountMinor: 500n,
          deltaAvailableMinor: 500n,
          deltaReservedMinor: 0n,
          availableAfterMinor: 123n, // lies — wallet actually has 500
          reservedAfterMinor: 0n,
        });
      }),
    ).rejects.toThrow(/balance-after/);
  });
});
