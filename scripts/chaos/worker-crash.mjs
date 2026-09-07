#!/usr/bin/env node
/**
 * scripts/chaos/worker-crash.mjs — drill phase runner (worker kill/recovery).
 *
 * Orchestrated by the operator between phases (the worker process is
 * externally SIGSTOPped/SIGKILLed/restarted):
 *   phase=submit         → fire N public-API payments (multi-key)
 *   phase=assert-paused  → worker must NOT progress them (all still QUEUED-ish)
 *   phase=assert-recover → after restart: every payment SUCCESS exactly once;
 *                          journals balanced; no duplicates; writes evidence.
 * Evidence: data/chaos/worker-crash-<ts>.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../..", import.meta.url));
const base = process.env.BASE_URL ?? "http://localhost:3000";
const phase = process.argv[2] ?? "submit";
const N = Math.min(Number(process.argv[3] ?? 40) || 40, 150);
const email = process.env.DEMO_EMAIL ?? "demo@zfloat.app";
const password = process.env.DEMO_PASSWORD ?? "Demo@12345";
const psql = process.env.SOAK_PSQL ?? "postgresql://zfloat:zfloat_dev_password@127.0.0.1:5432/zfloat";

async function jfetch(path, init = {}, cookie = "") {
  const headers = { ...(init.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  if (init.body) headers["content-type"] = "application/json";
  const res = await fetch(base + path, { ...init, headers, redirect: "manual" });
  let body = null;
  try { body = await res.json(); } catch {}
  return { res, body };
}
const q = (sql) => execFileSync("psql", [psql, "-t", "-A", "-c", sql], { encoding: "utf8" }).trim();

if (phase === "submit") {
  const login = await jfetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const cm = (login.res.headers.get("set-cookie") ?? "").match(/zf_session=([^;]+)/);
  if (!cm) throw new Error("login failed");
  const cookie = `zf_session=${cm[1]}`;
  const keyCount = Math.max(1, Math.ceil(N / 55));
  const keys = [];
  for (let i = 0; i < keyCount; i++) {
    const k = await jfetch("/api/developers/keys", { method: "POST", body: JSON.stringify({ name: `chaos-${Date.now()}-${i}` }) }, cookie);
    keys.push(k.body?.data?.secret);
  }
  const t0 = Date.now();
  let accepted = 0;
  const statuses = {};
  for (let i = 0; i < N; i++) {
    const p = await jfetch("/api/public/v1/payments", {
      method: "POST",
      headers: { Authorization: `Bearer ${keys[i % keys.length]}` },
      body: JSON.stringify({ amount: "1.00", recipient: { name: `Chaos ${i}` }, idempotencyKey: `chaos-${t0}-${i}` }),
    });
    statuses[p.res.status] = (statuses[p.res.status] ?? 0) + 1;
    if (p.res.status === 201) accepted++;
  }
  console.log(`[chaos submit] accepted=${accepted}/${N} statuses=${JSON.stringify(statuses)} marker=${t0}`);
  process.exit(accepted === N ? 0 : 2);
}

if (phase === "assert-paused") {
  const marker = process.argv[4] ?? "";
  const before = q(`select count(*) from payments where idempotency_key like 'chaos-${marker}-%' and status='SUCCESS'`);
  await new Promise((r) => setTimeout(r, 12_000));
  const after = q(`select count(*) from payments where idempotency_key like 'chaos-${marker}-%' and status='SUCCESS'`);
  const queued = q(`select count(*) from payments where idempotency_key like 'chaos-${marker}-%' and status='QUEUED'`);
  const ok = before === "0" && after === "0" && Number(queued) > 0;
  console.log(`[chaos paused] success@0s=${before} success@12s=${after} queued=${queued} -> worker paused as expected: ${ok}`);
  process.exit(ok ? 0 : 3);
}

if (phase === "assert-recover") {
  const marker = process.argv[4] ?? "";
  const deadline = Date.now() + 180_000;
  let done = 0;
  while (Date.now() < deadline) {
    done = Number(q(`select count(*) from payments where idempotency_key like 'chaos-${marker}-%' and status='SUCCESS'`));
    if (done === N) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  await new Promise((r) => setTimeout(r, 3000));
  const total = Number(q(`select count(*) from payments where idempotency_key like 'chaos-${marker}-%'`));
  const dupeKeys = q(`select count(*) from (select idempotency_key from payments where idempotency_key like 'chaos-${marker}-%' group by idempotency_key having count(*)>1) d`);
  const imbalanced = q(`select count(*) from (select j.id from journals j join journal_entries je on je.journal_id=j.id where j.created_at > now() - interval '12 minutes' group by j.id having sum(je.debit_minor)<>sum(je.credit_minor)) x`);
  const out = {
    at: new Date().toISOString(),
    drill: "worker SIGSTOP->SIGKILL->restart (crash recovery)",
    marker: `chaos-${marker}-%`,
    paymentsTotal: total,
    paymentsSuccess: done,
    duplicateIdempotencyKeys: Number(dupeKeys),
    imbalancedJournals: Number(imbalanced),
    ok: done === N && total === N && dupeKeys === "0" && imbalanced === "0",
  };
  mkdirSync(join(root, "data/chaos"), { recursive: true });
  const file = join(root, "data/chaos", `worker-crash-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`[chaos recover] success=${done}/${N} total=${total} dupes=${dupeKeys} imbalanced=${imbalanced} ok=${out.ok}`);
  console.log(`evidence: ${file}`);
  process.exit(out.ok ? 0 : 4);
}
console.error("unknown phase", phase);
process.exit(9);
