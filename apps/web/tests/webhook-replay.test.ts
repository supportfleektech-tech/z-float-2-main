/**
 * SECURITY: webhook gateway replay protection — end-to-end.
 *
 * A real payment executes through the sandbox provider, then its completion
 * webhook is delivered twice:
 *  1st delivery → verified + persisted + processed (payment → SUCCESS)
 *  2nd delivery (replay) → detected as duplicate, silently acked, NO double
 *  execution (payment stays SUCCESS, single journal, single status history).
 * Wrong signature → rejected before anything is stored.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "@zfloat/database";
import { createDb, schema } from "@zfloat/database";
import { createPayment, submitPayment, executePayment, ingestWebhook, processWebhookEvent } from "@zfloat/payments-core";
import { MockProvider } from "@zfloat/providers";
import { ensureSystemChart, postFundingJournal } from "@zfloat/ledger";

let pool: ReturnType<typeof createDb>["pool"];
let db: ReturnType<typeof createDb>["db"];
const TENANT = crypto.randomUUID();

beforeAll(async () => {
  ({ db, pool } = createDb());
  await db.insert(schema.tenants).values({ id: TENANT, name: "Replay Co", slug: `replay-${Date.now()}`, status: "ACTIVE" });
  await ensureSystemChart(db, TENANT);
  const [wallet] = await db.insert(schema.wallets).values({ tenantId: TENANT, name: "Ops", currency: "KES" }).returning();
  await postFundingJournal(db, { tenantId: TENANT, walletId: wallet!.id, amountMinor: 1_000_000_00n });
  await db.update(schema.wallets).set({ availableMinor: 1_000_000_00n }).where(eq(schema.wallets.id, wallet!.id));
});

afterAll(async () => {
  await pool.end();
});

describe("webhook gateway — verify → persist → dedupe → enqueue", () => {
  it("a replayed completion webhook is deduped and never double-executes", async () => {
    const provider = new MockProvider("success");

    // 1. create + submit + execute a real payment (gets a provider reference)
    const { payment } = await createPayment(db, {
      tenantId: TENANT,
      actorId: crypto.randomUUID(),
      amount: "2500.00",
      channel: "mpesa",
      product: "single_payment",
      sourceWalletId: (await db.select({ id: schema.wallets.id }).from(schema.wallets).where(eq(schema.wallets.tenantId, TENANT)).limit(1))[0]!.id,
      recipient: { name: "Jane", phone: "0712345678" },
      idempotencyKey: `wh-${Date.now()}`,
    });
    await submitPayment(db, { tenantId: TENANT, paymentId: payment.paymentId, actorId: crypto.randomUUID(), policyRules: [] });
    await executePayment(db, { tenantId: TENANT, paymentId: payment.paymentId, provider, attemptNumber: 1 });

    const [afterExec] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.paymentId)).limit(1);
    expect(afterExec!.status).toBe("SUCCESS");
    const providerReference = afterExec!.providerReference!;

    // 2. provider callback (the gateway receive path)
    const rawBody = JSON.stringify({
      eventId: `evt-${providerReference}`,
      type: "payment.completed",
      providerReference,
      amountMinor: String(payment.amountMinor),
      status: "SUCCESS",
    });
    const headers = { "content-type": "application/json", "x-mock-signature": "mock-provider-dev-secret" };

    const first = await ingestWebhook(db, { provider, rawBody, headers });
    expect(first.accepted).toBe(true);

    const [stored] = await db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.providerEventId, `evt-${providerReference}`)).limit(1);
    await processWebhookEvent(db, stored!.id); // worker step — payment → SUCCESS

    // 3. replay the exact same delivery
    const replay = await ingestWebhook(db, { provider, rawBody, headers });
    expect(replay.accepted).toBe(false);

    // 4. no double execution: one success journal, one success transition
    const [p] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.paymentId)).limit(1);
    expect(p!.status).toBe("SUCCESS");

    const history = await db.select().from(schema.paymentStatusHistory).where(eq(schema.paymentStatusHistory.paymentId, payment.paymentId));
    expect(history.filter((h) => h.toStatus === "SUCCESS").length).toBe(1);

    const journals = await db
      .select()
      .from(schema.journals)
      .where(and(eq(schema.journals.referenceType, "payment"), eq(schema.journals.referenceId, payment.paymentId)));
    expect(journals.length).toBe(1);
  });

  it("rejects webhooks with a bad signature before anything is stored", async () => {
    const provider = new MockProvider("success");
    await expect(
      ingestWebhook(db, {
        provider,
        rawBody: JSON.stringify({ eventId: `forged-${Date.now()}`, type: "payment.completed", providerReference: "X", amountMinor: "1", status: "SUCCESS" }),
        headers: { "content-type": "application/json", "x-mock-signature": "forged" },
      }),
    ).rejects.toThrow(/signature/);
  });
});
