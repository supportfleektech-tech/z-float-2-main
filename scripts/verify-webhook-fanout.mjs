#!/usr/bin/env node
/**
 * scripts/verify-webhook-fanout.mjs — live signed webhook fan-out against a
 * real 127.0.0.1 receiver (GAP-ANALYSIS closeout: Phase 7 webhook guarantees
 * exercised over the wire).
 *
 * 1. Starts a local HTTP receiver (random port). Every POST is verified:
 *    HMAC-SHA256 "x-zfloat-signature" over the exact raw body with the
 *    subscription secret the script supplied at creation time, plus the
 *    x-zfloat-event / x-zfloat-delivery headers.
 * 2. Creates a webhook subscription (demo tenant) pointed at the receiver
 *    for payment.completed (plus siblings) with a caller-supplied secret.
 * 3. Fires N live payments through the public API; the outbox relay should
 *    fan each payment.completed event to the receiver with a valid signature.
 * 4. Asserts (bounded wait): receiver got >= N verified deliveries, the DB
 *    deliveries view shows DELIVERED with responseStatus 200, zero FAILED.
 * 5. Writes evidence to data/webhooks/fanout-<ts>.json.
 *
 * Usage: BASE_URL=… node scripts/verify-webhook-fanout.mjs [count]
 */
import { createServer } from "node:http";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const base = process.env.BASE_URL ?? "http://localhost:3000";
const count = Math.min(Number(process.argv[2] ?? 3) || 3, 10);
const email = process.env.DEMO_EMAIL ?? "demo@zfloat.app";
const password = process.env.DEMO_PASSWORD ?? "Demo@12345";
const secret = randomBytes(24).toString("hex"); // we know the secret → independent verification

const received = [];
let receiverOk = true;

async function jfetch(path, init = {}, cookie = "") {
  const headers = { ...(init.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const res = await fetch(base + path, { ...init, headers, redirect: "manual" });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  return { res, body };
}

function validSig(bodyRaw, signature) {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(bodyRaw).digest("hex");
  if (signature.length !== expected.length) return false;
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const receiver = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const bodyRaw = Buffer.concat(chunks).toString("utf8");
    const headers = req.headers;
    const signature = String(headers["x-zfloat-signature"] ?? "");
    const sigOk = validSig(bodyRaw, signature);
    let parsed = null;
    try { parsed = JSON.parse(bodyRaw); } catch { /* not JSON */ }
    received.push({
      at: new Date().toISOString(),
      event: headers["x-zfloat-event"] ?? null,
      deliveryId: headers["x-zfloat-delivery"] ?? null,
      signatureValid: sigOk,
      status: parsed?.status ?? null,
      idempotencyKey: parsed?.idempotencyKey ?? null,
      eventType: parsed?.eventType ?? null,
    });
    if (!sigOk) receiverOk = false;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
});

const t0 = Date.now();
const ts = String(t0);
const results = { at: new Date().toISOString(), ok: false, receiver: null, db: null, steps: [] };

try {
  const listenP = new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  await listenP;
  const port = receiver.address().port;
  const hookUrl = `http://127.0.0.1:${port}/hook`;
  results.steps.push({ t: "receiver listening", hookUrl });

  // Session
  const login = await jfetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const setCookie = login.res.headers.get("set-cookie") ?? "";
  const session = (setCookie.match(/zf_session=[^;]+/) ?? [""])[0];
  if (!login.res.ok || !session) throw new Error(`login failed: ${login.res.status}`);

  // Subscription
  const subRes = await jfetch(
    "/api/webhooks",
    { method: "POST", body: JSON.stringify({ name: "fanout-live-probe", url: hookUrl, secret, events: ["payment.completed", "payment.failed", "payment.reversed", "batch.completed", "wallet.funded"] }) },
    session,
  );
  const sub = subRes.body?.data;
  if (!subRes.res.ok || !sub?.id) throw new Error(`subscription failed: ${subRes.res.status} ${JSON.stringify(subRes.body).slice(0, 200)}`);
  results.steps.push({ t: "subscription created", id: sub.id, secretEchoedCorrectly: sub.secret === secret });
  if (sub.secret !== secret) throw new Error("subscription did not echo the caller-supplied secret");

  // Developer key for the public API
  const keyRes = await jfetch("/api/developers/keys", { method: "POST", body: JSON.stringify({ name: `fanout-key-${ts}` }) }, session);
  const apiKey = keyRes.body?.data?.secret ?? keyRes.body?.data?.key ?? null;
  if (!apiKey) throw new Error("api key creation failed");
  const keyId = keyRes.body?.data?.id ?? null;

  // Live payments
  for (let i = 0; i < count; i++) {
    const p = await jfetch("/api/public/v1/payments", {
      method: "POST",
      body: JSON.stringify({
        amount: "1.00",
        recipient: { name: `Fanout Probe ${i}` },
        remark: `fanout-live-${ts}-${i}`,
        idempotencyKey: `fanout-${ts}-${i}`,
      }),
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!p.res.ok) throw new Error(`payment ${i} failed: ${p.res.status}`);
    results.steps.push({ t: `payment ${i} accepted`, status: p.res.status });
  }

  // Bounded drain: receiver must see all count deliveries, DB must say DELIVERED 200
  const deadline = Date.now() + 45_000;
  let dbDelivered = 0;
  let dbFailed = 0;
  while (Date.now() < deadline && (received.length < count)) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  // Let statuses persist a moment, then pull the tenant delivery log
  await new Promise((r) => setTimeout(r, 2000));
  const delRes = await jfetch("/api/webhooks", {}, session);
  const deliveries = (delRes.body?.data?.deliveries ?? []).filter((d) => d.subscriptionId === sub.id);
  dbDelivered = deliveries.filter((d) => d.status === "DELIVERED").length;
  dbFailed = deliveries.filter((d) => d.status === "FAILED").length;
  const badStatuses = deliveries.filter((d) => d.status !== "DELIVERED").map((d) => d.status);
  const badHttp = deliveries.filter((d) => d.responseStatus !== 200).map((d) => d.responseStatus);

  results.receiver = { expected: count, received: received.length, verified: received.filter((r) => r.signatureValid).length, allSignaturesValid: receiverOk, events: [...new Set(received.map((r) => r.event))] };
  results.db = { total: deliveries.length, delivered: dbDelivered, failed: dbFailed, nonDeliveredStatuses: badStatuses, non200: badHttp };
  results.ok = received.length >= count && receiverOk && dbDelivered >= count && dbFailed === 0 && badStatuses.length === 0 && badHttp.length === 0;

  // Cleanup the probe subscription
  await fetch(`${base}/api/webhooks/${sub.id}`, { method: "DELETE", headers: { cookie: session } }).catch(() => {});
} catch (err) {
  results.error = String(err?.message ?? err);
} finally {
  receiver.close();
  results.verdict = results.ok ? "PASS" : "FAIL";
  const dir = join(root, "data", "webhooks");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `fanout-${ts}.json`);
  writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(
    `fanout: expected=${count} received=${results.receiver?.received ?? 0} verified=${results.receiver?.verified ?? 0} dbDelivered=${results.db?.delivered ?? 0} dbFailed=${results.db?.failed ?? 0} → ${results.verdict}`,
  );
  console.log(`evidence: ${file}`);
  process.exit(results.ok ? 0 : 6);
}
