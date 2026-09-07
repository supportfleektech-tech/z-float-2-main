#!/usr/bin/env node
/**
 * scripts/soak/run.mjs — bounded load/soak profile (GAP-ANALYSIS Phase 9).
 *
 * What it does (all against the LIVE sandbox stack, mock provider):
 *  1. Creates N concurrent public-API payments (configurable bursts) with
 *     unique idempotency keys, measuring per-request latency + errors.
 *  2. Waits for the outbox/queue pipeline to drain (bounded), then records
 *     queue depths + outbox lag from /api/admin/metrics.
 *  3. Writes honest results to data/soak/<ts>/results.json + a summary line —
 *     a load OBSERVATION, not a benchmark claim (single sandbox node).
 *
 * Usage: BASE_URL=… node scripts/soak/run.mjs [total] [burst]
 * (requires a demo/ops login + platform admin session for /metrics; admin
 * creds via ADMIN_EMAIL/ADMIN_PASSWORD env or defaults).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const base = process.env.BASE_URL ?? "http://localhost:3000";
const total = Math.min(Number(process.argv[2] ?? 120) || 120, 500);
const burst = Math.min(Number(process.argv[3] ?? 10) || 10, 50);
// The public API enforces 60 req/min per KEY (documented guard). A soak of the
// pipeline must not trip that guard, so we round-robin across several keys
// (mirrors a tenant holding multiple keys); the per-key limiter still applies.
const keyCount = Math.min(Math.max(1, Math.ceil(total / 55)), 8);
const demoEmail = process.env.DEMO_EMAIL ?? "demo@zfloat.app";
const demoPassword = process.env.DEMO_PASSWORD ?? "Demo@12345";
const adminEmail = process.env.ADMIN_EMAIL ?? "admin@zfloat.app";
const adminPassword = process.env.ADMIN_PASSWORD ?? "Demo@12345";

async function login(email, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  const m = (res.headers.get("set-cookie") ?? "").match(/zf_session=([^;]+)/);
  if (!m) throw new Error(`login failed for ${email}: ${res.status}`);
  return `zf_session=${m[1]}`;
}

const startedAt = Date.now();
const cookie = await login(demoEmail, demoPassword);
const adminCookie = await login(adminEmail, adminPassword);

// API key via the real developer flow
const keys = [];
for (let k = 0; k < keyCount; k++) {
  const kres = await fetch(`${base}/api/developers/keys`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: `soak-${Date.now()}-${k}` }),
  });
  const kbody = await kres.json();
  const key = kbody?.data?.secret;
  if (!key) throw new Error("soak: could not create API key");
  keys.push(key);
}
const authFor = (at) => ({ Authorization: `Bearer ${keys[at % keys.length]}` });

async function metricsText() {
  const res = await fetch(`${base}/api/admin/metrics`, { headers: { cookie: adminCookie } });
  return res.ok ? res.text() : "";
}

async function waitForDrain(deadlineMs) {
  while (Date.now() < deadlineMs) {
    const text = await metricsText();
    const waiting = [...text.matchAll(/zfloat_queue_jobs\{[^}]*state="waiting"\} (\d+)/g)].reduce((a, m) => a + Number(m[1]), 0);
    const outbox = Number(text.match(/zfloat_outbox_unpublished (\d+)/)?.[1] ?? -1);
    if (waiting === 0 && outbox === 0) return { waiting, outbox };
    await new Promise((r) => setTimeout(r, 500));
  }
  const text = await metricsText();
  const waiting = [...text.matchAll(/zfloat_queue_jobs\{[^}]*state="waiting"\} (\d+)/g)].reduce((a, m) => a + Number(m[1]), 0);
  const outbox = Number(text.match(/zfloat_outbox_unpublished (\d+)/)?.[1] ?? -1);
  return { waiting, outbox, drained: false };
}

const latencies = [];
const errors = [];
const statuses = {};
let burstStart = Date.now();
for (let i = 0; i < total; i += burst) {
  const slice = Math.min(burst, total - i);
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: slice }, async (_, k) => {
      const s = Date.now();
      try {
        const res = await fetch(`${base}/api/public/v1/payments`, {
          method: "POST",
          headers: { ...authFor(i + k), "content-type": "application/json" },
          body: JSON.stringify({
            amount: "1.00",
            channel: "mpesa",
            recipient: { name: `Soak ${k}` },
            idempotencyKey: `soak-${startedAt}-${i}-${k}`,
          }),
        });
        const body = await res.json().catch(() => null);
        statuses[res.status] = (statuses[res.status] ?? 0) + 1;
        if (!res.ok && res.status !== 201 && !(res.status === 200 && body?.data?.replayed)) {
          errors.push({ at: i + k, status: res.status, code: body?.error?.code, message: body?.error?.message });
        }
        latencies.push(Date.now() - s);
      } catch (e) {
        errors.push({ at: i + k, network: String(e) });
        latencies.push(Date.now() - s);
      }
    }),
  );
  burstStart = Date.now() - t0;
}

const writeAt = Date.now();
const drain = await waitForDrain(writeAt + 90_000);
const metricsAfter = await metricsText();
const parse = (re) => Number(metricsAfter.match(re)?.[1] ?? -1);
const summary = {
  at: new Date().toISOString(),
  platform: "sandbox demo stack (single node, mock provider) — observation, not a benchmark",
  requested: total,
  accepted: (statuses[201] ?? 0) + (statuses[200] ?? 0),
  rejected: errors.length,
  statusBreakdown: statuses,
  latencyMs: latencies.length
    ? {
        min: Math.min(...latencies),
        p50: [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length / 2)],
        p95: [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)],
        max: Math.max(...latencies),
        mean: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      }
    : null,
  errors: errors.slice(0, 10),
  drain: { ...drain, deadlineMs: 90_000 },
  metricsAfterDrain: {
    queueWaiting:
      metricsAfter.match(/zfloat_queue_jobs\{[^}]*state="waiting"\} (\d+)/) === null
        ? "n/a"
        : [...metricsAfter.matchAll(/zfloat_queue_jobs\{[^}]*state="waiting"\} (\d+)/g)].reduce((a, m) => a + Number(m[1]), 0),
    outboxUnpublished: parse(/zfloat_outbox_unpublished (\d+)/),
    workerHeartbeatAgeS: parse(/zfloat_worker_heartbeat_age_seconds (\d+)/),
  },
};
const dir = join(root, "data", "soak");
mkdirSync(dir, { recursive: true });
const file = join(dir, `soak-${Date.now()}.json`);
writeFileSync(file, JSON.stringify(summary, null, 2) + "\n");
console.log(`soak: requested=${total} accepted=${summary.accepted} rejected=${summary.rejected} p50=${summary.latencyMs?.p50}ms p95=${summary.latencyMs?.p95}ms drain=${JSON.stringify(drain)}`);
console.log(`results: ${file}`);
process.exit(summary.rejected === 0 ? 0 : 2);
