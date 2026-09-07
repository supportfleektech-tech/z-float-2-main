/**
 * Phase 3 (GAP-ANALYSIS) — reconciliation exception resolution workflow E2E on
 * the production build:
 *
 *  Portal (tenant member): import a statement row with no matching payment,
 *  open the exception → comment (state unchanged, note + actor in history) →
 *  resolve (status RESOLVED, resolution note shown, list refreshes) → reopen
 *  (back to OPEN, history append-only).
 *
 *  Admin (platform): the same exception is visible cross-tenant on
 *  /admin/reconciliation with the tenant name, and platform staff can comment
 *  on it (audited). Actions that mutate shared state are kept existence-based
 *  so reruns stay green.
 */
import { test, expect, type Page } from "@playwright/test";

const DEMO = { email: "demo@zfloat.app", password: "Demo@12345" };
const ADMIN = { email: "admin@zfloat.app", password: "Demo@12345" };

async function signIn(page: Page, creds: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Tenant members land on /portal, platform admins on /admin.
  await page.waitForURL(/\/portal|\/admin/);
}

/** Unique statement row for THIS spec run (imports accumulate across runs). */
const STAMP = `E2E-RECON-${Date.now()}`;

test.describe.configure({ mode: "serial" });

test.describe("Phase 3 — recon exception resolution workflow", () => {
  test("portal: comment → resolve → reopen keeps an audited history", async ({ page }) => {
    await signIn(page, DEMO);
    await page.goto("/portal/reconciliation");
    await expect(page.getByRole("heading", { name: "Reconciliation" })).toBeVisible();

    // Raise a fresh exception via the CSV import surface (kept per GAP).
    const resp = page.waitForResponse((r) => r.url().includes("/api/reconciliation/statement") && r.ok());
    await page.getByLabel("Statement CSV").fill(`provider_reference,amount,date\n${STAMP},10.00,2026-09-01\n`);
    await page.getByRole("button", { name: "Import & match" }).click();
    const body = await (await resp).json();
    expect(body?.data?.rowsImported).toBe(1);
    expect(body?.data?.unmatched).toBe(1);

    const row = page.locator("tr", { hasText: STAMP });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText("OPEN")).toBeVisible();

    // Open the workflow panel.
    await row.getByRole("button", { name: "Review" }).click();
    const panel = page.getByTestId("recon-exception-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("No activity yet — raised by the reconciliation engine.")).toBeVisible();

    // Comment: state unchanged, note recorded with the actor.
    const noteBox = panel.getByRole("textbox");
    await noteBox.fill("E2E: checking the provider file for this reference.");
    await panel.getByRole("button", { name: "Add comment" }).click();
    await expect(panel.getByText("E2E: checking the provider file for this reference.")).toBeVisible();
    await expect(panel.getByText(/Demo Owner/).first()).toBeVisible();
    await expect(panel.getByText("OPEN").first()).toBeVisible();

    // Resolve: required resolution note, status flips to RESOLVED everywhere.
    await noteBox.fill("E2E: provider confirmed — amount matches the statement net of fees.");
    await panel.getByRole("button", { name: "Resolve exception" }).click();
    await expect(panel.getByText("Resolution:", { exact: false })).toBeVisible();
    await expect(panel.getByText("RESOLVED").first()).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText("RESOLVED")).toBeVisible(); // list refreshed

    // Reopen: back to OPEN, resolution cleared, history keeps everything.
    await panel.getByRole("button", { name: "Reopen" }).click();
    await expect(row.getByText("OPEN")).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText("Reopened for further investigation")).toBeVisible();
    await expect(panel.getByText("Resolution:", { exact: false })).toHaveCount(0);
    // History is newest-first: Reopened → Resolved → Comment.
    await expect(panel.getByText("Reopened", { exact: true })).toBeVisible();
    await expect(panel.getByText("Resolved", { exact: true }).first()).toBeVisible();
    await expect(panel.getByText("Comment", { exact: true }).first()).toBeVisible();
  });

  test("admin: exceptions surface cross-tenant with history and platform can act", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/admin/reconciliation");
    await expect(page.getByRole("heading", { name: "Reconciliation operations" })).toBeVisible();

    // Cross-tenant evidence: the demo tenant's rows appear with their tenant name.
    await expect(page.getByText("Acme", { exact: false }).first()).toBeVisible({ timeout: 20_000 });

    // The exception raised by the portal test is actionable from here.
    const row = page.locator("tr", { hasText: STAMP });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: "Manage" }).click();
    const panel = page.getByTestId("recon-exception-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Tenant:")).toBeVisible();

    // History authored by the tenant user is visible to platform staff.
    await expect(panel.getByText(/Demo Owner/).first()).toBeVisible();

    // Platform comment lands in the same trail.
    const adminNote = `E2E-ADMIN ${Date.now()} platform review note`;
    await panel.getByRole("textbox").fill(adminNote);
    await panel.getByRole("button", { name: "Add comment" }).click();
    await expect(panel.getByText(adminNote)).toBeVisible();
  });
});
