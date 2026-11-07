import { test, expect } from "@playwright/test";
import { injectAxe, checkA11y } from "@axe-core/playwright";

const DEMO = { email: "demo@zfloat.app", password: "Demo@12345" };

async function login(page: any) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal");
}

test.describe("Accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await injectAxe(page);
  });

  test("portal dashboard should have no accessibility violations", async ({ page }) => {
    await page.goto("/portal");
    await checkA11y(page, undefined, {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  });

  test("payments page should have no accessibility violations", async ({ page }) => {
    await page.goto("/portal/payments");
    await checkA11y(page, undefined, {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  });

  test("budgets page should have no accessibility violations", async ({ page }) => {
    await page.goto("/portal/budgets");
    await checkA11y(page, undefined, {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  });

  test("team page should have no accessibility violations", async ({ page }) => {
    await page.goto("/portal/team");
    await checkA11y(page, undefined, {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  });

  test("beneficiaries page should have no accessibility violations", async ({ page }) => {
    await page.goto("/portal/beneficiaries");
    await checkA11y(page, undefined, {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  });

  test("reports page should have no accessibility violations", async ({ page }) => {
    await page.goto("/portal/reports");
    await checkA11y(page, undefined, {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  });

  test("settings page should have no accessibility violations", async ({ page }) => {
    await page.goto("/portal/settings");
    await checkA11y(page, undefined, {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  });

  test("approvals page should have no accessibility violations", async ({ page }) => {
    await page.goto("/portal/approvals");
    await checkA11y(page, undefined, {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  });
});