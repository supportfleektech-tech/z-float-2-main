/**
 * Developer portal E2E:
 *  1. Owner creates an API key in /portal/developers; the secret is shown once.
 *  2. The key works against the public API v1 (wallets + create payment),
 *     replays are idempotent, and revocation kills the key immediately.
 */
import { test, expect, type Page } from "@playwright/test";

const DEMO = { email: "demo@zfloat.app", password: "Demo@12345" };

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal**");
}

test.describe("developer API portal", () => {
  test("create key → public API works → revoke kills it", async ({ page, baseURL }) => {
    // Unique per-run names make the test independent of leftover state from
    // previous runs (keys/payments persist in the demo database).
    const runId = Date.now().toString(36);
    const keyName = `e2e-billing-${runId}`;
    const idempotencyKey = `e2e-key-${runId}`;

    await signIn(page);
    await page.goto("/portal/developers");
    await expect(page.getByRole("heading", { name: "Developer API" })).toBeVisible();

    await page.getByPlaceholder("e.g. production-server").fill(keyName);
    await page.getByRole("button", { name: "Create key" }).click();
    await expect(page.getByText("API key created — copy it now")).toBeVisible();

    // Read the raw secret from the one-time modal (trimmed: textContent can
    // carry surrounding whitespace from the <div>).
    const secret = (await page.locator(".break-all").textContent())?.trim();
    expect(secret).toMatch(/^zf_live_[A-Za-z0-9]+_[A-Za-z0-9_-]+$/);
    await page.getByRole("button", { name: "I saved it" }).click();
    await expect(page.getByText(keyName, { exact: false }).first()).toBeVisible();

    // The public API accepts the key.
    const wallets = await fetch(`${baseURL}/api/public/v1/wallets`, { headers: { "x-api-key": secret! } });
    expect(wallets.status).toBe(200);
    const walletBody = (await wallets.json()) as { data: Array<{ availableDisplay: string }> };
    expect(walletBody.data.length).toBeGreaterThan(0);

    // Create a payment through the public API and replay idempotently.
    const create = async () =>
      fetch(`${baseURL}/api/public/v1/payments`, {
        method: "POST",
        headers: { "x-api-key": secret!, "content-type": "application/json" },
        body: JSON.stringify({
          amount: "500.00",
          channel: "mpesa",
          recipient: { name: `E2E API Payee ${runId}`, phone: "0712000007" },
          idempotencyKey,
        }),
      });
    const first = (await (await create()).json()) as { data: { paymentId: string; replayed: boolean } };
    expect(first.data.replayed).toBe(false);
    const replay = (await (await create()).json()) as { data: { paymentId: string; replayed: boolean } };
    expect(replay.data.replayed).toBe(true);
    expect(replay.data.paymentId).toBe(first.data.paymentId);

    // Revoke through the portal: wait for the revoke call to commit before
    // asserting, then confirm the public API refuses the key (polled — the
    // 401 must hold immediately after the UI confirms revocation).
    page.once("dialog", (d) => d.accept());
    const row = page.locator("tr", { hasText: keyName });
    const revoked = page.waitForResponse(
      (r) => r.url().includes("/revoke") && r.request().method() === "POST" && r.ok(),
    );
    await row.getByRole("button", { name: "Revoke" }).click();
    await revoked;
    await expect(page.getByText("revoked", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        async () => {
          const after = await fetch(`${baseURL}/api/public/v1/wallets`, { headers: { "x-api-key": secret! } });
          return after.status;
        },
        { timeout: 15_000, intervals: [1_000] },
      )
      .toBe(401);
  });
});
