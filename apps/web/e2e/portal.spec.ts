import { test, expect } from "@playwright/test";

test.describe("marketing site", () => {
  test("home page loads with brand and hero", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Z-float", { exact: false }).first()).toBeVisible();
  });

  test("pricing page renders DB-driven plans", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("Simple, honest pricing")).toBeVisible();
    await expect(page.getByText("Starter", { exact: true })).toBeVisible();
    await expect(page.getByText("Growth", { exact: true })).toBeVisible();
  });

  test("security page lists pillars", async ({ page }) => {
    await page.goto("/security");
    await expect(page.getByText("Defense in depth")).toBeVisible();
  });
});

test.describe("demo portal", () => {
  test("demo login → dashboard with live data", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("demo@zfloat.app");
    await page.getByLabel("Password").fill("Demo@12345");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/portal");
    await expect(page.getByText("Recent payments")).toBeVisible();
    await expect(page.getByText("Available balance")).toBeVisible();
  });

  test("create a payment end-to-end", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("demo@zfloat.app");
    await page.getByLabel("Password").fill("Demo@12345");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/portal");

    await page.goto("/portal/payments/new");
    await page.getByLabel("Amount (KES)").fill("1500");
    await page.getByLabel("Recipient name").fill("E2E Test Recipient");
    await page.getByLabel("Phone (Kenyan mobile)").fill("0712000001");
    await page.getByRole("button", { name: "Submit payment" }).click();
    // Success screen shows "Payment queued" / "Payment success" / "Payment pending approval"
    await expect(page.getByRole("heading", { name: /^Payment / })).toBeVisible({ timeout: 45_000 });
  });

  test("approvals center shows pending requests", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("demo@zfloat.app");
    await page.getByLabel("Password").fill("Demo@12345");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/portal");
    await page.goto("/portal/approvals");
    await expect(page.getByText("Approval center")).toBeVisible();
  });
});

test.describe("platform admin", () => {
  test("admin login → overview and pricing console", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("admin@zfloat.app");
    await page.getByLabel("Password").fill("Demo@12345");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/admin");
    await expect(page.getByText("Platform overview")).toBeVisible({ timeout: 30_000 });

    await page.goto("/admin/pricing");
    await expect(page.getByRole("heading", { name: "Pricing & fees" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("single_payment", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  });

  test("unauthorized users are blocked from admin", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("demo@zfloat.app");
    await page.getByLabel("Password").fill("Demo@12345");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/portal");
    await page.goto("/admin");
    await expect(page.getByText("Platform admin access required")).toBeVisible({ timeout: 30_000 });
  });
});
