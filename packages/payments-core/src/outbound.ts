/**
 * Outbound webhooks — tenant-facing delivery of domain events.
 * Payloads are HMAC-SHA256 signed with a per-subscription secret (AES-256-GCM
 * encrypted at rest) so the tenant can verify authenticity.
 *
 * Reliability model (GAP-ANALYSIS Phase 2):
 *  - webhook_deliveries IS the delivery log AND the dead-letter queue: rows
 *    that exhaust their attempts stay FAILED with the exact payload bytes,
 *    the attempts made, the last HTTP status and the last error, so an
 *    operator can inspect and replay them.
 *  - Retry classification: HTTP 5xx / network errors / timeouts are retried
 *    with exponential backoff (2s→30s, max 5 attempts); HTTP 4xx is a
 *    PERMANENT failure — the endpoint received and refused the delivery
 *    (bad signature, unsupported event), so retrying cannot succeed and the
 *    row is failed immediately onto the DLQ.
 *  - Replay re-enqueues a FAILED delivery (attempts reset); the next attempt
 *    re-signs with the CURRENT subscription secret, so deliveries replayed
 *    after a secret rotation carry the new signature.
 *  - Secret rotation replaces the signing secret and bumps secret_version;
 *    the old secret is invalid immediately (regeneration semantics — the
 *    tenant must update its verifier). Deliveries already DELIVERED keep
 *    their stored signature as the audit record of what was sent.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";
import { enqueue, type QueueClient } from "@zfloat/queue";
import { decryptSecret, encryptSecret } from "@zfloat/auth";

export const OUTBOUND_EVENTS = ["payment.completed", "payment.failed", "payment.reversed", "batch.completed", "wallet.funded"] as const;
export type OutboundEvent = (typeof OUTBOUND_EVENTS)[number];

/** Delivery row statuses — PENDING (queued/retrying) | DELIVERED | FAILED (DLQ). */
export const DELIVERY_TERMINAL_4XX = "DELIVERY_REJECTED_4XX";

/** Normalize internal outbox event names to subscription event names. */
export function normalizeOutboundEvent(eventType: string): string {
  if (eventType === "payment.succeeded" || eventType === "payment.completed") return "payment.completed";
  return eventType;
}

/** Deterministic HMAC-SHA256 signature over the canonical payload bytes. */
export function signPayload(secret: string, payload: unknown): string {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Constant-time comparison of an incoming signature. */
export function verifyPayloadSignature(secret: string, payload: unknown, signature: string): boolean {
  const expected = signPayload(secret, payload);
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"));
}

/** Generate a new random signing secret (48 hex chars / 192 bits). */
export function generateSigningSecret(): string {
  return randomBytes(24).toString("hex");
}

/** Events the tenant subscribed to, with the decrypted signing secret. */
export async function listActiveSubscriptions(
  db: Db,
  tenantId: string,
  eventType: string,
): Promise<Array<{ id: string; url: string; secret: string; eventType: string; payload: Record<string, unknown> }>> {
  const subs = await db
    .select()
    .from(schema.webhookSubscriptions)
    .where(and(eq(schema.webhookSubscriptions.tenantId, tenantId), eq(schema.webhookSubscriptions.status, "ACTIVE")));
  return subs
    .filter((s) => ((s.events ?? []) as string[]).includes(eventType))
    .map((s) => ({
      id: s.id,
      url: s.url,
      secret: decryptSecret(s.secretEncrypted),
      eventType,
      payload: {},
    }));
}

/** In-process queue seam so delivery/replay tests never need Redis. */
type DeliverQueue = Pick<QueueClient, "enqueue">;

function humanNetworkError(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code) return `${cause.code}: ${cause.message ?? "connection error"}`;
  if (err instanceof Error && err.message) return err.message;
  return "network error";
}

/**
 * Fan out a domain event to the tenant's matching subscriptions by creating
 * delivery rows and enqueueing webhooks.deliver jobs. Called by the worker's
 * outbox dispatcher after an event is handled.
 */
export async function fanoutWebhookDeliveries(
  db: Db,
  input: { tenantId: string; eventType: string; payload: Record<string, unknown> },
): Promise<number> {
  const eventType = normalizeOutboundEvent(input.eventType);
  if (!(OUTBOUND_EVENTS as readonly string[]).includes(eventType)) return 0;
  const subs = await db
    .select({ id: schema.webhookSubscriptions.id, secretEncrypted: schema.webhookSubscriptions.secretEncrypted, events: schema.webhookSubscriptions.events })
    .from(schema.webhookSubscriptions)
    .where(and(eq(schema.webhookSubscriptions.tenantId, input.tenantId), eq(schema.webhookSubscriptions.status, "ACTIVE")));
  const matching = subs.filter((s) => ((s.events ?? []) as string[]).includes(eventType));

  let created = 0;
  for (const sub of matching) {
    const secret = decryptSecret(sub.secretEncrypted);
    const payload = { ...input.payload, eventType, occurredAt: new Date().toISOString() };
    // The signature MUST cover the exact bytes sent over the wire. jsonb rounds
    // keys on the way out of Postgres, so serialize once here, sign that string,
    // and store it — delivery posts payloadBody verbatim.
    const payloadBody = JSON.stringify(payload);
    const signature = signPayload(secret, payloadBody);
    const [row] = await db
      .insert(schema.webhookDeliveries)
      .values({
        tenantId: input.tenantId,
        subscriptionId: sub.id,
        eventType: input.eventType,
        payload,
        payloadBody,
        signature,
        status: "PENDING",
      })
      .returning({ id: schema.webhookDeliveries.id });
    if (row) {
      created += 1;
      await enqueue("webhooks.deliver", {
        correlationId: `whd-${row.id}`,
        tenantId: input.tenantId,
        deliveryId: row.id,
        attempt: 1,
      });
    }
  }
  return created;
}

/** Delivery attempt: POST signed payload, honor retries with backoff. */
const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_DELAY_MS = (attempt: number) => Math.min(30_000, 2 ** attempt * 2_000); // 2s,4s,8s,16s,30s

export async function deliverWebhook(db: Db, deliveryId: string, attempt: number, queue: DeliverQueue = { enqueue }): Promise<void> {
  const [d] = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.id, deliveryId));
  if (!d || d.status === "DELIVERED") return;

  const [sub] = await db.select().from(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.id, d.subscriptionId));
  if (!sub || sub.status !== "ACTIVE") {
    await db
      .update(schema.webhookDeliveries)
      .set({ status: "FAILED", attempts: attempt, lastError: "Subscription is not ACTIVE — delivery cannot proceed", updatedAt: new Date() })
      .where(eq(schema.webhookDeliveries.id, deliveryId));
    return;
  }

  const secret = decryptSecret(sub.secretEncrypted);
  // Sign the exact bytes we send (payloadBody was captured at fanout; fall back
  // to a live serialization for legacy rows so header and body always match).
  const payloadBody = d.payloadBody ?? JSON.stringify(d.payload);
  const signature = signPayload(secret, payloadBody);

  let responseStatus = 0;
  let errorText = "";
  try {
    const res = await fetch(sub.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-zfloat-event": d.eventType,
        "x-zfloat-delivery": d.id,
        "x-zfloat-signature": signature,
      },
      body: payloadBody,
      signal: AbortSignal.timeout(10_000),
    });
    responseStatus = res.status;
    if (res.ok) {
      // Persist the exact bytes that were sent (rows created without a body —
      // e.g. legacy or ping deliveries — capture it on the first attempt).
      await db
        .update(schema.webhookDeliveries)
        .set({ status: "DELIVERED", attempts: attempt, responseStatus, lastError: null, payloadBody, signature, updatedAt: new Date() })
        .where(eq(schema.webhookDeliveries.id, deliveryId));
      return;
    }
    // HTTP 4xx = the endpoint received and refused the delivery. Retrying can
    // never succeed (bad signature / event the receiver rejects) — fail the
    // delivery permanently onto the DLQ instead of burning retry attempts.
    if (responseStatus >= 400 && responseStatus < 500) {
      const lastError = `Endpoint rejected the delivery with HTTP ${responseStatus} (4xx is permanent — check the receiver's signature/event handling)`;
      await db
        .update(schema.webhookDeliveries)
        .set({ status: "FAILED", attempts: attempt, responseStatus, lastError, payloadBody, signature, updatedAt: new Date() })
        .where(eq(schema.webhookDeliveries.id, deliveryId));
      return;
    }
    errorText = `Endpoint returned HTTP ${responseStatus}`;
  } catch (err) {
    errorText = `POST ${sub.url} failed: ${humanNetworkError(err)}`;
  }

  const exhausted = attempt >= MAX_DELIVERY_ATTEMPTS;
  if (exhausted) {
    // Terminal: stay on the delivery log as the DLQ entry with full context.
    await db
      .update(schema.webhookDeliveries)
      .set({ status: "FAILED", attempts: attempt, responseStatus: responseStatus || null, lastError: errorText, payloadBody, signature, updatedAt: new Date() })
      .where(eq(schema.webhookDeliveries.id, deliveryId));
    return;
  }
  const delayMs = RETRY_DELAY_MS(attempt);
  await db
    .update(schema.webhookDeliveries)
    .set({
      attempts: attempt,
      responseStatus: responseStatus || null,
      lastError: errorText,
      payloadBody,
      nextRetryAt: new Date(Date.now() + delayMs),
      updatedAt: new Date(),
    })
    .where(eq(schema.webhookDeliveries.id, deliveryId));
  await queue.enqueue(
    "webhooks.deliver",
    { correlationId: `whd-${deliveryId}`, tenantId: d.tenantId, deliveryId, attempt: attempt + 1 },
    { jobId: `whd-${deliveryId}-${attempt + 1}`, delayMs },
  );
}

/** A delivery cannot be replayed because of its state. */
export class DeliveryReplayError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "DeliveryReplayError";
  }
}

/**
 * Replay a FAILED delivery from the DLQ: reset its attempt state and
 * re-enqueue a webhooks.deliver job (attempt 1). The next attempt re-signs
 * with the subscription's CURRENT secret. Guarded: only FAILED deliveries can
 * be replayed, and the subscription must still exist and be ACTIVE (a
 * disabled/deleted endpoint cannot receive).
 */
export async function replayDelivery(db: Db, deliveryId: string, queue: DeliverQueue = { enqueue }): Promise<{ id: string; status: "PENDING"; attempt: 1 }> {
  const [d] = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.id, deliveryId));
  if (!d) throw new DeliveryReplayError("Delivery not found", "NOT_FOUND");
  if (d.status !== "FAILED") {
    throw new DeliveryReplayError(`Only FAILED deliveries can be replayed (current status: ${d.status})`, "NOT_FAILED");
  }
  const [sub] = await db.select({ id: schema.webhookSubscriptions.id, status: schema.webhookSubscriptions.status }).from(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.id, d.subscriptionId)).limit(1);
  if (!sub) throw new DeliveryReplayError("The subscription no longer exists — the delivery cannot be replayed", "SUB_MISSING");
  if (sub.status !== "ACTIVE") {
    throw new DeliveryReplayError("The subscription is not ACTIVE — enable it before replaying", "SUB_INACTIVE");
  }
  await db
    .update(schema.webhookDeliveries)
    .set({ status: "PENDING", attempts: 0, responseStatus: null, nextRetryAt: null, lastError: null, updatedAt: new Date() })
    .where(eq(schema.webhookDeliveries.id, deliveryId));
  await queue.enqueue("webhooks.deliver", {
    correlationId: `whd-${deliveryId}-replay`,
    tenantId: d.tenantId,
    deliveryId,
    attempt: 1,
  });
  return { id: deliveryId, status: "PENDING", attempt: 1 };
}

/** A subscription secret rotation failure. */
export class SecretRotationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "SecretRotationError";
  }
}

/**
 * Rotate a subscription's signing secret: generate a fresh one, encrypt at
 * rest, bump secret_version and stamp secret_rotated_at. The previous secret
 * stops signing immediately (deliveries retried or replayed afterwards carry
 * the new signature) — the returned secret is shown exactly once to the
 * tenant, who must update their verifier.
 */
export async function rotateSubscriptionSecret(db: Db, subscriptionId: string): Promise<{ id: string; secret: string; version: number; rotatedAt: Date }> {
  const [sub] = await db.select().from(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.id, subscriptionId)).limit(1);
  if (!sub) throw new SecretRotationError("Webhook subscription not found", "NOT_FOUND");
  const secret = generateSigningSecret();
  const version = (sub.secretVersion ?? 1) + 1;
  await db
    .update(schema.webhookSubscriptions)
    .set({ secretEncrypted: encryptSecret(secret), secretVersion: version, secretRotatedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.webhookSubscriptions.id, subscriptionId));
  return { id: subscriptionId, secret, version, rotatedAt: new Date() };
}
