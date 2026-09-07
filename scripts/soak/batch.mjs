#!/usr/bin/env node
/**
 * scripts/soak/batch.mjs — GAP closeout: load profile for CHUNKED BATCH
 * payouts (the path Phase 9 originally listed but never exercised).
 *
 * Creates R rows in a batch (default 250 → two 200-row chunks through the
 * worker), waits for the batch + queue drain, asserts every row reached
 * SUCCESS. Evidence: data/soak/batch-<ts>.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const base = process.env.BASE_URL ?? "http://localhost:3000";
const rows = Math.min(Number(process.argv[2] ?? 250) || 250, 2000);
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
const m = (login.res.headers.get("set-cookie") ?? "").match(/zf_session=([^;]+)/);
if (!m) throw new Error(`login failed: ${login.res.status}`);
const cookie = `zf_session=${m[1]}`;

const t0 = Date.now();
const batch = await jfetch("/api/batches", {
  method: "POST",
  body: JSON.stringify({
    name: `soak-batch-${Date.now()}`,
    channel: "mpesa",
    product: "bulk_payment",
    rows: Array.from({ length: rows }, (_, i) => ({
      rowNumber: i + 1,
      recipientName: `Batch Payee ${i}`,
      // unique phone per row — the batch engine rejects same phone|amount as
      // a duplicate instruction (anti double-submit), so a load profile must
      // not trip that product guard
      phone: `0712${String(100000 + i).slice(-6)}`,
      amount: "1.00",
      reference: `soak-batch-ref-${i}`,
    })),
  }),
}, cookie);
const batchId = batch.body?.data?.batchId;
const status = batch.body?.data?.status;
const createMs = Date.now() - t0;
if (!batchId) { console.error("batch create failed", JSON.stringify(batch.body).slice(0, 300)); process.exit(2); }

const deadline = Date.now() + 240_000;
let detail = null;
while (Date.now() < deadline) {
  const d = await jfetch(`/api/batches/${batchId}`, {}, cookie);
  detail = d.body?.data;
  if (detail && (detail.status === "COMPLETED" || detail.status === "FAILED" || detail.status === "SUCCESS")) break;
  await new Promise((r) => setTimeout(r, 1500));
}

const rowsArr = detail?.rows ?? [];
const byStatus = {};
for (const r of rowsArr) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
const allOk = rowsArr.length === rows && (byStatus.SUCCESS ?? 0) === rows;

const out = {
  at: new Date().toISOString(),
  platform: "sandbox demo stack (single node, mock provider) — observation, not a benchmark",
  requestedRows: rows,
  batchId,
  initialStatus: status,
  createMs,
  finalBatchStatus: detail?.status,
  rowsByStatus: byStatus,
  chunkBoundaryObserved: rows > 200 ? "rows > 200 ⇒ worker chunking engaged (200/chunk)" : "n/a (≤200 rows, single chunk)",
  drainMs: Date.now() - t0,
  ok: allOk,
};
mkdirSync(join(root, "data/soak"), { recursive: true });
const file = join(root, "data/soak", `batch-${Date.now()}.json`);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`batch: rows=${rows} initial=${status} final=${detail?.status} ${JSON.stringify(byStatus)} ok=${allOk} (${createMs}ms create, ${out.drainMs}ms total)`);
console.log(`evidence: ${file}`);
process.exit(allOk ? 0 : 3);
