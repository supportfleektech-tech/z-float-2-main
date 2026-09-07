#!/usr/bin/env node
/**
 * scripts/chaos/pg-outage.mjs - Postgres outage drill (self-contained, sudo).
 *  1. baseline: payment 201 + completes SUCCESS.
 *  2. stop the PG cluster: DB-backed routes must answer FAST with an explicit
 *     error (never hang); stateless routes (openapi doc) keep working.
 *  3. start the cluster: payment again -> 201 -> SUCCESS.
 * Evidence: data/chaos/pg-outage-<ts>.json
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

async function jfetch(path, init = {}, headers = {}, timeoutMs = 10_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...headers }, redirect: "manual", signal: ac.signal });
    let body = null;
    try { body = await res.json(); } catch { body = await res.text().catch(() => null); }
    return { res, body };
  } catch (err) {
    return { res: { status: 0 }, body: { error: { code: "CLIENT_TIMEOUT", message: String(err).slice(0, 80) } } };
  } finally {
    clearTimeout(t);
  }
}
async function login() {
  const r = await jfetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const m = (r.res.headers?.get("set-cookie") ?? "").match(/zf_session=([^;]+)/);
  return m ? `zf_session=${m[1]}` : null;
}
async function pay(key, cookie) {
  const kres = cookie ? await jfetch("/api/developers/keys", { method: "POST", body: JSON.stringify({ name: "chaos-pg" }) }, { cookie }) : null;
  const auth = kres?.body?.data?.secret ? { Authorization: `Bearer ${kres.body.data.secret}` } : {};
  const p = await jfetch("/api/public/v1/payments", { method: "POST", body: JSON.stringify({ amount: "1.00", recipient: { name: "PG chaos" }, idempotencyKey: key }) }, auth);
  return { status: p.res.status, code: p.body?.error?.code };
}

const observations = {};
const cookie = await login();
const baseKey = `chaos-pg-base-${Date.now()}`;
observations.baseline_payment = await pay(baseKey, cookie);
{
  const deadline = Date.now() + 60_000;
  let done = 0;
  while (Date.now() < deadline) {
    done = Number(q(`select count(*) from payments where idempotency_key='${baseKey}' and status='SUCCESS'`));
    if (done === 1) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  observations.baseline_success = done === 1;
}

const stop = spawnSync("sudo", ["pg_ctlcluster", "17", "main", "stop"], { timeout: 30_000 });
observations.pgStopped = stop.status === 0;
await new Promise((r) => setTimeout(r, 2000));

const downKey = `chaos-pg-down-${Date.now()}`;
observations.duringOutage_payment = await pay(downKey, cookie);
{
  const openapi = await jfetch("/api/public/v1/openapi.json", {}, {}, 5000);
  observations.duringOutage_staticOpenApi = { status: openapi.res.status };
  const loginR = await jfetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  observations.duringOutage_login = { status: loginR.res.status, code: loginR.body?.error?.code };
}

const start = spawnSync("sudo", ["pg_ctlcluster", "17", "main", "start"], { timeout: 30_000 });
observations.pgUp = start.status === 0;
await new Promise((r) => setTimeout(r, 3000));

const afterKey = `chaos-pg-after-${Date.now()}`;
const freshCookie = await login();
observations.afterOutage_payment = await pay(afterKey, freshCookie);
{
  const deadline = Date.now() + 90_000;
  let done = 0;
  while (Date.now() < deadline) {
    done = Number(q(`select count(*) from payments where idempotency_key='${afterKey}' and status='SUCCESS'`));
    if (done === 1) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  observations.afterOutage_success = done === 1;
}

const out = {
  at: new Date().toISOString(),
  drill: "Postgres cluster outage (stop -> start)",
  observations,
  ok:
    observations.baseline_success === true &&
    observations.pgStopped === true &&
    observations.pgUp === true &&
    observations.duringOutage_login.status !== 0 &&
    observations.duringOutage_staticOpenApi.status === 200 &&
    observations.afterOutage_payment.status === 201 &&
    observations.afterOutage_success === true,
};
mkdirSync(join(root, "data/chaos"), { recursive: true });
const file = join(root, "data/chaos", `pg-outage-${Date.now()}.json`);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out.observations, null, 1));
console.log(`evidence: ${file}`);
process.exit(out.ok ? 0 : 6);
