/**
 * Provider webhook gateway processing.
 *
 * Pipeline per instructions.md:
 * verify -> persist raw event -> dedupe -> queue -> apply legal transition
 * -> update ledger/reconciliation -> emit events -> notify -> ack.
 */
import { and, desc, eq } from "drizzle-orm";
import { schema, toJsonSafe, type Db } from "@zfloat/database";
import { applyProviderFailure, applyProviderSuccess } from "./execute.js";
import type { PaymentProvider } from "@zfloat/providers";

export class WebhookError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "WebhookError";
  }
}

export interface IncomingWebhook {
  provider: PaymentProvider;
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
}

/** Step 1-3: verify + persist + dedupe. Returns the stored event row. */
export async function ingestWebhook(db: Db, incoming: IncomingWebhook): Promise<{ accepted: boolean; reason?: string }> {
  const verified = await incoming.provider.verifyWebhook({ rawBody: incoming.rawBody, headers: incoming.headers });
  if (!verified.valid) {
    throw new WebhookError(verified.reason ?? "webhook verification failed", "VERIFY_FAILED");
  }
  const eventId = verified.providerEventId ?? crypto.randomUUID();
  const type = verified.event?.type ?? "payment.unknown";

  // Dedupe is enforced by the unique index on provider_event_id (migration 003):
  // a replay raises a unique-violation even if two deliveries race the gateway.
  // First check the visible path (fast return for common replays), then insert.
  const [existing] = await db
    .select({ id: schema.webhookEvents.id, status: schema.webhookEvents.status })
    .from(schema.webhookEvents)
    .where(eq(schema.webhookEvents.providerEventId, eventId))
    .limit(1);
  if (existing) {
    return { accepted: false, reason: "duplicate event" };
  }

  try {
    // Persist raw event securely (append-only raw payload; status is operational).
    const [stored] = await db
      .insert(schema.webhookEvents)
      .values({
        providerId: undefined,
        type,
        providerEventId: eventId,
        payload: toJsonSafe(verified.event?.raw ?? {}) as Record<string, unknown>,
        signature: JSON.stringify(incoming.headers).slice(0, 1000),
        status: "RECEIVED",
      })
      .returning();

    if (!stored) throw new WebhookError("failed to store webhook event", "STORE_FAILED");
    return { accepted: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { accepted: false, reason: "duplicate event" };
    }
    throw err;
  }
}

/** Detect PostgreSQL unique-violation errors (code 23505) across drivers. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === "23505" || (typeof e?.constraint === "string" && e.constraint.includes("provider_event"));
}

/** Step 4-8: process a verified, deduplicated webhook (worker). */
export async function processWebhookEvent(db: Db, eventId: string): Promise<void> {
  const [event] = await db
    .select()
    .from(schema.webhookEvents)
    .where(eq(schema.webhookEvents.id, eventId))
    .limit(1);
  if (!event) throw new WebhookError("webhook event not found", "NOT_FOUND");
  if (event.status === "PROCESSED" || event.status === "DUPLICATE") return;

  const payload = event.payload as Record<string, unknown>;
  const providerReference = String(payload.providerReference ?? payload.transactionId ?? "");
  if (!providerReference) {
    // Permanent condition — mark terminal so the job is not retried.
    await db.update(schema.webhookEvents).set({ status: "FAILED" }).where(eq(schema.webhookEvents.id, event.id));
    return;
  }

  // Find the payment by provider reference (via the attempt).
  const [attempt] = await db
    .select()
    .from(schema.paymentAttempts)
    .where(eq(schema.paymentAttempts.providerReference, providerReference))
    .orderBy(desc(schema.paymentAttempts.createdAt))
    .limit(1);
  if (!attempt) {
    // Unknown to us: record as a reconciliation orphan (provider side movement
    // with no matching internal payment) — once. This is a permanent condition:
    // mark the event UNMATCHED and return so the queue does not retry (each
    // retry used to re-record a duplicate orphan row).
    await db.update(schema.webhookEvents).set({ status: "UNMATCHED" }).where(eq(schema.webhookEvents.id, event.id));
    const [existingOrphan] = await db
      .select({ id: schema.reconItems.id })
      .from(schema.reconItems)
      .where(and(
        eq(schema.reconItems.source, "WEBHOOK"),
        eq(schema.reconItems.providerReference, providerReference),
        eq(schema.reconItems.status, "UNKNOWN"),
      ))
      .limit(1);
    if (!existingOrphan) {
      await db.insert(schema.reconItems).values({
        tenantId: event.tenantId ?? "00000000-0000-0000-0000-000000000000",
        source: "WEBHOOK",
        providerReference,
        amountMinor: typeof payload.amountMinor === "string" ? BigInt(payload.amountMinor) : 0n,
        currency: "KES",
        occurredAt: new Date(),
        status: "UNKNOWN",
        notes: "webhook for unknown payment — reconciliation orphan",
      });
    }
    return;
  }

  const status = String(payload.status ?? "SUCCESS");
  const outcome = status === "SUCCESS" ? "SUCCESS" : status === "FAILED" ? "FAILED" : status === "REVERSED" ? "REVERSED" : "UNKNOWN";

  await db.transaction(async (tx) => {
    switch (outcome) {
      case "SUCCESS":
        await applyProviderSuccess(tx, attempt.paymentId, providerReference, event.providerEventId ?? undefined);
        break;
      case "FAILED":
        await applyProviderFailure(tx, attempt.paymentId, "PROVIDER_CALLBACK_FAILED", String(payload.errorMessage ?? "provider reported failure"), event.providerEventId ?? undefined);
        break;
      case "REVERSED":
        await tx.update(schema.payments).set({ status: "REVERSED", providerStatus: "REVERSED", reversalReason: "provider reversed" }).where(eq(schema.payments.id, attempt.paymentId));
        break;
      case "UNKNOWN":
      default:
        await tx.update(schema.payments).set({ providerStatus: "UNKNOWN" }).where(eq(schema.payments.id, attempt.paymentId));
        break;
    }
    await tx.update(schema.webhookEvents).set({ status: "PROCESSED", processedAt: new Date() }).where(eq(schema.webhookEvents.id, event.id));
  });
}

/** Find a stored webhook event by id (for the API). */
export async function getWebhookEvent(db: Db, eventId: string) {
  const [row] = await db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, eventId)).limit(1);
  return row ?? null;
}
