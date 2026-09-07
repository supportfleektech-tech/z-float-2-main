#!/usr/bin/env node
/**
 * scripts/verify-dsar-intake.mjs — over-the-wire DSAR verification
 * (GAP-ANALYSIS closeout: Phase 5 routes never exercised over HTTP).
 *
 * Full data-subject journey against the live stack:
 *  1. PUBLIC self-service intake  POST /api/privacy/requests  (no session) —
 *     only opens a REQUESTED row; it never executes fulfilment itself.
 *  2. Guardrails: anonymous access to the admin queue/export/erasure → 401.
 *  3. Admin journey: invite+register a real subject via the wire, review the
 *     queue (PATCH REQUESTED→IN_REVIEW→COMPLETED), export a data bundle,
 *     erasure confirm-required (422) → export still intact → confirm "ERASE"
 *     → subject anonymized (erased-@erased.invalid), re-export 404.
 *  4. Self-erasure guardrail: an admin cannot erase their own account (403).
 *
 * Evidence: data/compliance/dsar-wire-<ts>.json
 * Usage: BASE_URL=… node scripts/verify-dsar-intake.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pgMod from "../packages/database/node_modules/pg/lib/index.js";

const PgClient = pgMod.Client;
const root = fileURLToPath(new URL("..", import.meta.url));
const base = process.env.BASE_URL ?? "http://localhost:3000";
const ts = String(Date.now());
const subjectEmail = `dsar-subject-${ts}@zfloat.app`;
const steps = [];
let ok = true;

async function jfetch(path, init = {}, cookie = "") {
  const headers = { ...(init.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const res = await fetch(base + path, { ...init, headers, redirect: "manual" });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  return { res, body };
}
function step(name, cond, detail = {}) {
  steps.push({ name, ok: !!cond, ...detail });
  if (!cond) ok = false;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
}
async function withClient(fn) {
  const c = new PgClient({ host: "127.0.0.1", port: 5432, user: "zfloat", password: process.env.PGPASSWORD ?? "zfloat_dev_password", database: "zfloat" });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const results = { at: new Date().toISOString(), subjectEmail, ok: false, steps: [] };

try {
  // ── 1. Public self-service intake (no session) ─────────────────────────
  const r1 = await jfetch("/api/privacy/requests", {
    method: "POST",
    body: JSON.stringify({ name: "Wire Probe", email: subjectEmail, type: "EXPORT", note: "e2e wire verification" }),
  });
  step("public intake EXPORT → 201 REQUESTED (no session)", r1.res.status === 201 && r1.body?.data?.status === "REQUESTED", { status: r1.res.status });
  const exportReqId = r1.body?.data?.requestId;

  const r2 = await jfetch("/api/privacy/requests", {
    method: "POST",
    body: JSON.stringify({ email: subjectEmail, type: "DELETE" }),
  });
  step("public intake DELETE (erasure) → 201 REQUESTED (no session)", r2.res.status === 201 && r2.body?.data?.status === "REQUESTED", { status: r2.res.status });
  const erasureReqId = r2.body?.data?.requestId;

  const bad = await jfetch("/api/privacy/requests", { method: "POST", body: JSON.stringify({ email: subjectEmail, type: "PURGE" }) });
  step("intake rejects unknown type → 400", bad.res.status === 400 && bad.body?.error?.code === "INVALID_TYPE", { status: bad.res.status });
  const badEmail = await jfetch("/api/privacy/requests", { method: "POST", body: JSON.stringify({ email: "not-an-email", type: "EXPORT" }) });
  step("intake rejects malformed email → 400", badEmail.res.status === 400, { status: badEmail.res.status });
  step("intake returns request ids only (no data access)", !!exportReqId && !!erasureReqId);

  // ── 2. Guardrails: no session → admin-side refused ─────────────────────
  const g1 = await jfetch("/api/admin/dsar/requests");
  step("anon admin queue → 401", g1.res.status === 401, { status: g1.res.status });
  const g2 = await jfetch(`/api/admin/dsar/export?email=${encodeURIComponent(subjectEmail)}`);
  step("anon admin export → 401", g2.res.status === 401, { status: g2.res.status });
  const g3 = await jfetch("/api/admin/dsar/erasure", { method: "POST", body: JSON.stringify({ email: subjectEmail, confirm: "ERASE" }) });
  step("anon admin erasure → 401 (not executed)", g3.res.status === 401, { status: g3.res.status });

  // ── 3. Admin wire journey ──────────────────────────────────────────────
  const adminCookie = await (async () => {
    const l = await jfetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "admin@zfloat.app", password: process.env.ADMIN_PASSWORD ?? "Demo@12345" }) });
    return (l.res.headers.get("set-cookie") ?? "").match(/zf_session=[^;]+/)?.[0] ?? "";
  })();
  step("platform admin session", !!adminCookie);

  const me = await jfetch("/api/auth/me", {}, adminCookie);
  const adminUserId = me.body?.user?.id ?? null;
  step("admin identity known", !!adminUserId, { adminUserId });

  // Subject creation: workspace owner (demo tenant) invites; the sandbox
  // stores the raw token so the wire flow can complete without mail infra.
  const inviterCookie = await (async () => {
    const l = await jfetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "demo@zfloat.app", password: "Demo@12345" }) });
    return (l.res.headers.get("set-cookie") ?? "").match(/zf_session=[^;]+/)?.[0] ?? "";
  })();
  const inviteRoleId = await withClient(async (c) => {
    const { rows } = await c.query("select id from roles where name = 'ACCOUNTANT' limit 1");
    return rows[0]?.id;
  });
  const inv = await jfetch("/api/team", { method: "POST", body: JSON.stringify({ email: subjectEmail, roleId: inviteRoleId }) }, inviterCookie);
  step("owner invites subject (wire) → 201", inv.res.status === 201, { status: inv.res.status, roleId: inviteRoleId });

  let token = null;
  for (let attempt = 1; attempt <= 5 && !token; attempt++) {
    token = await withClient(async (c) => {
      const { rows } = await c.query("select raw_token from invitations where email = $1 order by created_at desc limit 1", [subjectEmail]);
      return rows[0]?.raw_token ?? null;
    });
    if (!token && attempt < 5) await new Promise((r) => setTimeout(r, 400));
  }
  step("sandbox invite token readable for the wire flow", !!token);

  const reg = await jfetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ fullName: "DSAR Wire Subject", email: subjectEmail, password: "Dsar@12345", inviteToken: token }),
  });
  step("subject registers (wire) → 201", reg.res.status === 201, { status: reg.res.status, code: reg.body?.error?.code ?? reg.body?.error?.message });

  const q = await jfetch("/api/admin/dsar/requests", {}, adminCookie);
  const qrows = ((q.body?.data?.requests ?? q.body?.data?.rows ?? []) || []).filter((x) => x.id === exportReqId || x.id === erasureReqId);
  step("admin queue lists both REQUESTED rows", q.res.status === 200 && qrows.length === 2 && qrows.every((x) => x.status === "REQUESTED"), { status: q.res.status, found: qrows.length });

  const up1 = await jfetch("/api/admin/dsar/requests", { method: "PATCH", body: JSON.stringify({ id: exportReqId, status: "IN_REVIEW" }) }, adminCookie);
  step("queue PATCH → IN_REVIEW", up1.res.status === 200 && up1.body?.data?.status === "IN_REVIEW", { status: up1.res.status });

  const exp = await jfetch(`/api/admin/dsar/export?email=${encodeURIComponent(subjectEmail)}`, {}, adminCookie);
  const bundle = exp.body?.data?.bundle ?? exp.body?.data;
  step("admin export returns the subject bundle (200)", exp.res.status === 200 && !!bundle, { status: exp.res.status, bundleKeys: bundle ? Object.keys(bundle).slice(0, 12) : null });

  const up2 = await jfetch("/api/admin/dsar/requests", { method: "PATCH", body: JSON.stringify({ id: exportReqId, status: "COMPLETED", note: "export delivered to requester" }) }, adminCookie);
  step("queue PATCH → COMPLETED (export fulfilled)", up2.res.status === 200 && up2.body?.data?.status === "COMPLETED", { status: up2.res.status });

  const eNoConfirm = await jfetch("/api/admin/dsar/erasure", { method: "POST", body: JSON.stringify({ email: subjectEmail }) }, adminCookie);
  step("erasure without confirm:ERASE → 422 (nothing executed)", eNoConfirm.res.status === 422, { status: eNoConfirm.res.status, code: eNoConfirm.body?.error?.code });
  const expStill = await jfetch(`/api/admin/dsar/export?email=${encodeURIComponent(subjectEmail)}`, {}, adminCookie);
  step("subject data still intact after refused erasure (200)", expStill.res.status === 200, { status: expStill.res.status });
  const selfErr = await jfetch("/api/admin/dsar/erasure", { method: "POST", body: JSON.stringify({ userId: adminUserId, confirm: "ERASE" }) }, adminCookie);
  step("admin cannot erase self → 403", selfErr.res.status === 403 && selfErr.body?.error?.code === "SELF_ERASURE_FORBIDDEN", { status: selfErr.res.status });
  const eRun = await jfetch("/api/admin/dsar/erasure", { method: "POST", body: JSON.stringify({ email: subjectEmail, confirm: "ERASE" }) }, adminCookie);
  const summary = eRun.body?.data?.summary ?? eRun.body?.data;
  step("erasure with confirm:ERASE → 200", eRun.res.status === 200, { status: eRun.res.status, summaryKeys: summary ? Object.keys(summary) : null });
  const expGone = await jfetch(`/api/admin/dsar/export?email=${encodeURIComponent(subjectEmail)}`, {}, adminCookie);
  step("re-export by original email → 404 (subject scrubbed)", expGone.res.status === 404, { status: expGone.res.status });

  const erasedRows = await withClient(async (c) => {
    const { rows } = await c.query("select email, status from users where email like 'erased-%@erased.invalid' order by updated_at desc limit 5");
    return rows;
  });
  step("identity row anonymized to erased-*.invalid", erasedRows.length > 0, { rows: erasedRows.slice(0, 3).map((u) => `${u.email} (${u.status})`) });

  const up3 = await jfetch("/api/admin/dsar/requests", { method: "PATCH", body: JSON.stringify({ id: erasureReqId, status: "COMPLETED", note: "erasure executed" }) }, adminCookie);
  step("queue PATCH → COMPLETED (erasure fulfilled)", up3.res.status === 200 && up3.body?.data?.status === "COMPLETED", { status: up3.res.status });
} catch (err) {
  ok = false;
  results.error = String(err?.stack ?? err?.message ?? err);
  console.error("ERROR:", err?.message ?? err);
} finally {
  results.ok = ok;
  results.steps = steps;
  const dir = join(root, "data", "compliance");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `dsar-wire-${ts}.json`);
  writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`\nverdict: ${ok ? "PASS" : "FAIL"} → evidence: ${file}`);
  process.exit(ok ? 0 : 6);
}
