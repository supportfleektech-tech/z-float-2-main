/**
 * Batch A E2E (production build):
 *  - team invites: POST no longer returns the raw token; demo surfaces the
 *    shareable invite link through the invite-notice bridge
 *  - payment links: Share modal with QR endpoint (200 image/png) + share targets
 *  - report schedules: create (demo nextRunAt accepted), listed, cancellable
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

test.describe("batch A product quick-wins", () => {
  test("team invite is delivered out-of-band; demo link comes from the notice bridge", async ({ page }) => {
    await signIn(page);
    await page.goto("/portal/team");
    await expect(page.getByRole("heading", { name: "Team & roles" })).toBeVisible();

    const email = `batch-a-${Date.now().toString(36)}@example.com`;
    await page.getByRole("button", { name: "+ Invite member" }).click();
    await page.getByLabel("Email").fill(email);
    const roleOptions = page.locator("#inv-role option");
    const n = await roleOptions.count();
    await page.locator("#inv-role").selectOption({ index: 1 });
    expect(n).toBeGreaterThan(1);
    await page.getByRole("button", { name: "Send invite" }).click();

    await expect(page.getByText(`✓ Invitation sent to ${email}`)).toBeVisible({ timeout: 15_000 });
    // The POST response deliberately carries no raw link — demo shows the
    // shareable URL only after reading it back from the bridge.
    const link = page.locator("p.break-all").last();
    await expect(link).toContainText("/register?invite=inv-", { timeout: 15_000 });
  });

  test("payment-link Share modal exposes QR (image/png) and share targets", async ({ page, context, baseURL }) => {
    await signIn(page);
    await page.goto("/portal/payment-links");

    // Ensure at least one link exists.
    const hasRows = await page.getByRole("button", { name: "Share" }).count();
    if (hasRows === 0) {
      await page.getByRole("button", { name: "+ New payment link" }).click();
      await page.getByLabel("Name").fill("Batch A link");
      await page.getByLabel("Amount (KES)").fill("250");
      await page.getByRole("button", { name: "Create link" }).click();
      await expect(page.getByText("Payment link created")).toBeVisible();
      await page.getByRole("button", { name: "Done" }).click();
    }

    await page.getByRole("button", { name: "Share" }).first().click();
    await expect(page.getByText("Scan to pay")).toBeVisible();
    const qrImg = page.locator("img[alt='QR code for payment link']");
    await expect(qrImg).toBeVisible();

    const cookies = await context.cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const linkRow = page.locator("tr", { has: page.getByRole("button", { name: "Share" }) }).first();
    const linkId = await linkRow.getAttribute("data-link-id");
    const qrRes = await fetch(`${baseURL}/api/payment-links/${linkId}/qr`, { headers: { cookie: cookieHeader } });
    expect(qrRes.status).toBe(200);
    expect(qrRes.headers.get("content-type")).toContain("image/png");

    // Share targets render.
    await expect(page.locator("a[href*='wa.me']")).toBeVisible();
    await expect(page.locator("a[href*='mailto:']")).toBeVisible();
  });

  test("report schedule: create (demo nextRunAt), list, cancel", async ({ page, baseURL }) => {
    await signIn(page);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const headers = { "content-type": "application/json", cookie: cookieHeader };

    const created = await fetch(`${baseURL}/api/report-schedules`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reportType: "transactions", frequency: "weekly", retentionDays: 30, nextRunAt: new Date().toISOString() }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { data: { id: string; frequency: string; retentionDays: number } };
    expect(body.data.frequency).toBe("weekly");
    expect(body.data.retentionDays).toBe(30);

    const listed = await fetch(`${baseURL}/api/report-schedules`, { headers });
    expect(listed.status).toBe(200);
    const list = (await listed.json()) as { data: Array<{ id: string; frequency: string }> };
    expect(list.data.some((s) => s.id === body.data.id)).toBe(true);

    const cancelled = await fetch(`${baseURL}/api/report-schedules/${body.data.id}`, { method: "DELETE", headers });
    expect(cancelled.status).toBe(200);
    const after = (await (await fetch(`${baseURL}/api/report-schedules`, { headers })).json()) as {
      data: Array<{ id: string; active: boolean }>;
    };
    const row = after.data.find((s) => s.id === body.data.id);
    expect(row?.active).toBe(false);

    // UI renders the panel.
    await page.goto("/portal/reports");
    await expect(page.getByText("Scheduled exports", { exact: true })).toBeVisible();
  });
});
