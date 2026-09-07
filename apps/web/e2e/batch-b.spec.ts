/**
 * Batch B E2E (production build):
 *  - catalogs console: biller + airtime CRUD — now MAKER-CHECKER: the maker's
 *    UI action stages a change (202 PENDING_APPROVAL); a second platform
 *    admin (ops@zfloat.app) approves in the Config approvals centre and only
 *    then does the row appear/change; the apply is audited on the approver.
 *  - audit viewer: filters + before/after diff expansion (events written on
 *    apply, actor = checker).
 *  - approval-policy builder: create / pause / activate / rule edits are
 *    staged too — the maker's UI action returns 202 PENDING_APPROVAL, ops
 *    approves in the Config approvals centre, and only then does the policy
 *    land (v1) / flip state / publish v2 with the archived v1 snapshot.
 */
import { test, expect, type Page, type BrowserContext, type Browser } from "@playwright/test";

const ADMIN = { email: "admin@zfloat.app", password: "Demo@12345" };
const OPS = { email: "ops@zfloat.app", password: "Demo@12345" };

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin**");
}

/** Admin-session fetch (plain fetch carries no cookie — forward it manually). */
async function adminFetch(context: BrowserContext, baseURL: string | undefined, path: string, init?: RequestInit) {
  const cookies = await context.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await fetch(`${baseURL ?? "http://localhost:3000"}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), cookie: cookieHeader },
  });
  return { status: res.status, body: (await res.json()) as { data?: unknown; error?: { message?: string } } };
}

/** Second platform admin (the checker) in a dedicated browser context. */
async function opsSession(browser: Browser, baseURL: string | undefined) {
  const ctx = await browser.newContext();
  const base = baseURL ?? "http://localhost:3000";
  const res = await ctx.request.post(`${base}/api/auth/login`, { data: OPS });
  expect(res.status()).toBe(200);
  return ctx;
}

/** Approve the pending staged change whose label/code contains `needle`. */
async function approvePending(opsCtx: BrowserContext, baseURL: string | undefined, needle: string, decision: "approve" | "reject" = "approve") {
  const base = baseURL ?? "http://localhost:3000";
  const list = await opsCtx.request.get(`${base}/api/admin/config-requests?status=PENDING`);
  const data = ((await list.json()) as { data: Array<{ id: string; change: { label: string; payload: Record<string, unknown> } | null }> }).data;
  const hit = data.find((r) => (r.change?.label ?? "").includes(needle) || JSON.stringify(r.change?.payload ?? {}).includes(needle));
  expect(hit, `pending request containing "${needle}"`).toBeTruthy();
  const res = await opsCtx.request.post(`${base}/api/admin/config-requests/${hit!.id}`, {
    data: { decision, comment: decision === "approve" ? "ok by ops" : "not now" },
  });
  expect(res.status()).toBe(200);
  const out = (await res.json()) as { data: { status: string; applied?: boolean } };
  if (decision === "approve") expect(out.data.applied).toBe(true);
  return hit!.id;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

type AuditEventDto = { action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

async function auditByAction(context: BrowserContext, baseURL: string | undefined, actionPrefix: string, actor = OPS.email): Promise<AuditEventDto[]> {
  const r = await adminFetch(context, baseURL, `/api/admin/audit?action=${encodeURIComponent(actionPrefix)}&actor=${actor}&limit=500`);
  return (r.body.data ?? []) as AuditEventDto[];
}

test.describe("batch B · admin consoles + audit viewer", () => {
  test("catalogs console: biller CRUD is two-person (stage → ops approve) and audited on apply", async ({ page, context, browser, baseURL }) => {
    await signIn(page);
    const ops = await opsSession(browser, baseURL);
    await page.goto("/admin/catalogs");
    await expect(page.getByRole("heading", { name: "Catalogs" })).toBeVisible();

    const ts = Date.now().toString(36);
    const code = `e2e-b-${ts}`;
    const name = `E2E Biller ${ts}`;
    const renamed = `${name} renamed`;

    // --- create is staged: nothing appears until ops approves ---
    await page.getByRole("button", { name: "+ Add biller", exact: true }).click();
    await page.getByLabel("Code").fill(code);
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Category").fill("E2E test");
    await page.getByLabel("Account number").fill("880100");
    await page.getByRole("button", { name: "Add biller", exact: true }).click();
    await expect(page.getByText(/change submitted\. A second platform admin/i)).toBeVisible();
    await expect(page.locator("tr", { hasText: name })).toHaveCount(0); // staged, not applied

    await approvePending(ops, baseURL, name);
    await page.reload();
    const row = page.locator("tr", { hasText: name });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText("ACTIVE", { exact: true })).toBeVisible();
    await expect(row.getByText(code, { exact: true })).toBeVisible();

    // --- disable is staged ---
    await row.getByRole("button", { name: "Disable", exact: true }).click();
    await expect(page.getByText(/change submitted/i)).toBeVisible();
    await approvePending(ops, baseURL, name);
    await page.reload();
    await expect(page.locator("tr", { hasText: name }).getByText("DISABLED", { exact: true })).toBeVisible();

    // --- edit is staged (code immutable) ---
    const row1 = page.locator("tr", { hasText: name });
    await row1.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByLabel("Code")).toBeDisabled();
    await page.getByLabel("Name").fill(renamed);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText(/change submitted/i)).toBeVisible();
    await approvePending(ops, baseURL, renamed);
    await page.reload();
    const row2 = page.locator("tr", { hasText: renamed });
    await expect(row2).toBeVisible();
    await expect(row2.getByText("DISABLED", { exact: true })).toBeVisible(); // edit keeps toggle state

    // --- re-enable then delete, both staged ---
    await row2.getByRole("button", { name: "Enable", exact: true }).click();
    await expect(page.getByText(/change submitted/i)).toBeVisible();
    await approvePending(ops, baseURL, renamed);
    await page.reload();
    await expect(page.locator("tr", { hasText: renamed }).getByText("ACTIVE", { exact: true })).toBeVisible();

    page.once("dialog", (d) => void d.accept());
    await page.locator("tr", { hasText: renamed }).getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText(/change submitted/i)).toBeVisible();
    await approvePending(ops, baseURL, renamed);
    await page.reload();
    await expect(page.locator("tr", { hasText: renamed })).toHaveCount(0);

    // --- audit events were written on apply, by the CHECKER (ops) ---
    const list = await auditByAction(context, baseURL, "catalog.biller.");
    const created = list.find((e) => e.action === "catalog.biller.create" && (e.after as { code?: string })?.code === code);
    expect(created, "create event with code payload").toBeTruthy();
    const updated = list.find((e) => e.action === "catalog.biller.update" && (e.after as { name?: string })?.name === renamed && (e.after as { enabled?: boolean })?.enabled === true);
    expect(updated, "update event (re-enable) with before+after").toBeTruthy();
    expect((updated!.before as { enabled?: boolean })?.enabled).toBe(false);
    expect((updated!.after as { enabled?: boolean })?.enabled).toBe(true);
    const deleted = list.find((e) => e.action === "catalog.biller.delete" && (e.before as { code?: string })?.code === code);
    expect(deleted, "delete event with before snapshot").toBeTruthy();
    await ops.close();
  });

  test("catalogs console: airtime CRUD is two-person and audited on apply", async ({ page, context, browser, baseURL }) => {
    await signIn(page);
    const ops = await opsSession(browser, baseURL);
    await page.goto("/admin/catalogs");

    const ts = Date.now().toString(36);
    const productCode = `e2e-${ts}-air`;
    const name = `E2E Airtime ${ts}`;

    await page.getByRole("button", { name: "+ Add product", exact: true }).click();
    await page.getByLabel("Provider code").fill("local-sandbox");
    await page.getByLabel("Network").fill("SAF");
    await page.getByLabel("Product code").fill(productCode);
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Amount (KES)").fill("100");
    await page.getByRole("button", { name: "Add product", exact: true }).click();
    await expect(page.getByText(/change submitted/i)).toBeVisible();
    await approvePending(ops, baseURL, name);
    await page.reload();
    const row = page.locator("tr", { hasText: name });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText("KES 100", { exact: true })).toBeVisible();
    await expect(row.getByText("AIRTIME", { exact: true })).toBeVisible();
    await expect(row.getByText("ACTIVE", { exact: true })).toBeVisible();

    // edit the denomination up to 250 (staged)
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByLabel("Provider code")).toBeDisabled();
    await page.getByLabel("Amount (KES)").fill("250");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText(/change submitted/i)).toBeVisible();
    await approvePending(ops, baseURL, name);
    await page.reload();
    await expect(page.locator("tr", { hasText: name })).toContainText("KES 250");

    // disable + delete (staged)
    const row2 = page.locator("tr", { hasText: name });
    await row2.getByRole("button", { name: "Disable", exact: true }).click();
    await expect(page.getByText(/change submitted/i)).toBeVisible();
    await approvePending(ops, baseURL, name);
    await page.reload();
    await expect(page.locator("tr", { hasText: name }).getByText("DISABLED", { exact: true })).toBeVisible();

    page.once("dialog", (d) => void d.accept());
    await page.locator("tr", { hasText: name }).getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText(/change submitted/i)).toBeVisible();
    await approvePending(ops, baseURL, name);
    await page.reload();
    await expect(page.locator("tr", { hasText: name })).toHaveCount(0);

    // audit: create carried the bigint denomination as a string payload
    const list = await auditByAction(context, baseURL, "catalog.airtime.");
    const created = list.find((e) => e.action === "catalog.airtime.create" && (e.after as { name?: string })?.name === name);
    expect(created, "airtime create event").toBeTruthy();
    expect((created!.after as { denominationMinor?: string })?.denominationMinor).toBe("10000"); // as created (before the edit)
    const updated = list.find((e) => e.action === "catalog.airtime.update" && (e.after as { denominationMinor?: string })?.denominationMinor === "25000");
    expect(updated, "airtime update event").toBeTruthy();
    await ops.close();
  });

  test("audit viewer: staged biller fixture (ops-approved) shows before/after diffs", async ({ page, context, browser, baseURL }) => {
    await signIn(page);
    const ops = await opsSession(browser, baseURL);
    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();

    // Fixture: one created→renamed→deleted biller, each change ops-approved.
    const ts = Date.now().toString(36);
    const code = `e2e-ad-${ts}`;
    const name = `E2E Audit ${ts}`;
    const renamed = `${name} renamed`;

    const created = await adminFetch(context, baseURL, "/api/admin/catalogs/billers", jsonInit("POST", { code, name, category: "E2E", channel: "paybill", accountNumber: "880100" }));
    expect(created.status).toBe(202);
    await approvePending(ops, baseURL, name);
    const id = (await adminFetch(context, baseURL, `/api/admin/audit?action=catalog.biller.create&actor=${OPS.email}`)).body.data as Array<{ resourceId: string }>;
    const billerId = id[0]?.resourceId;
    expect(billerId, "biller created by checker").toBeTruthy();

    const upd = await adminFetch(context, baseURL, `/api/admin/catalogs/billers/${billerId}`, jsonInit("PATCH", { name: renamed }));
    expect(upd.status).toBe(202);
    await approvePending(ops, baseURL, renamed);
    const del = await adminFetch(context, baseURL, `/api/admin/catalogs/billers/${billerId}`, { method: "DELETE" });
    expect(del.status).toBe(202);
    await approvePending(ops, baseURL, renamed);

    // --- API: exact resourceId + action filter returns exactly the one update with payloads ---
    const api = await adminFetch(context, baseURL, `/api/admin/audit?action=catalog.biller.update&resourceType=biller&resourceId=${billerId}&actor=${OPS.email}`);
    const events = (api.body.data ?? []) as Array<{ action: string; resourceId: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; actorEmail: string }>;
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.actorEmail).toBe(OPS.email);
    expect((ev.before as { name?: string }).name).toBe(name);
    expect((ev.after as { name?: string }).name).toBe(renamed);

    // bogus actor → empty result
    const none = await adminFetch(context, baseURL, `/api/admin/audit?action=catalog.biller.update&resourceId=${billerId}&actor=nobody@example.com`);
    expect(none.body.data ?? []).toHaveLength(0);

    // --- UI: filters + diff expansion ---
    await page.goto("/admin/audit");
    const actionInput = page.getByPlaceholder("Action… e.g. payment.update");
    const actorInput = page.getByPlaceholder("Actor email…");

    await actionInput.fill("catalog.biller.update");
    await expect(page.getByText(renamed)).toHaveCount(0); // payloads stay hidden until expanded
    await page.getByText("▸ diff", { exact: true }).first().click();
    await expect(page.getByText("Field-level changes:", { exact: true })).toBeVisible();
    const diffPanel = page.locator("td").filter({ hasText: "Field-level changes:" });
    await expect(diffPanel.getByText("CHANGED", { exact: true })).toBeVisible();
    await expect(diffPanel.getByText(`"${renamed}"`, { exact: true })).toBeVisible(); // new value
    await expect(diffPanel.getByText(`"${name}"`, { exact: true })).toBeVisible(); // struck old value

    await actorInput.fill(OPS.email);

    const typeSelect = page.locator("select").first();
    await expect(typeSelect.locator("option[value='biller']")).toHaveCount(1);

    await actionInput.fill("auth.login.nope");
    await expect(page.getByText("No audit events match the filters.")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.getByText("▸ diff", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    await actionInput.fill("catalog.biller.create");
    await page.getByText("catalog.biller.create", { exact: true }).first().click();
    await expect(page.getByText("Resource created with:", { exact: true })).toBeVisible({ timeout: 15_000 });
    const createPanel = page.locator("td").filter({ hasText: "Resource created with:" });
    await expect(createPanel.getByText("ADDED", { exact: true }).first()).toBeVisible();
    await expect(createPanel.getByText(`"${code}"`, { exact: true })).toBeVisible();
    await ops.close();
  });

  test("config approvals centre: ops sees the maker's staged change and approves it from the UI", async ({ page, browser, baseURL }) => {
    // Maker stages a biller via the API (session cookie required).
    await signIn(page);
    const ts = Date.now().toString(36);
    const code = `e2e-ctr-${ts}`;
    const name = `E2E Centre ${ts}`;
    const staged = await adminFetch(page.context(), baseURL, "/api/admin/catalogs/billers", jsonInit("POST", { code, name, category: "E2E", channel: "paybill", accountNumber: "880100" }));
    expect(staged.status).toBe(202);

    // Checker signs in and opens the centre; the request is listed PENDING,
    // authored by admin@zfloat.app — so ops (different admin) can act.
    const ops = await opsSession(browser, baseURL);
    const opsPage = await ops.newPage();
    await opsPage.goto("/admin/approvals");
    await expect(opsPage.getByRole("heading", { name: "Config approvals" })).toBeVisible();
    const card = opsPage.locator("div.rounded-card").filter({ hasText: name });
    await expect(card.getByText("PENDING", { exact: true })).toBeVisible();
    await expect(card.getByText(ADMIN.email)).toBeVisible();
    await expect(card.getByRole("button", { name: "Approve", exact: true })).toBeVisible();

    // maker's own console lists the request but offers no approve button on it
    await page.goto("/admin/approvals");
    const makerCard = page.locator("div.rounded-card").filter({ hasText: name });
    await expect(makerCard.getByText(/made by you/)).toBeVisible();
    await expect(makerCard.getByRole("button", { name: "Approve" })).toHaveCount(0);

    // approve from the centre (confirm the optional-comment prompt)
    opsPage.once("dialog", (d) => void d.accept("looks good"));
    await card.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(opsPage.getByText(/approved and applied/i)).toBeVisible({ timeout: 15_000 });

    // the row is live for the maker
    await page.goto("/admin/catalogs");
    await expect(page.locator("tr", { hasText: name }).getByText("ACTIVE", { exact: true })).toBeVisible({ timeout: 15_000 });
    await ops.close();
  });

  test("approval-policy builder: create 2-rule policy, pause/activate, rule edit bumps v1→v2", async ({ page, context, baseURL, browser }) => {
    await signIn(page);
    const ops = await opsSession(browser, baseURL);
    await page.goto("/admin/policies");
    await expect(page.getByRole("heading", { name: "Approval policies" })).toBeVisible();

    const ts = Date.now().toString(36);
    const name = `E2E Policy ${ts}`;

    await page.getByLabel("Tenant").selectOption({ label: "Acme Traders Ltd" });
    const emptyOrCard = page
      .getByText("No policies for this tenant yet — create the first one.")
      .or(page.locator("div.rounded-control").first());
    await expect(emptyOrCard).toBeVisible({ timeout: 15_000 });

    const ruleBlock = (i: number) => page.locator(`[data-rule="${i}"]`);
    const pickRole = async (ruleIdx: number, exclude?: string) => {
      const prefs = ["FINANCE_MANAGER", "OWNER", "APPROVER", "ACCOUNTANT", "MAKER", "ADMIN", "BRANCH_MANAGER", "PAYROLL_OFFICER", "PROCUREMENT_OFFICER"];
      const chips = ruleBlock(ruleIdx).locator("button.rounded-full");
      for (const p of prefs) {
        if (p === exclude) continue;
        const chip = chips.filter({ hasText: new RegExp(`^(✓ )?${p}$`) });
        if ((await chip.count()) > 0) {
          await chip.first().click();
          return p;
        }
      }
      const fallback = chips.filter({ hasText: /^[^✓]/ }).first();
      const label = ((await fallback.textContent()) ?? "").trim();
      await fallback.click();
      return label;
    };

    const card = () => page.locator("div.rounded-control", { hasText: name }).first();
    // Reloading the page resets the tenant selector, so re-select the tenant
    // (this also refetches the policies list) before asserting on cards.
    const reselectTenant = async () => {
      await page.getByLabel("Tenant").selectOption({ label: "Acme Traders Ltd" });
      // The tenant fetch resolved once either the empty state or any card shows.
      const emptyOrAnyCard = page
        .getByText("No policies for this tenant yet — create the first one.")
        .or(page.locator("div.rounded-control").first());
      await expect(emptyOrAnyCard).toBeVisible({ timeout: 15_000 });
    };

    // --- create is staged: nothing appears until ops approves ---
    await page.getByRole("button", { name: "+ New policy", exact: true }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Description").fill("Batch B E2E policy");

    await page.getByLabel("Min amount (KES)").fill("50000");
    const role1 = await pickRole(0);
    expect(role1).toBeTruthy();

    await page.getByRole("button", { name: "+ Add rule", exact: true }).click();
    const role2 = await pickRole(1, role1);
    expect(role2).not.toBe(role1);

    await page.getByRole("button", { name: "Create policy", exact: true }).click();
    await expect(page.getByText(/change submitted\. A second platform admin/i)).toBeVisible();
    await expect(card()).toHaveCount(0); // staged, not applied

    await approvePending(ops, baseURL, name);
    await page.reload();
    await reselectTenant();
    await expect(card()).toBeVisible({ timeout: 15_000 });
    await expect(card().getByText("v1", { exact: true })).toBeVisible();
    await expect(card().getByText("ACTIVE", { exact: true })).toBeVisible();
    await expect(card().getByText("2 rules", { exact: true })).toBeVisible();
    await expect(card().getByText(role1)).toBeVisible();

    // --- pause is staged; the badge only flips after ops approves ---
    await card().getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByText(/change submitted\. A second platform admin/i)).toBeVisible();
    await expect(card().getByText("ACTIVE", { exact: true })).toBeVisible(); // still live
    await approvePending(ops, baseURL, name);
    await page.reload();
    await reselectTenant();
    await expect(card().getByText("PAUSED", { exact: true })).toBeVisible({ timeout: 15_000 });

    // --- activate is staged too ---
    await card().getByRole("button", { name: "Activate", exact: true }).click();
    await expect(page.getByText(/change submitted\. A second platform admin/i)).toBeVisible();
    await approvePending(ops, baseURL, name);
    await page.reload();
    await reselectTenant();
    await expect(card().getByText("ACTIVE", { exact: true })).toBeVisible({ timeout: 15_000 });

    // --- rule edit is staged; ops approval archives v1 and publishes v2 ---
    await card().getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByText("Edit policy — v1", { exact: true })).toBeVisible();
    await page.getByLabel("Min amount (KES)").first().fill("100000");
    await page.getByLabel("Change note").fill("Raise the single-stage floor");
    await page.getByRole("button", { name: "Publish new version", exact: true }).click();
    await expect(page.getByText(/change submitted\. A second platform admin/i)).toBeVisible();
    await expect(card().getByText("v1", { exact: true })).toBeVisible(); // still v1 until approved
    await approvePending(ops, baseURL, name);
    await page.reload();
    await reselectTenant();
    await expect(card().getByText("v2", { exact: true })).toBeVisible({ timeout: 15_000 });

    // audits are written on apply, under the APPROVER's authority (ops)
    const list = await auditByAction(context, baseURL, "approval.policy.", OPS.email);
    const createdEv = list.find((e) => e.action === "approval.policy.create" && (e.after as { name?: string })?.name === name);
    expect(createdEv, "policy create event").toBeTruthy();
    expect((createdEv!.after as { version?: number })?.version).toBe(1);
    const pauseEv = list.find((e) => e.action === "approval.policy.pause" && (e.after as { name?: string })?.name === name);
    expect(pauseEv, "policy pause event").toBeTruthy();
    const activateEv = list.find((e) => e.action === "approval.policy.activate" && (e.after as { name?: string })?.name === name);
    expect(activateEv, "policy activate event").toBeTruthy();
    const updateEv = list.find((e) => e.action === "approval.policy.update" && (e.after as { name?: string })?.name === name && (e.before as { version?: number })?.version === 1);
    expect(updateEv, "policy v1→v2 update event").toBeTruthy();
    expect((updateEv!.after as { version?: number })?.version).toBe(2);
    await ops.close();
  });
});
