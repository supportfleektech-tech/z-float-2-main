/**
 * Phase 4 (GAP-ANALYSIS) — alert delivery E2E on the production build:
 *  - /admin/health renders rule evaluations and an Alert delivery panel.
 *  - "Send test alert" dispatches an ops notification through the real
 *    pipeline (queue → worker → EMAIL driver); the panel row flips QUEUED→SENT
 *    once the worker delivers (worker process runs alongside the suite).
 *
 * Flake root cause (fixed): the panel refreshes on a 30s interval while the
 * old spec gave the QUEUED→SENT flip a fixed 30s UI-wait — the two phases
 * raced, so the badge occasionally appeared just after the assertion window
 * (retry always green because the row was SENT by then). It also matched the
 * ambiguous shared text "TEST alert" across leftover rows of earlier runs.
 * Now the spec polls the server-side alert list (same admin session) for the
 * dispatch it just created, then reloads the panel and asserts the visible
 * badge — deterministic regardless of refresh phase or accumulated rows.
 */
import { test, expect, type Page } from "@playwright/test";

const ADMIN = { email: "admin@zfloat.app", password: "Demo@12345" };

async function signInAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/admin/);
}

test.describe("Phase 4 — alert delivery", () => {
  test("health page shows rules; a test alert travels the pipeline to SENT", async ({ page }) => {
    await signInAdmin(page);
    await page.goto("/admin/health");
    await expect(page.getByRole("heading", { name: "System health" })).toBeVisible();
    await expect(page.getByText("Alert rules", { exact: true })).toBeVisible();

    // Rule evaluations render (worker heartbeat rule is deterministic enough).
    await expect(page.getByText("Queue worker heartbeat", { exact: false }).first()).toBeVisible({ timeout: 20_000 });

    // Dispatch a labeled test alert through the real notification pipeline.
    const dispatchT0 = Date.now();
    const created = page.waitForResponse(
      (r) => r.url().includes("/api/admin/health/alerts/test") && r.request().method() === "POST" && r.ok(),
    );
    await page.getByRole("button", { name: "Send test alert" }).click();
    const body = await (await created).json();
    expect(body?.data?.queued).toBe(1);

    // Poll the server-side ops-alert list (newest first) for OUR dispatch to
    // reach SENT — no dependence on the panel's 30s refresh cadence.
    const oursDelivered = async (): Promise<boolean> => {
      const res = await page.request.get("/api/admin/health/alerts");
      if (!res.ok()) return false;
      const rows: Array<{ title: string; status: string; createdAt: string }> =
        (await res.json())?.data?.rows ?? [];
      return rows.some(
        (r) => r.title.includes("TEST alert") && new Date(r.createdAt).getTime() >= dispatchT0 && r.status === "SENT",
      );
    };
    await expect.poll(oursDelivered, { timeout: 60_000, intervals: [1_000, 2_000, 5_000] }).toBe(true);

    // The panel reflects it: reload once and assert the visible SENT badge on
    // the newest ops-alert row.
    await page.reload();
    const row = page.getByTestId("ops-alert-row").first();
    await expect(row).toContainText("TEST alert");
    await expect(row.getByText("SENT")).toBeVisible({ timeout: 10_000 });
  });
});
