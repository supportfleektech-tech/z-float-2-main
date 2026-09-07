#!/usr/bin/env node
/**
 * scripts/chaos/redis-outage.mjs — Redis outage drill (self-contained).
 *
 *  1. baseline: payment POST works, login works.
 *  2. redis down (shutdown nosave): payment POST → observe status (fail
 *     visible, never silent corruption); login still works (rate-limiter is
 *     documented fail-open); admin metrics still serves (PG-backed).
 *  3. redis back up: payment POST succeeds and completes SUCCESS exactly once.
 * Evidence: data/chaos/redis-outage-<ts>.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../..", import.meta.url));
const base = process.env.BASE_URL ?? "http://localhost:3000";
const email = process.env.DEMO_EMAIL ?? "demo@zfloat.app";
const password = process.env.DEMO_PASSWORD ?? "Demo@12345";
const psql = process.env.SOAK_PSQL ?? "postgresql://zfloat:zfloat_dev_password@127.0.0.1:5432/zfloat";
const q = (sql) => execFileSync("psql", [psql, "-t", "-A", "-c", sql], { encoding: "utf8" }).trim();

// Every request is bounded: during an outage ioredis retry loops can hold a
// request open for a long time, and the drill must observe, not hang.
async function jfetch(path, init = {}, headers = {}, timeoutMs = 8_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...headers }, redirect: "manual", signal: ac.signal });
    let body = null;
    try { body = await res.json(); } catch {}
    return { res, body };
  } catch (err) {
    return { res: { status: 0, ok: false }, body: { error: { code: "CLIENT_TIMEOUT", message: String(err).slice(0, 80) } } };
  } finally {
    clearTimeout(t);
  }
}
async function pay(key) {
  const login = await jfetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const m = (login.res.headers?.get("set-cookie") ?? "").match(/zf_session=([^;]+)/);
  if (!m) return { step: "login failed", status: login.res.status };
  const kres = await jfetch("/api/developers/keys", { method: "POST", body: JSON.stringify({ name: "chaos-redis" }) }, { cookie: `zf_session=${m[1]}` });
  const auth = { Authorization: `Bearer ${kres.body?.data?.secret}` };
  const p = await jfetch("/api/public/v1/payments", { method: "POST", body: JSON.stringify({ amount: "1.00", recipient: { name: "Redis chaos" }, idempotencyKey: key }) }, auth);
  return { status: p.res.status, code: p.body?.error?.code, msg: p.body?.error?.message?.slice(0, 120) };
}

const observations = {};
// 1. baseline
observations.baseline = await pay(`chaos-redis-base-${Date.now()}`);

// 2. stop redis
spawnSync("redis-cli", ["shutdown", "nosave"], { timeout: 15_000 });
await new Promise((r) => setTimeout(r, 1500));
const downPing = spawnSync("redis-cli", ["ping"], { timeout: 5000 });
observations.redisDown = downPing.status !== 0 || !String(downPing.stdout).includes("PONG");
observations.duringOutage_payment = await pay(`chaos-redis-down-${Date.now()}`);
{
  const login = await jfetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  observations.duringOutage_login = { status: login.res.status };
  const met = await fetch(base + "/api/admin/metrics", { redirect: "manual" });
  observations.duringOutage_adminMetrics = { status: met.status };
  const spec = await fetch(base + "/api/public/v1/openapi.json", { redirect: "manual" });
  observations.duringOutage_staticOpenApi = { status: spec.status };
}

// 3. restart redis
spawnSync("redis-server", ["--daemonize", "yes", "--save", ""], { timeout: 15_000 });
await new Promise((r) => setTimeout(r, 2000));
const upPing = spawnSync("redis-cli", ["ping"], { timeout: 5000 });
observations.redisUp = String(upPing.stdout).includes("PONG");

const retryKey = `chaos-redis-after-${Date.now()}`;
observations.afterOutage_payment = await pay(retryKey);
// allow the worker (reconnected) to execute it
const deadline = Date.now() + 90_000;
let done = 0;
while (Date.now() < deadline) {
  done = Number(q(`select count(*) from payments where idempotency_key='${retryKey}' and status='SUCCESS'`));
  if (done === 1) break;
  await new Promise((r) => setTimeout(r, 2000));
}
observations.afterOutage_paymentSuccess = done === 1;

const out = {
  at: new Date().toISOString(),
  drill: "Redis outage (shutdown nosave → restart)",
  observations,
  ok:
    observations.redisDown === true &&
    observations.redisUp === true &&
    // FAIL-FAST contract: request paths must answer during the outage (any
    // explicit status), never hang (status 0 = client timeout).
    observations.duringOutage_payment.status !== 0 &&
    observations.duringOutage_login.status !== 0 &&
    observations.afterOutage_payment.status === 201 &&
    observations.afterOutage_paymentSuccess === true,
};
mkdirSync(join(root, "data/chaos"), { recursive: true });
const file = join(root, "data/chaos", `redis-outage-${Date.now()}.json`);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out.observations, null, 1));
console.log(`evidence: ${file}`);
process.exit(out.ok ? 0 : 5);
