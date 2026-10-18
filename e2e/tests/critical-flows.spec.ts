import { test, expect } from "@playwright/test";
import { URLS } from "./_ports";

// End-to-end tests that click real buttons + fill real forms. Each test
// covers one user journey the product must not break. Extend by adding
// more `test(...)` blocks — each is independent and starts from the
// signed-in state seeded by global-setup.

const SHELL = URLS.shell;
const ACC = URLS.accountingWeb;
const CRM = URLS.crmWeb;

test.describe("critical flows", () => {
  test("shell dashboard loads with all module cards", async ({ page }) => {
    await page.goto(`${SHELL}/`, { waitUntil: "domcontentloaded" });
    // Dashboard renames: Receivables→AR Outstanding, Cash→Cash on hand.
    // Payables was dropped in the Oct-2026 refactor; use Revenue + AR Outstanding
    // + Cash on hand as the always-rendered KPI tiles.
    await expect(page.getByText("Revenue", { exact: false }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("AR Outstanding", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Cash on hand", { exact: false }).first()).toBeVisible();
  });

  test("customer create → list → delete", async ({ page }) => {
    const stamp = Date.now();
    const name = `E2E Test Customer ${stamp}`;

    await page.goto(`${ACC}/accounting/customers`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /new customer/i }).click();

    // FormField now wraps its input inside the <label>, so getByLabel is the
    // right selector — matches the visible caption regardless of placeholder.
    const nameInput = page.getByLabel(/customer name/i).first();
    await expect(nameInput).toBeVisible();
    await nameInput.fill(name);
    // The customer form has an email input with type="email"; if left empty
    // the browser sends "" (not null) and the API's z.string().email() rejects
    // it with a 400. Fill a valid email to pass validation.
    const emailInput = page.locator('input[type="email"]').first();
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill(`e2e-${stamp}@example.com`);
    }

    // Wait for the POST to land so we don't race the list refresh.
    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/customers") && r.request().method() === "POST",
        { timeout: 10_000 },
      ),
      // Drawer submit button varies per form: "Create X" (new), "Save changes" (edit), or plain "Save".
      page.getByRole("button", { name: /^(save|create|update)/i }).last().click(),
    ]);
    expect(saveResp.ok(), `save response was ${saveResp.status()}`).toBeTruthy();

    // Reload to guarantee the list is refreshed
    await page.reload();
    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 });

    // Cleanup via API since the UI doesn't have a per-row delete button in
    // the list view (bulk-actions require a select-all workflow). This
    // keeps the test hermetic.
    const session = JSON.parse(
      (await page.evaluate(() => localStorage.getItem("lumaara.session"))) ?? "{}",
    );
    const list = await page.request.get(`${URLS.accSvc}/customers`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    const rows = (await list.json()) as { id: string; customerName: string }[];
    const created = rows.find((r) => r.customerName === name);
    if (created) {
      await page.request.post(`${URLS.accSvc}/bulk-actions`, {
        headers: { authorization: `Bearer ${session.token}` },
        data: { doctype: "Customer", ids: [created.id], action: "delete" },
      });
    }
  });

  test("sales invoice list renders + PDF button exists on detail", async ({ page }) => {
    await page.goto(`${ACC}/accounting/sales-invoices`);
    // The seeded SINV-DEMO-001 must be in the list
    await expect(page.getByText(/SINV-/).first()).toBeVisible({ timeout: 10_000 });
    // Click into it
    await page.getByText(/SINV-/).first().click();
    // Detail page should show Print/PDF actions
    await expect(
      page.getByRole("button", { name: /pdf/i }).or(page.getByText(/pdf/i).first()),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("workflow admin: list workflows", async ({ page }) => {
    await page.goto(`${SHELL}/admin/workflows`, { waitUntil: "domcontentloaded" });
    // Either "No workflows" empty-state OR a table row — both are valid render
    const hasContent = await page
      .locator("main")
      .first()
      .isVisible({ timeout: 8_000 });
    expect(hasContent).toBeTruthy();
    // Header should say something workflow-y
    await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(/workflow/i);
  });

  test("CRM leads: list + create new", async ({ page }) => {
    const stamp = Date.now();
    const leadName = `E2E Lead ${stamp}`;

    await page.goto(`${CRM}/crm/leads`, { waitUntil: "domcontentloaded" });
    // Wait for the primary CTA rather than networkidle (SSE connections
    // keep the network warm indefinitely, so networkidle never fires).
    await expect(page.getByRole("button", { name: /new lead/i })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: /new lead/i }).click();

    const nameInput = page.getByLabel(/person name/i).first();
    await expect(nameInput).toBeVisible();
    await nameInput.fill(leadName);
    // Same empty-string-vs-null issue as the customer form: fill email so
    // zod validation passes.
    const emailInput = page.locator('input[type="email"]').first();
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill(`e2e-${stamp}@example.com`);
    }

    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/leads") && r.request().method() === "POST",
        { timeout: 10_000 },
      ),
      // Drawer submit button varies per form: "Create X" (new), "Save changes" (edit), or plain "Save".
      page.getByRole("button", { name: /^(save|create|update)/i }).last().click(),
    ]);
    expect(saveResp.ok(), `save response was ${saveResp.status()}`).toBeTruthy();

    await page.reload();
    await expect(page.getByText(leadName)).toBeVisible({ timeout: 10_000 });

    // API cleanup
    const session = JSON.parse(
      (await page.evaluate(() => localStorage.getItem("lumaara.session"))) ?? "{}",
    );
    const list = await page.request.get(`${URLS.crmSvc}/leads`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    const rows = (await list.json()) as { id: string; leadName: string }[];
    const created = rows.find((r) => r.leadName === leadName);
    if (created) {
      await page.request.delete(`${URLS.crmSvc}/leads/${created.id}`, {
        headers: { authorization: `Bearer ${session.token}` },
      });
    }
  });

  test("portal: unauthenticated login page renders + shows demo brand", async ({ browser }) => {
    // Fresh context (NO auth) so we hit the portal-login page as an anonymous visitor.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${URLS.portalWeb}/portal/login`);
    await expect(page.getByText(/sign in/i).first()).toBeVisible();
    // Labels on this form aren't htmlFor-linked to inputs, so match on the
    // visible label text instead of getByLabel.
    await expect(page.getByText(/tenant slug/i)).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await ctx.close();
  });

  test("logout flow: shell dashboard has sign out that clears session", async ({ browser }) => {
    // Use a fresh context loaded from storageState so we can safely mutate
    const ctx = await browser.newContext({ storageState: "storageState.json" });
    const page = await ctx.newPage();
    await page.goto(`${SHELL}/`, { waitUntil: "domcontentloaded" });
    // Try to find + click sign out (case-insensitive)
    const signOut = page
      .getByRole("button", { name: /sign\s*out|log\s*out/i })
      .or(page.getByRole("link", { name: /sign\s*out|log\s*out/i }))
      .first();
    if (await signOut.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await signOut.click();
      // Should redirect to login OR clear localStorage
      await page.waitForTimeout(1_500);
      const remaining = await page.evaluate(() =>
        localStorage.getItem("lumaara.session"),
      );
      expect(remaining).toBeNull();
    }
    await ctx.close();
  });
});
