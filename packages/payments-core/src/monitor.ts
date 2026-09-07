/**
 * Unknown-state monitor — the safety net for payments stuck in
 * PROVIDER_PENDING / PROCESSING without a callback. Queries the provider for
 * the real status and applies it through the legal state machine.
 */
import { and, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";
import { applyProviderFailure, applyProviderSuccess } from "./execute.js";
import { transitionPayment } from "./state.js";
import type { PaymentProvider } from "@zfloat/providers";

export async function monitorStuckPayments(
  db: Db,
  provider: PaymentProvider,
  opts: { olderThanMs?: number; limit?: number } = {},
): Promise<{ checked: number; updated: number }> {
  const olderThanMs = opts.olderThanMs ?? 5 * 60_000;
  const cutoff = new Date(Date.now() - olderThanMs);
  const stuck = await db
    .select()
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.status, "PROVIDER_PENDING"),
        sql`${schema.payments.updatedAt} <= ${cutoff}`,
      ),
    )
    .limit(opts.limit ?? 50);

  let updated = 0;
  for (const payment of stuck) {
    if (!payment.providerReference) continue;
    try {
      const status = await provider.getPaymentStatus({
        providerReference: payment.providerReference,
        paymentId: payment.id,
      });
      await db.transaction(async (tx) => {
        switch (status.status) {
          case "SUCCESS":
            await applyProviderSuccess(tx, payment.id, payment.providerReference!, "status-poll");
            break;
          case "FAILED":
            await applyProviderFailure(tx, payment.id, "PROVIDER_STATUS_POLL", status.errorMessage ?? "provider reported failure", "status-poll");
            break;
          case "REVERSED":
            await transitionPayment(tx, { paymentId: payment.id, to: "REVERSED", reason: "provider status poll: reversed" });
            await tx.update(schema.payments).set({ providerStatus: "REVERSED" }).where(eq(schema.payments.id, payment.id));
            break;
          default:
            // still unknown/pending — leave for the next monitor pass
            break;
        }
      });
      updated += 1;
    } catch {
      // provider unreachable — try again next pass; never fail the payment
    }
  }
  return { checked: stuck.length, updated };
}
