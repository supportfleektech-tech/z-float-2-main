/**
 * Playwright global setup — warms the Next.js dev server so the first hit of
 * every page/route in the suite is already compiled (eliminates cold-compile
 * flakes: route modules compile on first request in dev mode).
 */
import type { FullConfig } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function hit(path: string, cookie?: string): Promise<number> {
  try {
    const res = await fetch(BASE + path, {
      redirect: "manual",
      headers: cookie ? { cookie } : undefined,
    });
    return res.status;
  } catch {
    return -1;
  }
}

async function login(email: string, password: string): Promise<string | null> {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) return null;
  const setCookie = res.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0] || null;
}

/**
 * Best-effort state reset so alert metrics and KYC flows are deterministic
 * across runs:
 *  - the webhook-delivery log drives the "webhook failures (24h)" alert rule,
 *    and repeated E2E runs against dead demo endpoints would otherwise push
 *    it over the warn threshold;
 *  - KYC documents/screenings/cases are single-use per tenant fixture — the
 *    compliance spec (see its header) documents truncating these tables
 *    before every suite run, so do it here instead of by hand.
 */
async function resetDemoState(): Promise<void> {
  try {
    const { createDb } = await import("@zfloat/database");
    const { pool } = createDb();
    await pool.query("TRUNCATE webhook_deliveries");
    await pool.query("TRUNCATE kyc_cases, kyc_screenings, kyc_documents, kyc_profiles CASCADE");
    await pool.end();
  } catch {
    // non-fatal: the API tier guards metrics reads
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  await resetDemoState();
  // eslint-disable-next-line no-console
  console.log("[e2e] warming routes…");

  // Anonymous marketing/auth routes
  for (const p of ["/", "/pricing", "/security", "/login", "/register"]) {
    await hit(p);
  }

  // Demo (portal) session — login then warm every portal page + API used by tests
  const demoCookie = await login("demo@zfloat.app", "Demo@12345");
  if (demoCookie) {
    for (const p of [
      "/portal",
      "/portal/payments/new",
      "/portal/approvals",
      "/api/wallets",
      "/api/payments?limit=5",
      "/api/approvals?status=PENDING",
      "/api/portal/dashboard",
      "/api/fees/preview?channel=mpesa&amount=1500&product=single_payment",
      "/api/batches",
    ]) {
      await hit(p, demoCookie);
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn("[e2e] demo login failed during warmup — tests will retry login themselves");
  }

  // Admin session
  const adminCookie = await login("admin@zfloat.app", "Demo@12345");
  if (adminCookie) {
    for (const p of [
      "/admin",
      "/admin/pricing",
      "/api/admin/session",
      "/api/admin/overview",
      "/api/admin/pricing",
      "/api/admin/tenants",
      "/api/admin/health",
    ]) {
      await hit(p, adminCookie);
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn("[e2e] admin login failed during warmup — tests will retry login themselves");
  }

  // eslint-disable-next-line no-console
  console.log("[e2e] warmup complete");
}
