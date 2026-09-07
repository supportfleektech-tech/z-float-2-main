#!/usr/bin/env node
/**
 * scripts/soak/mixed.mjs — GAP closeout: clean webhook fan-out + reports +
 * notifications load in one bounded profile, all against a LIVE receiver.
 * Evidence: data/soak/mixed-<ts>.json
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const base = process.env.BASE_URL ?? "http://localhost:3000";
const N = Math.min(Number(process.argv[2] ?? 60) || 60, 200);
const M = Math.min(Number(process.argv[3] ?? 12) || 12, 40);
const K = Math.min(Number(process.argv[4] ?? 40) || 40, 120);
const email = process.env.DEMO_EMAIL ?? "demo@zfloat.app";
const password = process.env.DEMO_PASSWORD ?? "Demo@12345";

async function jfetch(path, init = {}, cookie = "") {
  const headers = { ...(init.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  if (init.body) headers["content-type"] = "application/json";
  const res = await fetch(base + path, { ...init, headers, redirect: "manual" });
  let body = null;
  try { body = await res.json(); } catch {}
  return { res, body };
}

const login = await jfetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
const cm = (login.res.headers.get("set-cookie") ?? "").match(/zf_session=([^;]+)/);
if (!cm) throw new Error(`login failed ${login.res.status}`);
const cookie = `zf_session=${cm[1]}`;

// 1. live receiver + ACTIVE subscription via the product API
const hits = [];
const receiver = createServer((req, res2) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    hits.push({ sig: req.headers["x-zfloat-signature"] ?? null });
    res2.writeHead(200, { "content-type": "application/json" });
    res2.end(JSON.stringify({ ok: true }));
  });
});
await new Promise((r) => receiver.listen(0, "127.0.0.1", r));
const subUrl = `http://127.0.0.1:${receiver.address().port}/hook`;
const subRes = await jfetch("/api/webhooks", { method: "POST", body: JSON.stringify({ name: `soak-fanout-${Date.now()}`, url: subUrl, events: ["payment.completed"] }) }, cookie);
const sub = subRes.body?.data;
if (!sub?.id) { console.error("subscribe failed", JSON.stringify(subRes.body).slice(0, 300)); process.exit(2); }

// 2. API keys, round-robin under the documented 60/min/key guard
const keyCount = Math.max(1, Math.ceil(N / 55));
const keys = [];
for (let i = 0; i < keyCount; i++) {
  const k = await jfetch("/api/developers/keys", { method: "POST", body: JSON.stringify({ name: `soak-mixed-${Date.now()}-${i}` }) }, cookie);
  if (!k.body?.data?.secret) { console.error("key create failed"); process.exit(2); }
  keys.push(k.body.data.secret);
}

const t0 = Date.now();
const lat = [];
const statuses = {};
const errors = [];
for (let i = 0; i < N; i++) {
  const s = Date.now();
  const p = await jfetch("/api/public/v1/payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${keys[i % keys.length]}` },
    body: JSON.stringify({ amount: "1.00", recipient: { name: `Mixed ${i}` }, idempotencyKey: `mixed-${t0}-${i}` }),
  });
  statuses[p.res.status] = (statuses[p.res.status] ?? 0) + 1;
  if (!p.res.ok) errors.push({ at: i, status: p.res.status, code: p.body?.error?.code });
  lat.push(Date.now() - s);
}

// 3. reports burst (reports.generate queue)
const reports = [];
for (let i = 0; i < M; i++) {
  const r = await jfetch("/api/reports", { method: "POST", body: JSON.stringify({ reportType: i % 2 === 0 ? "transactions" : "fees" }) }, cookie);
  if (r.body?.data?.id) reports.push(r.body.data.id);
}

// 4. notifications burst via the real API queue path
const notifRows = [];
for (let i = 0; i < K; i++) {
  const n = await jfetch("/api/notifications/test", { method: "POST", body: JSON.stringify({ channel: "EMAIL", title: `soak ${i}` }) }, cookie);
  if (n.body?.data?.id) notifRows.push(n.body.data.id);
}

// 5. drain: the receiver hit-count is the authoritative fan-out proof (the
// webhooks list caps at 25 rows, so DB totals come from an optional psql
// assertion when SOAK_PSQL is provided).
const deadline = Date.now() + 150_000;
while (Date.now() < deadline && hits.length < N) {
  await new Promise((r) => setTimeout(r, 1000));
}
await new Promise((r) => setTimeout(r, 2000));
const fin = await jfetch("/api/webhooks", {}, cookie);
const deliveries = (fin.body?.data?.deliveries ?? []).filter((x) => x.subscriptionId === sub.id);
const delivBy = {};
for (const dv of deliveries) delivBy[dv.status] = (delivBy[dv.status] ?? 0) + 1;

// optional direct-DB totals (SOAK_PSQL=postgresql://…)
let dbTotals = null;
if (process.env.SOAK_PSQL) {
  const { execFileSync } = await import("node:child_process");
  try {
    const q = `select status, count(*) from webhook_deliveries where subscription_id='${sub.id}' group by status;`;
    const raw = execFileSync("psql", [process.env.SOAK_PSQL, "-t", "-c", q], { encoding: "utf8" });
    dbTotals = raw.trim().split("\n").filter(Boolean).map((l) => l.split("|").map((x) => x.trim()));
  } catch (e) {
    dbTotals = { error: String(e).slice(0, 200) };
  }
}

const out = {
  at: new Date().toISOString(),
  platform: "sandbox demo stack (single node, mock provider, live local receiver) — observation, not a benchmark",
  paymentsRequested: N,
  paymentsAccepted: statuses[201] ?? 0,
  paymentStatuses: statuses,
  latencyMs: lat.length
    ? {
        p50: [...lat].sort((a, b) => a - b)[Math.floor(lat.length / 2)],
        p95: [...lat].sort((a, b) => a - b)[Math.floor(lat.length * 0.95)],
        max: Math.max(...lat),
      }
    : null,
  errors: errors.slice(0, 5),
  fanout: {
    subscriptionUrl: subUrl,
    expectedDeliveries: N,
    deliveryStatuses: delivBy,
    receiverHttp200s: hits.length,
    signaturesPresent: hits.filter((h) => h.sig).length,
    dbTotals,
  },
  reportsRequested: M,
  reportsIds: reports.length,
  notificationsQueued: notifRows.length,
  totalMs: Date.now() - t0,
};
// hygiene: never leave dangling ACTIVE fixtures
await jfetch(`/api/webhooks/${sub.id}`, { method: "PATCH", body: JSON.stringify({ status: "DISABLED" }) }, cookie);
receiver.close();

const dbOk = !dbTotals || Array.isArray(dbTotals)
  ? (Array.isArray(dbTotals) && dbTotals.length > 0 ? dbTotals.every(([st, n]) => st === "DELIVERED" && Number(n) === N) && dbTotals.length === 1 : dbTotals === null)
  : false;
const pass = out.paymentsAccepted === N && hits.length === N && out.fanout.signaturesPresent === N && out.reportsIds === M && out.notificationsQueued === K && (dbTotals === null || dbOk);
mkdirSync(join(root, "data/soak"), { recursive: true });
const file = join(root, "data/soak", `mixed-${Date.now()}.json`);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`mixed: payments=${out.paymentsAccepted}/${N} fanout=${JSON.stringify(delivBy)} receiver200=${hits.length} sig=${out.fanout.signaturesPresent} reports=${out.reportsIds}/${M} notif=${out.notificationsQueued}/${K} ok=${pass} (${out.totalMs}ms)`);
console.log(`evidence: ${file}`);
process.exit(pass ? 0 : 4);
