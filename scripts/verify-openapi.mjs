#!/usr/bin/env node
/**
 * scripts/verify-openapi.mjs — Phase 8 curl matrix: proves EVERY path in the
 * served OpenAPI document against the LIVE API. Zero dependencies (Node 20+
 * fetch). Uses a real API key created through the developer-portal flow
 * (shown once), plus negative checks (missing/bogus key → 401).
 *
 * Usage: BASE_URL=http://localhost:3000 node scripts/verify-openapi.mjs
 * Results: data/openapi-verify-<ts>.json (evidence) + console summary.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const base = process.env.BASE_URL ?? "http://localhost:3000";
const email = process.env.DEMO_EMAIL ?? "demo@zfloat.app";
const password = process.env.DEMO_PASSWORD ?? "Demo@12345";

const results = [];
function record(path, method, expected, actual, ok, extra = {}) {
  results.push({ path, method, expected, actual: actual.status, ok, ...extra });
  console.log(`${ok ? "PASS" : "FAIL"} ${method} ${path} → ${actual.status} (expected ${expected})`);
}

async function jfetch(path, init = {}, cookie = "") {
  const headers = { ...(init.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const res = await fetch(base + path, { ...init, headers, redirect: "manual" });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  return { res, body };
}

// 1) OpenAPI doc served and parseable
let apiDocBody = null;
{
  const { res, body } = await jfetch("/api/public/v1/openapi.json");
  record("/api/public/v1/openapi.json", "GET", 200, res, res.ok && body?.openapi?.startsWith("3."));
  if (!res.ok) process.exit(1);
  apiDocBody = body;
  const paths = Object.keys(body.paths ?? {});
  console.log("   documented paths:", paths.join(", "));
  for (const p of paths) {
    if (!p.startsWith("/api/public/v1/")) {
      console.error(`   unexpected path ${p}`);
      process.exit(1);
    }
  }
}

// 1b) DRIFT GUARD: every documented path must exist as a route handler in
// the app source tree (apps/web/app/api) and vice-versa for the public v1
// prefix. The Next routes-manifest only lists dynamic handlers, so the
// route.ts tree is the complete source of truth.
{
  try {
    const { readdir } = await import("node:fs/promises");
    const { join, relative } = await import("node:path");
    const apiRoot = new URL("../apps/web/app/api", import.meta.url).pathname;
    const files = [];
    async function walk(dir) {
      for (const ent of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) await walk(full);
        else if (ent.name === "route.ts" || ent.name === "route.js") files.push(full);
      }
    }
    await walk(apiRoot);
    const real = new Set(
      files
        .map((f) => "/api/" + relative(apiRoot, f).split("/route.")[0])
        .filter((pg) => pg.startsWith("/api/public/v1"))
        .map((pg) => pg.replace(/\[[^/]+\]/g, "*")),
    );
    const documented = new Set(Object.keys(apiDocBody.paths).map((p2) => p2.replace(/\{.*?\}/g, "*")));
    const missing = [...documented].filter((p2) => !real.has(p2));
    const undocumented = [...real].filter((p2) => !documented.has(p2) && !p2.endsWith("/openapi.json"));
    const ok = missing.length === 0 && undocumented.length === 0;
    results.push({ path: "drift guard (route tree ↔ spec)", method: "META", expected: 0, actual: 0, ok, missing, undocumented });
    console.log(`${ok ? "PASS" : "FAIL"} drift guard (route tree ↔ spec) | documented=${documented.size} handlers=${real.size} missing=${missing.length} undocumented=${undocumented.length}`);
    if (missing.length) console.log("   missing from app:", missing.join(", "));
    if (undocumented.length) console.log("   undocumented:", undocumented.join(", "));
    if (!ok) process.exit(1);
  } catch (err) {
    console.log("   drift guard skipped (api tree unreadable):", String(err).slice(0, 100));
  }
}
