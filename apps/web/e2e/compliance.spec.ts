/**
 * KYC / AML compliance E2E:
 *  1. A business owner uploads KYC documents; the malware scan must complete
 *     (files.scan worker) before the profile can be submitted for review.
 *  2. A payment to a watchlist name is risk-flagged at submit time and lands
 *     in the admin compliance queue as an OPEN sanctions case; the compliance
 *     officer reviews the tenant evidence and clears both the profile and the
 *     case.
 *
 * Repeatability: run the suite against a freshly cleaned demo DB — the KYC
 * profile is single-use per tenant. Reset before each full-suite run:
 *   psql "…zfloat" -c "TRUNCATE kyc_cases, kyc_screenings, kyc_documents, kyc_profiles CASCADE"
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const DEMO = { email: "demo@zfloat.app", password: "Demo@12345" };
const ADMIN = { email: "admin@zfloat.app", password: "Demo@12345" };

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/portal|\/admin/);
}

test.describe("KYC compliance workspace", () => {
  test("owner uploads documents → scan CLEAN → submit for review", async ({ page }) => {
    await signIn(page, DEMO.email, DEMO.password);
    await page.goto("/portal/compliance");
    await expect(page.getByRole("heading", { name: "Compliance & KYC" })).toBeVisible();

    // Upload a CR12 certificate (fake PDF bytes — the sandbox scanner mocks
    // clamav; only script-bomb extensions are rejected).
    await page.locator("input#file").setInputFiles({
      name: "cr12-e2e.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n"),
    });
    await page.getByRole("button", { name: "Upload document" }).click();
    await expect(page.getByText("Uploaded — malware scan queued", { exact: false })).toBeVisible();

    // Wait for the files.scan worker to flip the row to CLEAN (assert on the
    // table cell — page copy also contains the word "CLEAN").
    await expect(page.getByRole("cell", { name: "CLEAN", exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("All documents scanned CLEAN", { exact: false })).toBeVisible();

    // Submit for review.
    await page.getByLabel("Registered business name").fill("E2E Compliance Co Ltd");
    await page.getByLabel("Registration / KRA PIN").fill("PVT-E2E0001X");
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText("Profile submitted for review", { exact: false })).toBeVisible();
    await expect(page.getByText("PENDING").first()).toBeVisible();
  });

  test("watchlist-hit payment → compliance case → officer clears it", async ({ browser }) => {
    // Two personas in isolated sessions: the owner creates the payment, the
    // compliance officer reviews it.
    const demoCtx: BrowserContext = await browser.newContext();
    const adminCtx: BrowserContext = await browser.newContext();
    const page: Page = await demoCtx.newPage();
    await signIn(page, DEMO.email, DEMO.password);
    await page.goto("/portal/payments/new");
    await page.getByLabel("Amount (KES)").fill("2500");
    await page.getByLabel("Recipient name").fill("Grace Wambui");
    await page.getByLabel("Phone (Kenyan mobile)").fill("0712000009");
    await page.getByRole("button", { name: "Submit payment" }).click();
    await expect(page.getByRole("heading", { name: /Payment pending approval/ })).toBeVisible({ timeout: 45_000 });

    // Compliance officer (platform admin) reviews the case.
    const adminPage: Page = await adminCtx.newPage();
    await signIn(adminPage, ADMIN.email, ADMIN.password);
    await adminPage.goto("/admin/kyc");
    await expect(adminPage.getByRole("heading", { name: "KYC & AML cases" })).toBeVisible();
    await expect(adminPage.getByText("Sanctions match").first()).toBeVisible();
    await expect(adminPage.getByText("Grace Wambui").first()).toBeVisible();
    await expect(adminPage.getByText("CRITICAL").first()).toBeVisible();

    // Open the tenant evidence modal and approve the pending profile.
    await adminPage.getByRole("button", { name: "Profile" }).first().click();
    await expect(adminPage.getByText("Tenant KYC evidence")).toBeVisible();
    await expect(adminPage.getByText("PENDING").first()).toBeVisible();
    await adminPage.getByRole("button", { name: "Approve (FULL)" }).click();
    await expect(adminPage.getByText("Profile approved", { exact: false })).toBeVisible({ timeout: 20_000 });

    // Clear the sanctions case itself.
    await adminPage.getByRole("button", { name: "Decide" }).first().click();
    await adminPage.getByRole("button", { name: "Clear & approve" }).click();
    await expect(adminPage.getByText("Case approved — action recorded", { exact: false })).toBeVisible({ timeout: 20_000 });
  });
});
