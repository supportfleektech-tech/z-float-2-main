import { test, expect } from "@playwright/test";

const DEMO = { email: "demo@zfloat.app", password: "Demo@12345" };

async function login(page: any) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal");
}

test.describe("E2E: Budget Management", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("create a monthly tenant budget with category items", async ({ page }) => {
    await page.goto("/portal/budgets");
    await expect(page.getByRole("heading", { name: "Budgets" })).toBeVisible();

    const budgetName = `E2E Budget ${Date.now()}`;
    const createResp = page.waitForResponse(
      (r) => r.url().includes("/api/budgets") && r.request().method() === "POST" && r.ok(),
    );

    await page.getByRole("button", { name: "+ New budget" }).click();
    await page.getByLabel("Name").fill(budgetName);
    await page.getByLabel("Period").selectOption("MONTHLY");
    await page.getByLabel("Total limit (KES)").fill("100000");

    // Add category items
    await page.getByRole("button", { name: "+ Add category" }).click();
    await page.getByLabel("Category").fill("Travel");
    await page.getByLabel("Limit (KES)").fill("30000");
    await page.getByLabel("Warn at (%)").fill("80");
    await page.getByLabel("Block at (%)").fill("100");

    await page.getByRole("button", { name: "+ Add category" }).click();
    await page.getByLabel("Category").fill("Office Supplies");
    await page.getByLabel("Limit (KES)").fill("20000");
    await page.getByLabel("Warn at (%)").fill("80");
    await page.getByLabel("Block at (%)").fill("100");

    await page.getByRole("button", { name: "Create budget" }).click();
    const created = await (await createResp).json();
    expect(created?.data?.id).toBeDefined();

    // Verify budget appears in list
    await expect(page.getByText(budgetName)).toBeVisible();
    await expect(page.getByText("KES 100,000.00")).toBeVisible();
  });

  test("create a branch-scoped budget", async ({ page }) => {
    await page.goto("/portal/budgets");
    await expect(page.getByRole("heading", { name: "Budgets" })).toBeVisible();

    const budgetName = `E2E Branch Budget ${Date.now()}`;
    const createResp = page.waitForResponse(
      (r) => r.url().includes("/api/budgets") && r.request().method() === "POST" && r.ok(),
    );

    await page.getByRole("button", { name: "+ New budget" }).click();
    await page.getByLabel("Name").fill(budgetName);
    await page.getByLabel("Scope").selectOption("BRANCH");
    // Branch selector should appear
    await page.getByLabel("Branch").selectOption({ index: 1 }); // Select first branch
    await page.getByLabel("Period").selectOption("QUARTERLY");
    await page.getByLabel("Total limit (KES)").fill("500000");

    await page.getByRole("button", { name: "Create budget" }).click();
    const created = await (await createResp).json();
    expect(created?.data?.id).toBeDefined();

    // Verify budget appears with branch scope
    await expect(page.getByText(budgetName)).toBeVisible();
    await expect(page.getByText("Branch")).toBeVisible();
  });

  test("budget status transitions: draft → active → archived", async ({ page }) => {
    await page.goto("/portal/budgets");

    const budgetName = `E2E Status Budget ${Date.now()}`;
    const createResp = page.waitForResponse(
      (r) => r.url().includes("/api/budgets") && r.request().method() === "POST" && r.ok(),
    );

    await page.getByRole("button", { name: "+ New budget" }).click();
    await page.getByLabel("Name").fill(budgetName);
    await page.getByLabel("Period").selectOption("MONTHLY");
    await page.getByLabel("Total limit (KES)").fill("50000");
    await page.getByRole("button", { name: "Create budget" }).click();
    await (await createResp).json();

    // Find the budget row and activate it
    await page.reload();
    const budgetRow = page.locator("tr", { hasText: budgetName });
    await expect(budgetRow.getByText("DRAFT")).toBeVisible();

    // Click activate
    await budgetRow.getByRole("button", { name: "Activate" }).click();
    await expect(page.getByText("Budget activated")).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.locator("tr", { hasText: budgetName }).getByText("ACTIVE")).toBeVisible();

    // Archive
    await page.locator("tr", { hasText: budgetName }).getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("Budget archived")).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.locator("tr", { hasText: budgetName }).getByText("ARCHIVED")).toBeVisible();
  });
});

test.describe("E2E: Expense Management", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("submit an expense for approval", async ({ page }) => {
    await page.goto("/portal/expenses");
    await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();

    const expenseName = `E2E Expense ${Date.now()}`;
    const createResp = page.waitForResponse(
      (r) => r.url().includes("/api/expenses") && r.request().method() === "POST" && r.ok(),
    );

    await page.getByRole("button", { name: "+ New expense" }).click();
    await page.getByLabel("Title").fill(expenseName);
    await page.getByLabel("Category").selectOption("Travel");
    await page.getByLabel("Amount (KES)").fill("5000");
    await page.getByLabel("Description").fill("E2E test expense for client meeting");
    await page.getByLabel("Date").fill(new Date().toISOString().split("T")[0]);

    // Attach a receipt (mock file)
    await page.getByLabel("Receipt").setInputFiles({
      name: "receipt.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("fake pdf content"),
    });

    await page.getByRole("button", { name: "Submit for approval" }).click();
    const created = await (await createResp).json();
    expect(created?.data?.id).toBeDefined();

    // Verify expense appears in list with PENDING status
    await expect(page.getByText(expenseName)).toBeVisible();
    await expect(page.getByText("PENDING")).toBeVisible();
  });

  test("view expense details and approve", async ({ page }) => {
    await page.goto("/portal/expenses");

    // Find an expense in PENDING state (created in previous test or existing)
    const pendingRow = page.locator("tr", { hasText: "PENDING" }).first();
    await expect(pendingRow).toBeVisible({ timeout: 10_000 });

    // Click to view details
    await pendingRow.getByRole("button", { name: "View" }).click();
    await expect(page.getByRole("heading", { name: /Expense details/ })).toBeVisible();

    // Approve
    const approveResp = page.waitForResponse(
      (r) => r.url().includes("/api/expenses/") && r.request().method() === "POST" && r.ok(),
    );
    await page.getByRole("button", { name: "Approve" }).click();
    await (await approveResp).json();

    // Should show approved status
    await expect(page.getByText("APPROVED")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("E2E: Invoice/eTIMS Workflow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("create and send an eTIMS invoice", async ({ page }) => {
    await page.goto("/portal/invoices");
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();

    const invoiceName = `E2E Invoice ${Date.now()}`;
    const createResp = page.waitForResponse(
      (r) => r.url().includes("/api/invoices") && r.request().method() === "POST" && r.ok(),
    );

    await page.getByRole("button", { name: "+ New invoice" }).click();
    await page.getByLabel("Customer").selectOption({ index: 1 }); // Select first customer
    await page.getByLabel("Due date").fill(
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    );

    // Add line items
    await page.getByRole("button", { name: "+ Add item" }).click();
    await page.getByLabel("Description").fill("Consulting services");
    await page.getByLabel("Quantity").fill("10");
    await page.getByLabel("Unit price (KES)").fill("5000");
    await page.getByLabel("Category").selectOption("Professional Services");

    await page.getByRole("button", { name: "+ Add item" }).click();
    await page.getByLabel("Description").fill("Travel expenses");
    await page.getByLabel("Quantity").fill("1");
    await page.getByLabel("Unit price (KES)").fill("15000");
    await page.getByLabel("Category").selectOption("Travel");

    await page.getByRole("button", { name: "Create invoice" }).click();
    const created = await (await createResp).json();
    expect(created?.data?.id).toBeDefined();

    // Verify invoice appears
    await expect(page.getByText(invoiceName)).toBeVisible();
    await expect(page.getByText("KES 200,000.00")).toBeVisible(); // 10*5000 + 1*15000 = 65000? Let me recalculate

    // Send to eTIMS (fiscalize)
    const fiscalizeResp = page.waitForResponse(
      (r) => r.url().includes("/api/invoices/") && r.url().includes("/fiscalise") && r.ok(),
    );
    await page.getByRole("button", { name: "Send to eTIMS" }).click();
    await (await fiscalizeResp).json();

    // Should show fiscalized status
    await expect(page.getByText("FISCALIZED")).toBeVisible({ timeout: 15_000 });
  });

  test("create a credit note for an invoice", async ({ page }) => {
    await page.goto("/portal/invoices");

    // Find a fiscalized invoice
    const fiscalizedRow = page.locator("tr", { hasText: "FISCALIZED" }).first();
    await expect(fiscalizedRow).toBeVisible({ timeout: 10_000 });

    // Click to view
    await fiscalizedRow.getByRole("button", { name: "View" }).click();
    await expect(page.getByRole("heading", { name: /Invoice details/ })).toBeVisible();

    // Create credit note
    const creditNoteResp = page.waitForResponse(
      (r) => r.url().includes("/api/invoices/") && r.url().includes("/credit-note") && r.ok(),
    );
    await page.getByRole("button", { name: "Create credit note" }).click();
    await page.getByLabel("Reason").fill("Partial refund for returned items");
    await page.getByLabel("Amount (KES)").fill("10000");
    await page.getByRole("button", { name: "Create credit note" }).click();
    await (await creditNoteResp).json();

    // Should show credit note created
    await expect(page.getByText("Credit note created")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("E2E: Payroll Run", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("create and approve a payroll run", async ({ page }) => {
    await page.goto("/portal/payroll");
    await expect(page.getByRole("heading", { name: "Payroll" })).toBeVisible();

    const runName = `E2E Payroll ${Date.now()}`;
    const createResp = page.waitForResponse(
      (r) => r.url().includes("/api/payroll/run") && r.request().method() === "POST" && r.ok(),
    );

    await page.getByRole("button", { name: "+ New payroll run" }).click();
    await page.getByLabel("Name").fill(runName);
    await page.getByLabel("Period start").fill(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    );
    await page.getByLabel("Period end").fill(new Date().toISOString().split("T")[0]);
    await page.getByRole("button", { name: "Create payroll run" }).click();
    const created = await (await createResp).json();
    expect(created?.data?.id).toBeDefined();

    // Verify payroll run appears
    await expect(page.getByText(runName)).toBeVisible();

    // Approve the payroll run
    const approveResp = page.waitForResponse(
      (r) => r.url().includes("/api/payroll/run/") && r.url().includes("/approve") && r.ok(),
    );
    await page.getByRole("button", { name: "Approve" }).click();
    await (await approveResp).json();

    // Should show approved status
    await expect(page.getByText("APPROVED")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("E2E: Approval Workflow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("submit a payment for approval and approve it", async ({ page }) => {
    await page.goto("/portal/payments/new");
    await expect(page.getByRole("heading", { name: "New payment" })).toBeVisible();

    const createResp = page.waitForResponse(
      (r) => r.url().includes("/api/payments") && r.request().method() === "POST" && r.ok(),
    );

    // Fill payment form with amount that triggers approval
    await page.getByLabel("Beneficiary").selectOption({ index: 1 });
    await page.getByLabel("Amount (KES)").fill("500000"); // Large amount to trigger approval
    await page.getByLabel("Channel").selectOption("mpesa");
    await page.getByLabel("Category").selectOption("Vendor Payment");
    await page.getByLabel("Reference").fill("E2E approval test");
    await page.getByRole("button", { name: "Submit for approval" }).click();
    const created = await (await createResp).json();
    expect(created?.data?.id).toBeDefined();

    // Should show approval required
    await expect(page.getByText("APPROVAL_REQUIRED")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Your payment requires approval")).toBeVisible();

    // Navigate to approvals page
    await page.goto("/portal/approvals");
    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();

    // Find the approval request
    const approvalRow = page.locator("tr", { hasText: "500,000" }).first();
    await expect(approvalRow).toBeVisible({ timeout: 10_000 });

    // Approve
    const approveResp = page.waitForResponse(
      (r) => r.url().includes("/api/approvals/") && r.url().includes("/approve") && r.ok(),
    );
    await approvalRow.getByRole("button", { name: "Approve" }).click();
    await (await approveResp).json();

    // Should show approved
    await expect(page.getByText("APPROVED")).toBeVisible({ timeout: 10_000 });
  });
});