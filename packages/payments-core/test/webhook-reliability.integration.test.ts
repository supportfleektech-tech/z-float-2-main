/**
 * Phase 2 (GAP-ANALYSIS) — outbound webhook reliability integration tests on
 * real PostgreSQL: the delivery log doubles as the DLQ (FAILED rows keep the
 * payload bytes, attempts, HTTP status and LAST ERROR); retry classification
 * (4xx permanent vs 5xx/network retryable); replay re-enqueues a FAILED
 * delivery and re-signs with the CURRENT secret; secret rotation bumps the
 * version and invalidates the old secret immediately.
 *
 * Deliveries POST to a real in-process HTTP server (ephemeral port); the queue
 * is injected as a fake so no Redis is needed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDb, schema, eq } from "@zfloat/database";
import { encryptSecret } from "@zfloat/auth";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  deliverWebhook,
  replayDelivery,
  rotateSubscriptionSecret,
  generateSigningSecret,
  signPayload,
  verifyPayloadSignature,
  DeliveryReplayError,
  SecretRotationError,
} from "../src/outbound.js";

let db: ReturnType<typeof createDb>["db"];
let pool: ReturnType<typeof createDb>["pool"];

const TENANT = crypto.randomUUID();
/** Recorded queue calls: { queueName, payload, opts }. */
const queueCalls: Array<{ queueName: string; payload: Record<string, unknown>; opts?: Record<string, unknown> }> = [];
const fakeQueue = {
  enqueue: async (queueName: string, payload: Record<string, unknown>, opts?: Record<string, unknown>) => {
    queueCalls.push({ queueName, payload, opts });
    return "job-1";
  },
};

/** Behaviour switchable per test — mirrors a tenant endpoint. */
let mode: "ok" | "http500" | "http400" | "refuse";
let received: Array<{ body: string; headers: Record<string, string | string[] | undefined> }> = [];
let server: Server;
let baseUrl = "";

function startCatch() {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      received.push({ body: Buffer.concat(chunks).toString("utf8"), headers: req.headers as Record<string, string | string[] | undefined> });
      if (mode === "ok") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } else if (mode === "http400") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad signature" }));
      } else if (mode === "http500") {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "busy" }));
      } else {
        req.socket.destroy(); // connection-level refusal (network error path)
      }
    });
  });
  return new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
}

beforeAll(async () => {
  ({ db, pool } = createDb());
  await db.insert(schema.tenants).values({ id: TENANT, name: "Reliability Co", slug: `rel-${Date.now()}`, status: "ACTIVE" });
  await startCatch();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

async function clean() {
  await pool.query(`TRUNCATE webhook_deliveries, webhook_subscriptions CASCADE`);
  queueCalls.length = 0;
  received = [];
  mode = "ok";
}

beforeEach(clean);

async function makeSub(secret = generateSigningSecret()) {
  const [sub] = await db
    .insert(schema.webhookSubscriptions)
    .values({
      tenantId: TENANT,
      name: "Reliability endpoint",
      url: `${baseUrl}/hook`,
      secretEncrypted: encryptSecret(secret),
      events: ["payment.completed"],
      status: "ACTIVE",
      secretVersion: 1,
    })
    .returning();
  return { sub: sub!, secret };
}

async function makeDelivery(subId: string, eventType = "payment.completed") {
  const payload = { paymentId: crypto.randomUUID(), amountMinor: "50000", eventType, occurredAt: new Date().toISOString() };
  const [d] = await db
    .insert(schema.webhookDeliveries)
    .values({ tenantId: TENANT, subscriptionId: subId, eventType, payload, status: "PENDING" })
    .returning();
  return d!;
}

async function deliveryRow(id: string) {
  const rows = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.id, id)).limit(1);
  return rows[0];
}

describe("webhook delivery reliability (DLQ + replay + rotation)", () => {
  it("200 → DELIVERED with attempts/responseStatus, lastError cleared, no retry job", async () => {
    const { sub } = await makeSub();
    const d = await makeDelivery(sub!.id);
    await deliverWebhook(db, d.id, 1, fakeQueue);

    const row = await deliveryRow(d.id);
    expect(row?.status).toBe("DELIVERED");
    expect(row?.attempts).toBe(1);
    expect(row?.responseStatus).toBe(200);
    expect(row?.lastError).toBeNull();
    expect(row?.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(queueCalls).toHaveLength(0);
    expect(received).toHaveLength(1);
    expect(received[0]!.headers["x-zfloat-delivery"]).toBe(d.id);
  });

  it("HTTP 400 is a PERMANENT failure — FAILED on the DLQ at attempt 1 with lastError, no retries", async () => {
    mode = "http400";
    const { sub } = await makeSub();
    const d = await makeDelivery(sub!.id);
    await deliverWebhook(db, d.id, 1, fakeQueue);

    const row = await deliveryRow(d.id);
    expect(row?.status).toBe("FAILED");
    expect(row?.attempts).toBe(1);
    expect(row?.responseStatus).toBe(400);
    expect(row?.lastError).toContain("HTTP 400");
    expect(row?.lastError).toContain("permanent");
    expect(queueCalls).toHaveLength(0); // no retry ladder burned
  });

  it("HTTP 5xx is retryable: PENDING + nextRetryAt + queued attempt 2 with lastError recorded", async () => {
    mode = "http500";
    const { sub } = await makeSub();
    const d = await makeDelivery(sub!.id);
    await deliverWebhook(db, d.id, 1, fakeQueue);

    const row = await deliveryRow(d.id);
    expect(row?.status).toBe("PENDING");
    expect(row?.attempts).toBe(1);
    expect(row?.responseStatus).toBe(503);
    expect(row?.lastError).toContain("HTTP 503");
    expect(row?.nextRetryAt).toBeInstanceOf(Date);
    expect(queueCalls).toHaveLength(1);
    expect(queueCalls[0]!.payload.attempt).toBe(2);
    expect(queueCalls[0]!.opts?.jobId).toBe(`whd-${d.id}-2`);

    // second attempt succeeds
    mode = "ok";
    await deliverWebhook(db, d.id, 2, fakeQueue);
    const after = await deliveryRow(d.id);
    expect(after?.status).toBe("DELIVERED");
    expect(after?.attempts).toBe(2);
    expect(after?.lastError).toBeNull();
  });

  it("network refusal records a readable lastError and retries (queue), then fails after attempts are exhausted", async () => {
    mode = "refuse";
    const { sub } = await makeSub();
    const d = await makeDelivery(sub!.id);
    await deliverWebhook(db, d.id, 1, fakeQueue);
    let row = await deliveryRow(d.id);
    expect(row?.status).toBe("PENDING");
    expect(row?.lastError).toContain("failed");
    expect(row?.attempts).toBe(1);

    await deliverWebhook(db, d.id, 5, fakeQueue);
    row = await deliveryRow(d.id);
    expect(row?.status).toBe("FAILED"); // attempt 5 = exhausted → DLQ
    expect(row?.lastError).toContain("failed");
  });

  it("disabled subscription fails the delivery with an explanatory lastError", async () => {
    const { sub } = await makeSub();
    await db.update(schema.webhookSubscriptions).set({ status: "DISABLED" }).where(eq(schema.webhookSubscriptions.id, sub!.id));
    const d = await makeDelivery(sub!.id);
    await deliverWebhook(db, d.id, 1, fakeQueue);
    const row = await deliveryRow(d.id);
    expect(row?.status).toBe("FAILED");
    expect(row?.lastError).toContain("not ACTIVE");
  });

  it("replay: FAILED delivery is reset, re-enqueued and delivers with a fresh signature", async () => {
    const { sub, secret } = await makeSub();
    const d = await makeDelivery(sub!.id);

    // fail it permanently via 400
    mode = "http400";
    await deliverWebhook(db, d.id, 1, fakeQueue);
    expect((await deliveryRow(d.id))?.status).toBe("FAILED");

    // replay guards: only FAILED may replay
    await expect(replayDelivery(db, crypto.randomUUID(), fakeQueue)).rejects.toThrow(DeliveryReplayError);
    await expect(replayDelivery(db, d.id, fakeQueue)).resolves.toMatchObject({ id: d.id, status: "PENDING", attempt: 1 });
    const reset = await deliveryRow(d.id);
    expect(reset?.status).toBe("PENDING");
    expect(reset?.attempts).toBe(0);
    expect(reset?.lastError).toBeNull();
    expect(reset?.responseStatus).toBeNull();
    expect(queueCalls).toHaveLength(1);
    expect(queueCalls[0]!.payload).toMatchObject({ deliveryId: d.id, attempt: 1 });

    // replay of an already-replayed (PENDING) delivery is refused
    await expect(replayDelivery(db, d.id, fakeQueue)).rejects.toThrow(/Only FAILED deliveries/);

    // now the endpoint heals — delivery succeeds and re-signs with current secret
    mode = "ok";
    await deliverWebhook(db, d.id, 1, fakeQueue);
    const done = await deliveryRow(d.id);
    expect(done?.status).toBe("DELIVERED");
    expect(done?.attempts).toBe(1);
    expect(verifyPayloadSignature(secret, done!.payloadBody!, done!.signature!)).toBe(true);
  });

  it("replay refuses when the subscription is disabled (endpoint cannot receive)", async () => {
    const { sub } = await makeSub();
    const d = await makeDelivery(sub!.id);
    mode = "http400";
    await deliverWebhook(db, d.id, 1, fakeQueue);
    await db.update(schema.webhookSubscriptions).set({ status: "DISABLED" }).where(eq(schema.webhookSubscriptions.id, sub!.id));
    await expect(replayDelivery(db, d.id, fakeQueue)).rejects.toThrow(/not ACTIVE/);
  });

  it("rotation: bumps secret_version, returns a new secret once, and later attempts re-sign with it", async () => {
    const { sub, secret: oldSecret } = await makeSub();
    expect((await db.select().from(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.id, sub!.id)).limit(1))[0]?.secretVersion).toBe(1);

    const rotated = await rotateSubscriptionSecret(db, sub!.id);
    expect(rotated.id).toBe(sub!.id);
    expect(rotated.secret).not.toBe(oldSecret);
    expect(rotated.secret).toMatch(/^[0-9a-f]{48}$/);
    expect(rotated.version).toBe(2);
    const row = await db.select().from(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.id, sub!.id)).limit(1);
    expect(row[0]?.secretVersion).toBe(2);
    expect(row[0]?.secretRotatedAt).toBeInstanceOf(Date);

    // A delivery made under the OLD secret is re-signed with the NEW secret on
    // its next attempt — the stored signature verifies against the new secret.
    const d = await makeDelivery(sub!.id);
    mode = "ok";
    await deliverWebhook(db, d.id, 1, fakeQueue);
    const done = await deliveryRow(d.id);
    expect(done?.status).toBe("DELIVERED");
    expect(verifyPayloadSignature(rotated.secret, done!.payloadBody!, done!.signature!)).toBe(true);
    expect(verifyPayloadSignature(oldSecret, done!.payloadBody!, done!.signature!)).toBe(false);

    await expect(rotateSubscriptionSecret(db, crypto.randomUUID())).rejects.toThrow(SecretRotationError);
  });

  it("replayed delivery after rotation carries the new secret's signature end-to-end", async () => {
    const { sub } = await makeSub();
    const d = await makeDelivery(sub!.id);
    mode = "http400";
    await deliverWebhook(db, d.id, 1, fakeQueue);
    expect((await deliveryRow(d.id))?.status).toBe("FAILED");

    const rotated = await rotateSubscriptionSecret(db, sub!.id); // tenant rotated while it was down
    await replayDelivery(db, d.id, fakeQueue);
    mode = "ok";
    await deliverWebhook(db, d.id, 1, fakeQueue);

    const done = await deliveryRow(d.id);
    expect(done?.status).toBe("DELIVERED");
    expect(verifyPayloadSignature(rotated.secret, done!.payloadBody!, done!.signature!)).toBe(true);
  });

  it("helpers: generateSigningSecret is random hex; sign/verify stay constant-time compatible", () => {
    const a = generateSigningSecret();
    const b = generateSigningSecret();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(a).not.toBe(b);
    const sig = signPayload(a, '{"x":1}');
    expect(verifyPayloadSignature(a, '{"x":1}', sig)).toBe(true);
    expect(verifyPayloadSignature(b, '{"x":1}', sig)).toBe(false);
  });
});
