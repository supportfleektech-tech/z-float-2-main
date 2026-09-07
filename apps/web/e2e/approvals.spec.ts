/**
 * Maker-checker hardening E2E (production build, seeded demo DB):
 *  - above-threshold payments stay PENDING_APPROVAL until an independent
 *    approver releases them (demo default policy: > KES 10,000 → APPROVER);
 *  - payee-book additions are PENDING until an approver activates them;
 *  - reversal requests move funds only after an approver signs off;
 *  - privileged role invites can't be used until an approver approves them.
 *
 * Maker = demo@zfloat.app (Demo Owner) · Checker = approver@acme.co.ke (APPROVER).
 * The checker runs in its OWN browser context — cookies must never leak
 * between the two roles.
 */
import { test, expect, type Page, type Browser, type APIRequestContext } from "@playwright/test";

const MAKER = { email: "demo@zfloat.app", password: "Demo@12345" };
const CHECKER = { email: "approver@acme.co.ke", password: "Acme@Faith123!" };

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal**");
}

/** Fresh, isolated session for the checker role (never shares maker cookies). */
async function checkerSession(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, CHECKER);
  return { ctx, page };
}

async function pollStatus(req: APIRequestContext, paymentId: string, want: string, timeoutMs = 90_000) {
  await expect
    .poll(
      async () => {
        const r = await req.get(`/api/payments/${paymentId}`);
        if (!r.ok()) return null;
        const j = (await r.json()) as { data?: { status?: string } };
        return j.data?.status ?? null;
      },
      { timeout: timeoutMs, intervals: [2000, 4000] },
    )
    .toBe(want);
}

/** Approve the approvals-center row that contains `marker` (must be unique). */
async function approveRow(page: Page, marker: string) {
  await page.goto("/portal/approvals");
  const row = page.locator("tbody tr", { hasText: marker }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.locator("tbody tr", { hasText: marker })).toHaveCount(0, { timeout: 20_000 });
}

test.describe("maker-checker hardening", () => {
  test("above-threshold payment stays PENDING_APPROVAL until an approver releases it", async ({ page, context, browser }) => {
    const marker = `e2e-mc-${Date.now().toString(36)}`;
    await signIn(page, MAKER);

    // Maker: create a KES 25,000 payment (above the demo threshold).
    await page.goto("/portal/payments/new");
    await page.getByLabel("Amount (KES)").fill("25000");
    await page.getByLabel("Recipient name").fill(marker);
    await page.getByLabel("Phone (Kenyan mobile)").fill("0712000099");
    await page.getByRole("button", { name: "Submit payment" }).click();
    await expect(page.getByRole("heading", { name: /^Payment pending approval$/ })).toBeVisible({ timeout: 30_000 });

    // The maker cannot release their own payment — it must stay pending.
    const href = await page.locator('a[href*="/portal/transactions/"]').first().getAttribute("href");
    const paymentId = href!.split("/").pop()!;
    const makerReq = context.request;
    const pending = await makerReq.get(`/api/payments/${paymentId}`);
    expect(((await pending.json()) as { data: { status: string } }).data.status).toBe("PENDING_APPROVAL");

    // Checker: approve it from the Approval center (own isolated session).
    const checker = await checkerSession(browser);
    try {
      await approveRow(checker.page, marker);
    } finally {
      await checker.ctx.close();
    }

    // Worker releases it and the provider settles it.
    await pollStatus(makerReq, paymentId, "SUCCESS");
  });

  test("payee-book additions are PENDING until an approver activates them", async ({ page, browser }) => {
    const marker = `e2e-payee-${Date.now().toString(36)}`;
    await signIn(page, MAKER);

    await page.goto("/portal/recipients");
    await page.getByRole("button", { name: "+ Add recipient" }).click();
    await page.getByLabel("Name").fill(marker);
    await page.getByLabel("Phone (Kenyan mobile)").fill("0712000098");
    await page.getByRole("button", { name: "Save recipient" }).click();

    // Maker sees the payee listed as pending approval (not immediately payable).
    const row = page.locator("tbody tr", { hasText: marker }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("Pending approval");

    // Checker activates it from the Approval center (own isolated session).
    const checker = await checkerSession(browser);
    try {
      await approveRow(checker.page, marker);
    } finally {
      await checker.ctx.close();
    }

    await page.reload();
    const after = page.locator("tbody tr", { hasText: marker }).first();
    await expect(after).toContainText("ACTIVE", { timeout: 15_000 });
  });

  test("reversal requests move funds only after an approver signs off", async ({ page, context, browser }) => {
    const marker = `e2e-rev-${Date.now().toString(36)}`;
    await signIn(page, MAKER);

    // Maker: an ordinary under-threshold payment (one-person, executes).
    await page.goto("/portal/payments/new");
    await page.getByLabel("Amount (KES)").fill("1500");
    await page.getByLabel("Recipient name").fill(marker);
    await page.getByLabel("Phone (Kenyan mobile)").fill("0712000097");
    await page.getByRole("button", { name: "Submit payment" }).click();
    await expect(page.getByRole("heading", { name: /^Payment / })).toBeVisible({ timeout: 30_000 });
    const href = await page.locator('a[href*="/portal/transactions/"]').first().getAttribute("href");
    const paymentId = href!.split("/").pop()!;
    const makerReq = context.request;
    await pollStatus(makerReq, paymentId, "SUCCESS");

    // Maker requests a reversal — the transaction detail page confirms it is
    // now awaiting an approver and the payment is NOT yet reversed.
    await page.goto(`/portal/transactions/${paymentId}`);
    await page.getByRole("button", { name: "Request reversal" }).click();
    await expect(page.getByText("Reversal request submitted", { exact: false })).toBeVisible({ timeout: 20_000 });
    const stillSuccess = await makerReq.get(`/api/payments/${paymentId}`);
    expect(((await stillSuccess.json()) as { data: { status: string } }).data.status).toBe("SUCCESS");

    // Checker approves the reversal in the Approval center → funds move back.
    const detail = (await (await makerReq.get(`/api/payments/${paymentId}`)).json()) as { data: { paymentNumber: string } };
    const checker = await checkerSession(browser);
    try {
      await approveRow(checker.page, `${detail.data.paymentNumber} reversal`);
    } finally {
      await checker.ctx.close();
    }
    await pollStatus(makerReq, paymentId, "REVERSED");
  });

  test("privileged role invites are maker-checked; invitee registers only after approval", async ({ page, context, browser }) => {
    const email = `e2e-role-${Date.now().toString(36)}@example.com`;
    await signIn(page, MAKER);

    // Maker invites a user into the APPROVER role (privileged).
    await page.goto("/portal/team");
    await page.getByRole("button", { name: "+ Invite member" }).click();
    await page.getByLabel("Email").fill(email);
    await page.locator("#inv-role").selectOption({ label: "APPROVER" });
    await page.getByRole("button", { name: "Send invite" }).click();
    // The invite is not usable yet — the UI surfaces the pending sign-off.
    await expect(page.getByText("✓ Invitation sent to", { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/pending.*independent checker must sign off/i)).toBeVisible();

    // Grab the demo invite link (raw token lives only in demo mode).
    const linkEl = page.locator("p.break-all").last();
    const inviteUrl = (await linkEl.textContent())!.trim();
    const token = inviteUrl.split("?invite=")[1];

    // Invitee tries to register before the checker signs off → blocked.
    const registerBody = { email, fullName: "E2E Role User", password: "Strong@12345", inviteToken: token };
    const blocked = await context.request.post("/api/auth/register", { data: registerBody });
    expect(blocked.status()).toBe(403);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("ROLE_AWAITING_APPROVAL");

    // Checker approves the role grant (own isolated session).
    const checker = await checkerSession(browser);
    try {
      await approveRow(checker.page, email);
    } finally {
      await checker.ctx.close();
    }

    // Now the invitee can register into the APPROVER role.
    const ok = await context.request.post("/api/auth/register", { data: registerBody });
    expect(ok.status()).toBe(201);
    const created = (await ok.json()) as { user?: { email?: string } };
    expect(created.user?.email).toBe(email);
  });
});
