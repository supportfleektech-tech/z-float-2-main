/**
 * Observability E2E (production build):
 *  - the admin System health page renders dependency checks (worker + ledger
 *    included), live metrics and evaluated alert rules
 *  - with the worker running, all checks are OK, alerts are OK, and the
 *    overall status is HEALTHY
 */
import { test, expect, type Page } from "@playwright/test";

const ADMIN = { email: "admin@zfloat.app", password: "Demo@12345" };

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/admin**");
}

test.describe("platform admin · system observability", () => {
  test("health page shows checks, metrics and alert rules — all healthy with the worker up", async ({ page, context, baseURL }) => {
    await signIn(page);
    await page.goto("/admin/health");
    await expect(page.getByRole("heading", { name: "System health" })).toBeVisible();

    // Dependency checks — every subsystem OK (card contains the lowercase
    // check name and an OK badge).
    for (const name of ["postgres", "redis", "worker", "outbox", "ledger"]) {
      const card = page.locator("div").filter({ has: page.getByText(name, { exact: true }) }).filter({ has: page.getByText("OK", { exact: true }) });
      await expect(card.first()).toBeVisible({ timeout: 15_000 });
    }

    // The API payload carries the full observability surface (forward the
    // admin session cookie — plain fetch has none).
    const cookies = await context.cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await fetch(`${baseURL}/api/admin/health`, { headers: { cookie: cookieHeader } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        healthy: boolean;
        metrics: {
          queueBacklogs: Array<{ queue: string; waiting: number }>;
          payments24h: { succeeded: number; failed: number };
          workerHeartbeatAgeMs: number | null;
          activeApiKeys: number;
        };
        alerts: { rules: Array<{ rule: string; severity: string }>; worst: string; criticalCount: number; warnCount: number };
      };
    };
    const d = body.data;
    expect(d.healthy).toBe(true);
    expect(d.metrics.queueBacklogs.length).toBeGreaterThanOrEqual(3);
    expect(d.metrics.payments24h.succeeded + d.metrics.payments24h.failed).toBeGreaterThanOrEqual(0);
    expect(d.metrics.workerHeartbeatAgeMs).not.toBeNull();
    expect(d.alerts.worst).toBe("ok");
    expect(d.alerts.criticalCount).toBe(0);
    const ruleIds = d.alerts.rules.map((r) => r.rule);
    expect(ruleIds).toContain("worker_stale");
    expect(ruleIds).toContain("payment_failure_rate");
    expect(ruleIds).toContain("queue_backlog");
    expect(ruleIds).toContain("ledger_imbalance");

    // UI renders metrics + rules.
    await expect(page.getByText("Payments 24h")).toBeVisible();
    await expect(page.getByText("Queue backlog (critical queues)")).toBeVisible();
    await expect(page.getByText("Alert rules", { exact: true })).toBeVisible();
    await expect(page.getByText("Queue worker heartbeat").first()).toBeVisible();
    await expect(page.getByText("Heartbeat fresh", { exact: true })).toBeVisible();
    await expect(page.getByText("HEALTHY", { exact: true })).toBeVisible();
    await expect(page.getByText("CRITICAL", { exact: true })).toHaveCount(0);
  });
});
