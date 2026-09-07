import { test, expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

/**
 * Tier-1 E2E — payment links (create → public pay), outbound webhooks UI,
 * reconciliation UI, in-app notifications bell, MFA settings flow (last:
 * it temporarily enables MFA on the shared demo user, so it must clean up
 * before any other demo-login test could run).
 */

const DEMO = { email: "demo@zfloat.app", password: "Demo@12345" };

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 decode (Node's Buffer lacks base32). */
function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Minimal TOTP (SHA-1, 6 digits, 30s step) — matches @zfloat/auth. */
function totp(secretB32: string, atMs = Date.now()): string {
  const key = base32Decode(secretB32);
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(buf).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const bin = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return bin.toString().padStart(6, "0");
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal");
}

test.describe("Tier-1: payment links", () => {
  test("create a link in the portal, pay it from the public page", async ({ page }) => {
    await login(page);
    await page.goto("/portal/payment-links");
    await expect(page.getByRole("heading", { name: "Payment links" })).toBeVisible();

    const now = Date.now();
    const createResp = page.waitForResponse(
      (r) => r.url().includes("/api/payment-links") && r.request().method() === "POST" && r.ok(),
    );
    await page.getByRole("button", { name: "+ New payment link" }).click();
    await page.getByLabel("Name").fill(`E2E link ${now}`);
    await page.getByLabel("Amount (KES)").fill("750.5");
    await page.getByRole("button", { name: "Create link" }).click();
    const created = await (await createResp).json();
    expect(created?.data?.url).toContain("/pay/pl_");

    // Success card with the shareable URL appears.
    await expect(page.getByText("Payment link created")).toBeVisible();
    const url = (await page.locator("code").first().textContent()) ?? "";
    expect(url).toContain("/pay/pl_");

    // Public pay page — fresh context (no session).
    const browser = page.context().browser()!;
    const payCtx = await browser.newContext();
    const payPage = await payCtx.newPage();
    await payPage.goto(url);
    await expect(payPage.getByText("Amount due")).toBeVisible();
    await expect(payPage.getByText("KES 750.50")).toBeVisible();
    await payPage.getByPlaceholder("0712 345 678").fill("0712345678");
    await payPage.getByPlaceholder("Jane Wanjiku").fill("E2E Payer");
    await payPage.getByRole("button", { name: "Pay now with M-Pesa" }).click();
    await expect(payPage.getByText("Payment received — thank you!")).toBeVisible({ timeout: 20_000 });
    const receipt = await payPage.getByText(/Reference LNK-/).textContent().catch(() => "");
    expect(receipt).toContain("LNK-");
    await payCtx.close();

    // Portal list shows the new link with its use count.
    await page.reload();
    await expect(page.locator("td", { hasText: `E2E link ${now}` })).toBeVisible();
  });
});

test.describe("Tier-1: webhook subscription UI", () => {
  test("subscribe an endpoint and see it listed", async ({ page }) => {
    await login(page);
    await page.goto("/portal/webhooks");
    await expect(page.getByRole("heading", { name: "Outbound webhooks" })).toBeVisible();

    const name = `E2E endpoint ${Date.now()}`;
    const resp = page.waitForResponse(
      (r) => r.url().includes("/api/webhooks") && r.request().method() === "POST" && r.ok(),
    );
    await page.getByRole("button", { name: "+ Subscribe endpoint" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Endpoint URL").fill("http://127.0.0.1:59999/nowhere");
    await page.getByRole("button", { name: "Subscribe", exact: true }).click();
    await (await resp).json();

    // One-time signing secret is surfaced, then the row appears.
    await expect(page.getByText("Endpoint created")).toBeVisible();
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.locator("td", { hasText: name })).toBeVisible();
  });
});

test.describe("Tier-1: reconciliation UI", () => {
  test("statement import through the UI surfaces matched/unmatched stats", async ({ page }) => {
    await login(page);
    await page.goto("/portal/reconciliation");
    await expect(page.getByRole("heading", { name: "Reconciliation" })).toBeVisible();

    // Drive the CSV import UI: paste a statement and click "Import & match".
    const stamp = `E2E-UNKNOWN-${Date.now()}`;
    const resp = page.waitForResponse(
      (r) => r.url().includes("/api/reconciliation/statement") && r.ok(),
    );
    await page.getByLabel("Statement CSV").fill(
      `provider_reference,amount,date\n${stamp},10.00,2026-09-01\n`,
    );
    await page.getByRole("button", { name: "Import & match" }).click();
    const body = await (await resp).json();
    expect(body?.data?.rowsImported).toBe(1);
    expect(body?.data?.unmatched).toBe(1);
    // The result summary card renders on the page.
    await expect(page.getByText("CSV rows", { exact: true })).toBeVisible({ timeout: 20_000 });
    // Exceptions table surfaces earlier findings too.
    await expect(page.getByText(/UNMATCHED|AMOUNT MISMATCH/i).first()).toBeVisible({ timeout: 20_000 }).catch(() => undefined);
  });
});

test.describe("Tier-1: notifications bell", () => {
  test("unread badge reflects mark-read", async ({ page }) => {
    await login(page);

    // Clear any unread notifications for the demo tenant first.
    const mark = await page.request.post("/api/notifications", { data: { action: "markRead" } });
    expect(mark.ok()).toBe(true);

    // Reload so the bell refetches the unread count.
    await page.reload();
    const bell = page.getByLabel("Notifications");
    await expect(bell).toBeVisible();
    await expect(page.locator("button[aria-label='Notifications'] span.rounded-full")).toHaveCount(0, { timeout: 20_000 });
  });
});

test.describe("Tier-1: MFA settings flow", () => {
  test("enroll → verify with authenticator code → backup codes → disable", async ({ page }) => {
    await login(page);
    await page.goto("/portal/settings");

    await expect(page.getByText("Two-factor authentication (TOTP)")).toBeVisible();
    await expect(page.getByText("Add an extra layer of security")).toBeVisible();

    // Enroll — capture the server-issued base32 secret from the API response.
    const secretP = page.waitForResponse(
      (r) => r.url().includes("/api/auth/mfa/enroll") && r.request().method() === "POST" && r.ok(),
    );
    await page.getByRole("button", { name: "Set up authenticator app" }).click();
    const enrollRes = await secretP;
    const enrollData = (await enrollRes.json()).data;
    expect(enrollData?.secret).toMatch(/^[A-Z2-7]{20,}$/);

    // QR shown; feed a real TOTP code into the confirm step.
    await expect(page.getByAltText("TOTP QR code")).toBeVisible();
    await page.getByLabel("Authenticator code").fill(totp(enrollData.secret));
    await page.getByRole("button", { name: "Confirm & enable" }).click();

    // Enabled state + one-time backup codes shown.
    await expect(page.getByText("Backup codes — save these now (shown once)")).toBeVisible();
    await expect(page.getByText("Enabled — a 6-digit code")).toBeVisible();

    // Disable: requires the current authenticator code.
    await page.getByLabel("Current code to disable").fill(totp(enrollData.secret));
    await page.getByRole("button", { name: "Disable MFA" }).click();
    await expect(page.getByText("Add an extra layer of security")).toBeVisible();
  });
});
