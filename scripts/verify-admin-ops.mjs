#!/usr/bin/env node
/**
 * scripts/verify-admin-ops.mjs — live HTTP verification of the Phase 5/7
 * admin surfaces that were previously only build/integration verified:
 *   GET  /api/admin/metrics            (admin-only, Prometheus text)
 *   GET  /api/admin/dsar/export        (200 bundle / 404 / 400 / auth)
 *   POST /api/admin/dsar/erasure       (guardrails only — 422/403/404;
 *        destructive full erasure is integration-proven, NOT repeated on the
 *        seeded demo DB)
 *   POST /api/privacy/requests         (public intake, new)
 *   GET  /api/admin/dsar/requests      (admin intake queue)
 *
 * Usage: node scripts/verify-admin-ops.mjs   → evidence data/admin-api-verify-<ts>.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const base = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = process.env.ADMIN_EMAIL ?? "admin@zfloat.app";
const ADMIN_PW = process.env.ADMIN_PASSWORD ?? "Demo@12345";
const DEMO = process.env.DEMO_EMAIL ?? "demo@zfloat.app";
const DEMO_PW = process.env.DEMO_PASSWORD ?? "Demo@12345";

const results = [];
function record(name, ok, detail = {}) {
  results.push({ name, ok, ...detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${Object.keys(detail).length ? " — " + JSON.stringify(detail).slice(0, 160) : ""}`);
}

async function jfetch(path, init = {}, cookie = "") {
  const headers = { ...(init.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  if (init.body) headers["content-type"] = "application/json";
  const res = await fetch(base + path, { ...init, headers, redirect: "manual" });
  let body = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) { try { body = await res.json(); } catch {} }
  else { try { body = await res.text(); } catch {} }
  return { res, body };
}
async function login(email, password) {
  const { res, body } = await jfetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const m = (res.headers.get("set-cookie") ?? "").match(/zf_session=([^;]+)/);
  if (!m) throw new Error(`login failed for ${email}: ${res.status}`);
  return `zf_session=${m[1]}`;
}

const admin = await login(ADMIN, ADMIN_PW);
const demo = await login(DEMO, DEMO_PW);

// ---- 1. metrics: admin-only Prometheus text
{
  const anon = await jfetch("/api/admin/metrics");
  record("metrics anon → 401/redirect", [401, 302, 307].includes(anon.res.status));
  const asDemo = await jfetch("/api/admin/metrics", {}, demo);
  record("metrics demo user → 403", asDemo.res.status === 403, { status: asDemo.res.status });
  const asAdmin = await jfetch("/api/admin/metrics", {}, admin);
  const text = typeof asAdmin.body === "string" ? asAdmin.body : "";
  const okContent = (asAdmin.res.headers.get("content-type") ?? "").includes("text/plain") || (asAdmin.res.headers.get("content-type") ?? "").includes("text/plain;");
  record("metrics admin → 200 prometheus", asAdmin.res.status === 200 && text.includes("zfloat_queue_jobs") && text.includes("zfloat_outbox_unpublished") && text.includes("zfloat_worker_heartbeat_age_seconds"), { status: asAdmin.res.status, hasQueues: text.includes("zfloat_queue_jobs"), hasOutbox: text.includes("zfloat_outbox_unpublished") });
}

// ---- 2. DSAR export matrix
{
  const byEmail = await jfetch(`/api/admin/dsar/export?email=${encodeURIComponent(DEMO)}`, {}, admin);
  const d = byEmail.body?.data ?? {};
  const exportOk = byEmail.res.status === 200
    && d.subject?.email === DEMO
    && Array.isArray(d.profile?.sessions ?? d.sessions)
    && (d.retained?.loginEvents >= 0 || d.financialRecords);
  record("dsar export by email → 200 bundle", exportOk, { status: byEmail.res.status, keys: Object.keys(d).slice(0, 8) });

  const uuid = d.subject?.id ?? d.userId ?? d.profile?.id;
  const byId = await jfetch(`/api/admin/dsar/export?userId=${uuid}`, {}, admin);
  record("dsar export by userId → 200", byId.res.status === 200 && byId.body?.data?.subject?.id === uuid, { status: byId.res.status });

  const unknown = await jfetch("/api/admin/dsar/export?userId=00000000-0000-4000-8000-000000000000", {}, admin);
  record("dsar export unknown → 404 NOT_FOUND", unknown.res.status === 404 && unknown.body?.error?.code === "NOT_FOUND", { status: unknown.res.status });

  const noParams = await jfetch("/api/admin/dsar/export", {}, admin);
  record("dsar export no params → 400", noParams.res.status === 400, { status: noParams.res.status });

  const anon = await jfetch("/api/admin/dsar/export?email=x@y.z");
  record("dsar export anon → 401/redirect", [401, 302, 307].includes(anon.res.status), { status: anon.res.status });

  // store for erasure checks
  globalThis.__demoUuid = uuid;
}

// ---- 3. DSAR erasure guardrails (never destructive on the demo DB)
{
  const noConfirm = await jfetch("/api/admin/dsar/erasure", { method: "POST", body: JSON.stringify({ userId: globalThis.__demoUuid }) }, admin);
  record("erasure missing confirm → 422 CONFIRM_REQUIRED", noConfirm.res.status === 422 && noConfirm.body?.error?.code === "CONFIRM_REQUIRED", { status: noConfirm.res.status, code: noConfirm.body?.error?.code });

  const selfErase = await jfetch("/api/admin/dsar/erasure", { method: "POST", body: JSON.stringify({ email: ADMIN, confirm: "ERASE" }) }, admin);
  record("erasure self (admin) → 403", selfErase.res.status === 403 && selfErase.body?.error?.code === "SELF_ERASURE_FORBIDDEN", { status: selfErase.res.status, code: selfErase.body?.error?.code });

  const unknown = await jfetch("/api/admin/dsar/erasure", { method: "POST", body: JSON.stringify({ email: "nobody@zfloat.app", confirm: "ERASE" }) }, admin);
  record("erasure unknown → 404", unknown.res.status === 404, { status: unknown.res.status });

  // bad input
  const bad = await jfetch("/api/admin/dsar/erasure", { method: "POST", body: JSON.stringify({ confirm: "ERASE" }) }, admin);
  record("erasure no target → 400", bad.res.status === 400, { status: bad.res.status });
}

// ---- 4. public DSAR intake + admin queue (new surface)
{
  const email = `subject-${Date.now()}@example.com`;
  const intake = await jfetch("/api/privacy/requests", { method: "POST", body: JSON.stringify({ email, type: "EXPORT", name: "Intake Tester", note: "automated intake verification" }) });
  record("intake valid → 201 REQUESTED", intake.res.status === 201 && intake.body?.data?.requestId, { status: intake.res.status, id: intake.body?.data?.requestId });
  const rid = intake.body?.data?.requestId;

  const badType = await jfetch("/api/privacy/requests", { method: "POST", body: JSON.stringify({ email, type: "HACK" }) });
  record("intake bad type → 400", badType.res.status === 400, { status: badType.res.status });
  const badEmail = await jfetch("/api/privacy/requests", { method: "POST", body: JSON.stringify({ email: "not-an-email", type: "EXPORT" }) });
  record("intake bad email → 400", badEmail.res.status === 400, { status: badEmail.res.status });

  const anonList = await jfetch("/api/admin/dsar/requests");
  record("intake queue anon → 401/redirect", [401, 302, 307].includes(anonList.res.status), { status: anonList.res.status });

  const list = await jfetch("/api/admin/dsar/requests?status=REQUESTED", {}, admin);
  const found = (list.body?.data?.requests ?? []).some((r) => r.id === rid && r.requesterEmail === email);
  record("intake queue admin → lists row", list.res.status === 200 && found, { status: list.res.status, total: (list.body?.data?.requests ?? []).length });

  if (rid) {
    const triage = await jfetch("/api/admin/dsar/requests", { method: "PATCH", body: JSON.stringify({ id: rid, status: "IN_REVIEW", note: "identity check in progress" }) }, admin);
    record("intake triage IN_REVIEW", triage.res.status === 200 && triage.body?.data?.status === "IN_REVIEW", { status: triage.res.status });
    const done = await jfetch("/api/admin/dsar/requests", { method: "PATCH", body: JSON.stringify({ id: rid, status: "REJECTED", note: "verification failed (automated drill)" }) }, admin);
    record("intake close REJECTED", done.res.status === 200 && done.body?.data?.status === "REJECTED", { status: done.res.status });
  }
}

const failed = results.filter((r) => !r.ok).length;
const out = { at: new Date().toISOString(), base, results, passed: results.length - failed, failed };
mkdirSync(join(root, "data"), { recursive: true });
const file = join(root, "data", `admin-api-verify-${Date.now()}.json`);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`\n${out.passed}/${results.length} checks passed — evidence: ${file}`);
process.exit(failed === 0 ? 0 : 1);
