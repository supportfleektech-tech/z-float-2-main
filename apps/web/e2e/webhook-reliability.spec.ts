/**
 * Phase 2 (GAP-ANALYSIS) — webhook reliability E2E on the production build:
 *  - DLQ: a delivery that the endpoint rejects lands FAILED on the delivery
 *    log with the last error visible.
 *  - Inspect: the full delivery record (payload bytes, signature, error) is
 *    one click away.
 *  - Rotate secret: bumps the shown version (v1 → v2) and returns the new
 *    secret once.
 *  - Replay: re-enqueues the FAILED delivery; once the endpoint heals it is
 *    DELIVERED — and re-signed with the CURRENT (rotated) secret only.
 *
 * The tenant endpoint is a per-test HTTP server inside this process; the
 * worker (separate process) POSTs to it over 127.0.0.1.
 */
import { test, expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const DEMO = { email: "demo@zfloat.app", password: "Demo@12345" };

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/portal**");
}

/** The tenant's receiving endpoint: 400 for the first N hits, then 200. */
function startCatchEndpoint(rejectFirst: number) {
  const hits: Array<{ path: string; body: string; signature: string | null; delivery: string | null }> = [];
  let count = 0;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      count += 1;
      const body = Buffer.concat(chunks).toString("utf8");
      const sig = (req.headers["x-zfloat-signature"] as string) ?? null;
      const delivery = (req.headers["x-zfloat-delivery"] as string) ?? null;
      hits.push({ path: req.url ?? "", body, signature: sig, delivery });
      if (count <= rejectFirst) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "rejecting" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise<{ url: string; hits: typeof hits; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}/hook`,
        hits,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

const hmac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");
const acceptDialog = (page: Page) => page.once("dialog", (d) => void d.accept());

test.describe("webhook reliability ops (DLQ / replay / secret rotation)", () => {
  test("rejected delivery lands on the DLQ; rotation → replay delivers signed with the new secret", async ({ page }) => {
    test.setTimeout(120_000);
    const catchServer = await startCatchEndpoint(1);

    try {
      await signIn(page);
      await page.goto("/portal/webhooks");
      await expect(page.getByRole("heading", { name: "Outbound webhooks" })).toBeVisible();

      // --- subscribe an endpoint that rejects the first delivery ---
      const name = `Reliability ${Date.now().toString(36)}`;
      await page.getByRole("button", { name: "+ Subscribe endpoint", exact: true }).click();
      await page.getByLabel("Name").fill(name);
      await page.getByLabel("Endpoint URL").fill(catchServer.url);
      await page.getByRole("button", { name: "Subscribe", exact: true }).click();
      await expect(page.getByText("Endpoint created")).toBeVisible();
      const secretV1 = (await page.locator("div.font-mono", { hasText: /^[0-9a-f]{48}$/ }).first().textContent())!.trim();
      await page.getByRole("button", { name: "Got it", exact: true }).click();

      // Endpoint row = the row with the Send-test action; assert secret v1.
      const epRow = () => page.locator("tr").filter({ has: page.getByRole("button", { name: "Send test" }) }).filter({ hasText: name }).first();
      await expect(epRow()).toBeVisible();
      await expect(epRow().getByText("v1", { exact: true })).toBeVisible();

      // --- send a test ping → the endpoint rejects it (400) → FAILED on the DLQ ---
      await epRow().getByRole("button", { name: "Send test", exact: true }).click();
      const pingRow = () => page.locator("tr").filter({ hasText: "ping" }).filter({ has: page.getByRole("button", { name: "Replay" }) }).first();
      await expect(pingRow()).toBeVisible({ timeout: 20_000 });
      await expect(pingRow().getByText(/HTTP 400|permanent/i)).toBeVisible({ timeout: 10_000 });
      expect(catchServer.hits).toHaveLength(1);
      expect(catchServer.hits[0]!.signature).toBe(hmac(secretV1, catchServer.hits[0]!.body)); // signed with v1 at that time

      // --- DLQ filter isolates failed deliveries ---
      await page.getByRole("button", { name: /Failed \/ DLQ/ }).click();
      await expect(pingRow()).toBeVisible();

      // --- Inspect: payload + error + attempts are available ---
      await pingRow().getByRole("button", { name: "Inspect", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Delivery record" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(/Endpoint rejected the delivery with HTTP 400/)).toBeVisible();
      await expect(dialog.getByText('"ping"').first()).toBeVisible();
      await page.getByRole("button", { name: "Close" }).click();

      // --- rotate the secret: v2 shown once; v1 no longer signs ---
      acceptDialog(page);
      await epRow().getByRole("button", { name: "Rotate secret", exact: true }).click();
      await expect(page.getByText(/Secret rotated — v2 \(shown once\)/)).toBeVisible({ timeout: 10_000 });
      const secretV2 = (await page.locator("div.font-mono", { hasText: /^[0-9a-f]{48}$/ }).first().textContent())!.trim();
      expect(secretV2).not.toBe(secretV1);
      await page.getByRole("button", { name: "Got it", exact: true }).click();
      await expect(epRow().getByText("v2", { exact: true })).toBeVisible();

      // --- replay the FAILED ping: endpoint accepts now → DELIVERED, signed with v2 ---
      acceptDialog(page);
      await pingRow().getByRole("button", { name: "Replay", exact: true }).click();
      await expect(page.getByText(/Replay queued/i)).toBeVisible({ timeout: 10_000 });
      // The replayed row leaves the DLQ filter once it succeeds.
      await page.getByRole("button", { name: /^All/ }).click();
      await expect(page.locator("tr").filter({ hasText: "ping" }).getByText("DELIVERED", { exact: true })).toBeVisible({ timeout: 25_000 });
      expect(catchServer.hits).toHaveLength(2);
      const replayHit = catchServer.hits[1]!;
      expect(replayHit.signature).toBe(hmac(secretV2, replayHit.body)); // re-signed with the new secret
      expect(replayHit.signature).not.toBe(hmac(secretV1, replayHit.body)); // old secret no longer verifies
    } finally {
      await catchServer.close();
    }
  });
});
