import { and, eq, sql } from "drizzle-orm";
import { schema, type Db, type Tx } from "@zfloat/database";
import {
  getSystemAccount,
  getWalletLedgerAccount,
  InsufficientFundsError,
  LedgerError,
  postJournal,
  SYSTEM_CHART,
} from "./ledger.js";

export interface WalletBalance {
  walletId: string;
  availableMinor: bigint;
  reservedMinor: bigint;
  totalMinor: bigint;
}

/* ------------------------------------------------------ reservation ledger */

export type WalletLedgerEntryType =
  | "FUND"
  | "RESERVE"
  | "RESERVE_DENIED"
  | "RELEASE"
  | "APPLY";

export interface WalletLedgerEntry {
  id: string;
  entryType: WalletLedgerEntryType;
  refType: string | null;
  refId: string | null;
  amountMinor: bigint;
  deltaAvailableMinor: bigint;
  deltaReservedMinor: bigint;
  availableAfterMinor: bigint;
  reservedAfterMinor: bigint;
  note: string | null;
  createdAt: Date;
}

/**
 * Append one immutable entry to the wallet reservation ledger (C-3).
 * The balance-after columns are captured from the wallet row so the ledger
 * can be replayed and audited against the live wallet state. Must run inside
 * the same transaction as the movement it records. The DB trigger enforces
 * the same invariants as a second guard (see custom-migrations/011).
 */
async function appendWalletLedgerEntry(
  tx: Tx,
  input: {
    tenantId: string;
    walletId: string;
    entryType: WalletLedgerEntryType;
    refType?: string;
    refId?: string;
    amountMinor: bigint;
    deltaAvailableMinor: bigint;
    deltaReservedMinor: bigint;
    note?: string;
  },
): Promise<void> {
  const [wallet] = await tx
    .select({
      availableMinor: schema.wallets.availableMinor,
      reservedMinor: schema.wallets.reservedMinor,
    })
    .from(schema.wallets)
    .where(eq(schema.wallets.id, input.walletId))
    .for("update");
  if (!wallet) throw new LedgerError(`Wallet not found: ${input.walletId}`, "WALLET_NOT_FOUND");
  await tx.insert(schema.walletLedgerEntries).values({
    tenantId: input.tenantId,
    walletId: input.walletId,
    entryType: input.entryType,
    refType: input.refType,
    refId: input.refId,
    amountMinor: input.amountMinor,
    deltaAvailableMinor: input.deltaAvailableMinor,
    deltaReservedMinor: input.deltaReservedMinor,
    availableAfterMinor: BigInt(wallet.availableMinor),
    reservedAfterMinor: BigInt(wallet.reservedMinor),
    note: input.note,
  });
}

/** Read the last N ledger entries for a wallet (newest first). */
export async function listWalletLedgerEntries(
  db: Db,
  input: { walletId: string; limit?: number; entryType?: WalletLedgerEntryType },
): Promise<WalletLedgerEntry[]> {
  const limit = Math.min(input.limit ?? 50, 500);
  const conds = [eq(schema.walletLedgerEntries.walletId, input.walletId)];
  if (input.entryType) conds.push(eq(schema.walletLedgerEntries.entryType, input.entryType));
  const rows = await db
    .select()
    .from(schema.walletLedgerEntries)
    .where(and(...conds))
    .orderBy(sql`${schema.walletLedgerEntries.createdAt} desc`)
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    entryType: r.entryType as WalletLedgerEntryType,
    refType: r.refType,
    refId: r.refId,
    amountMinor: BigInt(r.amountMinor),
    deltaAvailableMinor: BigInt(r.deltaAvailableMinor),
    deltaReservedMinor: BigInt(r.deltaReservedMinor),
    availableAfterMinor: BigInt(r.availableAfterMinor),
    reservedAfterMinor: BigInt(r.reservedAfterMinor),
    note: r.note,
    createdAt: r.createdAt,
  }));
}

/** Count of denied reservation (double-spend) attempts on a wallet. */
export async function countDeniedReservations(db: Db, walletId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.walletLedgerEntries)
    .where(
      and(
        eq(schema.walletLedgerEntries.walletId, walletId),
        eq(schema.walletLedgerEntries.entryType, "RESERVE_DENIED"),
      ),
    );
  return row?.n ?? 0;
}

/** Current operational balance of a wallet. */
export async function getWalletBalance(db: Db, walletId: string, tenantId: string): Promise<WalletBalance> {
  const [wallet] = await db
    .select()
    .from(schema.wallets)
    .where(and(eq(schema.wallets.id, walletId), eq(schema.wallets.tenantId, tenantId)))
    .limit(1);
  if (!wallet) throw new LedgerError(`Wallet not found: ${walletId}`, "WALLET_NOT_FOUND");
  return {
    walletId: wallet.id,
    availableMinor: BigInt(wallet.availableMinor),
    reservedMinor: BigInt(wallet.reservedMinor),
    totalMinor: BigInt(wallet.availableMinor) + BigInt(wallet.reservedMinor),
  };
}

/**
 * Append a FUND entry to the wallet reservation ledger — call inside the same
 * transaction that credits the wallet's available balance (fundWallet,
 * collectViaPaymentLink). Deltas must be applied to the wallet BEFORE this
 * runs so the balance-after columns reflect the new state.
 */
export async function recordWalletFunding(
  tx: Tx,
  input: { tenantId: string; walletId: string; refType?: string; refId?: string; amountMinor: bigint; note?: string },
): Promise<void> {
  await appendWalletLedgerEntry(tx, {
    tenantId: input.tenantId,
    walletId: input.walletId,
    entryType: "FUND",
    refType: input.refType,
    refId: input.refId,
    amountMinor: input.amountMinor,
    deltaAvailableMinor: input.amountMinor,
    deltaReservedMinor: 0n,
    note: input.note,
  });
}

/**
 * Atomically reserve funds for a payment.
 * The single UPDATE ... WHERE available >= amount is the concurrency guard:
 * two simultaneous reservations can never both succeed on the same money.
 * Returns the reservation id; throws InsufficientFundsError otherwise.
 * Every attempt — success AND denial — is appended to the wallet reservation
 * ledger (C-3), so double-spend attempts are auditable. The denied entry is
 * written in its own transaction so it survives the InsufficientFundsError
 * (an exception inside a tx would roll it back).
 */
export async function reserveFunds(
  db: Db,
  input: { tenantId: string; paymentId: string; walletId: string; amountMinor: bigint },
): Promise<{ reservationId: string; balanceAfter: WalletBalance }> {
  const attempt = await db.transaction(async (tx: Tx) => {
    const updated = await tx
      .update(schema.wallets)
      .set({
        availableMinor: sql`${schema.wallets.availableMinor} - ${input.amountMinor}`,
        reservedMinor: sql`${schema.wallets.reservedMinor} + ${input.amountMinor}`,
      })
      .where(
        and(
          eq(schema.wallets.id, input.walletId),
          eq(schema.wallets.tenantId, input.tenantId),
          sql`${schema.wallets.availableMinor} >= ${input.amountMinor}`,
        ),
      )
      .returning({ id: schema.wallets.id, available: schema.wallets.availableMinor, reserved: schema.wallets.reservedMinor });

    if (updated.length === 0) {
      return { denied: true as const };
    }

    const [reservation] = await tx
      .insert(schema.walletReservations)
      .values({
        tenantId: input.tenantId,
        paymentId: input.paymentId,
        walletId: input.walletId,
        amountMinor: input.amountMinor,
        status: "HELD",
      })
      .returning({ id: schema.walletReservations.id });
    if (!reservation) throw new LedgerError("failed to create reservation", "RESERVATION_FAILED");

    await appendWalletLedgerEntry(tx, {
      tenantId: input.tenantId,
      walletId: input.walletId,
      entryType: "RESERVE",
      refType: "payment",
      refId: input.paymentId,
      amountMinor: input.amountMinor,
      deltaAvailableMinor: -input.amountMinor,
      deltaReservedMinor: input.amountMinor,
      note: `reservation ${reservation.id}`,
    });

    return {
      denied: false as const,
      reservationId: reservation.id,
      balanceAfter: {
        walletId: input.walletId,
        availableMinor: BigInt(updated[0]!.available),
        reservedMinor: BigInt(updated[0]!.reserved),
        totalMinor: BigInt(updated[0]!.available) + BigInt(updated[0]!.reserved),
      },
    };
  });

  if (attempt.denied) {
    // Durable double-spend audit trail (own transaction — survives the throw).
    await db.transaction(async (tx: Tx) => {
      await appendWalletLedgerEntry(tx, {
        tenantId: input.tenantId,
        walletId: input.walletId,
        entryType: "RESERVE_DENIED",
        refType: "payment",
        refId: input.paymentId,
        amountMinor: input.amountMinor,
        deltaAvailableMinor: 0n,
        deltaReservedMinor: 0n,
        note: "denied: available balance insufficient",
      });
    });
    throw new InsufficientFundsError(input.walletId);
  }

  return {
    reservationId: attempt.reservationId,
    balanceAfter: attempt.balanceAfter,
  };
}

/** Release a held reservation back to the available balance (failure/cancel path). */
export async function releaseReservation(db: Db, reservationId: string): Promise<void> {
  return db.transaction(async (tx: Tx) => {
    const [res] = await tx
      .select()
      .from(schema.walletReservations)
      .where(eq(schema.walletReservations.id, reservationId))
      .limit(1);
    if (!res || res.status !== "HELD") return; // already applied/released — idempotent
    await tx
      .update(schema.wallets)
      .set({
        availableMinor: sql`${schema.wallets.availableMinor} + ${res.amountMinor}`,
        reservedMinor: sql`${schema.wallets.reservedMinor} - ${res.amountMinor}`,
      })
      .where(eq(schema.wallets.id, res.walletId));
    await tx
      .update(schema.walletReservations)
      .set({ status: "RELEASED" })
      .where(eq(schema.walletReservations.id, reservationId));
    await appendWalletLedgerEntry(tx, {
      tenantId: res.tenantId,
      walletId: res.walletId,
      entryType: "RELEASE",
      refType: "payment",
      refId: res.paymentId,
      amountMinor: BigInt(res.amountMinor),
      deltaAvailableMinor: BigInt(res.amountMinor),
      deltaReservedMinor: -BigInt(res.amountMinor),
      note: `reservation ${reservationId}`,
    });
  });
}

/**
 * Apply a reservation after provider success: money leaves the float.
 * Only the reservation moves; the journal for the payment is posted separately
 * by postPaymentSuccessJournal (keeps accounting explicit and auditable).
 */
export async function applyReservation(db: Db, reservationId: string): Promise<void> {
  return db.transaction(async (tx: Tx) => {
    const [res] = await tx
      .select()
      .from(schema.walletReservations)
      .where(eq(schema.walletReservations.id, reservationId))
      .limit(1);
    if (!res || res.status !== "HELD") return;
    await tx
      .update(schema.wallets)
      .set({ reservedMinor: sql`${schema.wallets.reservedMinor} - ${res.amountMinor}` })
      .where(eq(schema.wallets.id, res.walletId));
    await tx
      .update(schema.walletReservations)
      .set({ status: "APPLIED" })
      .where(eq(schema.walletReservations.id, reservationId));
    await appendWalletLedgerEntry(tx, {
      tenantId: res.tenantId,
      walletId: res.walletId,
      entryType: "APPLY",
      refType: "payment",
      refId: res.paymentId,
      amountMinor: BigInt(res.amountMinor),
      deltaAvailableMinor: 0n,
      deltaReservedMinor: -BigInt(res.amountMinor),
      note: `reservation ${reservationId}`,
    });
  });
}

/**
 * Post the journal for a successful payment:
 *   Debit  Payment Clearing     (amount + fee)
 *   Credit Wallet               (amount)          — wallet-funded payments
 *   Credit Float Liability      (amount)          — float-funded (batch) payments
 *   Credit Fee Revenue          (fee)
 */
export async function postPaymentSuccessJournal(
  db: Db,
  input: { tenantId: string; paymentId: string; walletId?: string | null; amountMinor: bigint; feeMinor: bigint; actorId?: string },
): Promise<void> {
  const clearingAcc = await getSystemAccount(db, input.tenantId, SYSTEM_CHART.PAYMENT_CLEARING);
  const entries: Array<{ ledgerAccountId: string; debitMinor: bigint; creditMinor: bigint; memo: string }> = [
    { ledgerAccountId: clearingAcc.id, debitMinor: input.amountMinor + input.feeMinor, creditMinor: 0n, memo: "payment amount + fee" },
  ];
  if (input.walletId) {
    const walletAcc = await getWalletLedgerAccount(db, input.walletId, input.tenantId);
    entries.push({ ledgerAccountId: walletAcc.id, debitMinor: 0n, creditMinor: input.amountMinor, memo: "principal" });
  } else {
    // Float-funded payment (batch row): the float liability is the funding source.
    const floatAcc = await getSystemAccount(db, input.tenantId, SYSTEM_CHART.FLOAT_LIABILITY);
    entries.push({ ledgerAccountId: floatAcc.id, debitMinor: 0n, creditMinor: input.amountMinor, memo: "principal (float)" });
  }
  if (input.feeMinor > 0n) {
    const feeAcc = await getSystemAccount(db, input.tenantId, SYSTEM_CHART.FEE_REVENUE);
    entries.push({ ledgerAccountId: feeAcc.id, debitMinor: 0n, creditMinor: input.feeMinor, memo: "fee revenue" });
  }
  await postJournal(db, {
    tenantId: input.tenantId,
    referenceType: "payment",
    referenceId: input.paymentId,
    description: input.walletId ? `Payment success — wallet ${input.walletId}` : `Payment success — float (batch)`,
    actorId: input.actorId,
    entries,
  });
}

/**
 * Post the journal for a payment reversal (compensating entry).
 * Principal returns to the wallet (or float liability for batch payments);
 * fee revenue is retained (policy choice, changeable by finance; see docs/LEDGER.md).
 *   Debit  Wallet / Float Liability  (principal)
 *   Credit Clearing                  (principal)
 */
export async function postReversalJournal(
  db: Db,
  input: { tenantId: string; paymentId: string; walletId?: string | null; amountMinor: bigint; actorId?: string },
): Promise<void> {
  const clearingAcc = await getSystemAccount(db, input.tenantId, SYSTEM_CHART.PAYMENT_CLEARING);
  const entries: Array<{ ledgerAccountId: string; debitMinor: bigint; creditMinor: bigint; memo: string }> = [];
  if (input.walletId) {
    const walletAcc = await getWalletLedgerAccount(db, input.walletId, input.tenantId);
    entries.push({ ledgerAccountId: walletAcc.id, debitMinor: input.amountMinor, creditMinor: 0n, memo: "reversed principal" });
  } else {
    const floatAcc = await getSystemAccount(db, input.tenantId, SYSTEM_CHART.FLOAT_LIABILITY);
    entries.push({ ledgerAccountId: floatAcc.id, debitMinor: input.amountMinor, creditMinor: 0n, memo: "reversed principal (float)" });
  }
  entries.push({ ledgerAccountId: clearingAcc.id, debitMinor: 0n, creditMinor: input.amountMinor, memo: "reversed principal" });
  await postJournal(db, {
    tenantId: input.tenantId,
    referenceType: "reversal",
    referenceId: input.paymentId,
    description: input.walletId ? `Payment reversal — wallet ${input.walletId}` : "Payment reversal — float (batch)",
    actorId: input.actorId,
    entries,
  });
}

/**
 * Post the journal for a wallet funding:
 *   Debit  Wallet            (amount)
 *   Credit Float Liability   (amount)
 */
export async function postFundingJournal(
  db: Db,
  input: { tenantId: string; walletId: string; amountMinor: bigint; actorId?: string },
): Promise<void> {
  const walletAcc = await getWalletLedgerAccount(db, input.walletId, input.tenantId);
  const liabilityAcc = await getSystemAccount(db, input.tenantId, SYSTEM_CHART.FLOAT_LIABILITY);
  await postJournal(db, {
    tenantId: input.tenantId,
    referenceType: "funding",
    referenceId: input.walletId,
    description: `Wallet funding — wallet ${input.walletId}`,
    actorId: input.actorId,
    entries: [
      { ledgerAccountId: walletAcc.id, debitMinor: input.amountMinor, memo: "funding" },
      { ledgerAccountId: liabilityAcc.id, creditMinor: input.amountMinor, memo: "float liability" },
    ],
  });
}
