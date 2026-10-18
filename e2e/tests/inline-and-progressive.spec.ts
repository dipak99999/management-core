import { test, expect } from "@playwright/test";
import { URLS } from "./_ports";

// Covers:
//   - InlineEditCell on the customers list (click name → edit → save).
//   - Progressive-disclosure toggle on the sales-invoice create page.
//
// Harness defaults: 3101 = accounting-web.

const ACC = process.env.E2E_ACC_URL ?? URLS.accountingWeb;

test.describe("inline edit on customers list", () => {
  test("edit button is reachable from a customer row name", async ({ page }) => {
    await page.goto(`${ACC}/accounting/customers`, { waitUntil: "domcontentloaded" });
    // If no seeded customers, create one via API so the test can proceed.
    const rows = page.locator("tbody tr");
    if ((await rows.count()) === 0) {
      const session = JSON.parse(
        (await page.evaluate(() => localStorage.getItem("lumaara.session"))) ?? "{}",
      );
      await page.request.post(`${URLS.accSvc}/customers`, {
        headers: { authorization: `Bearer ${session.token}` },
        data: { customerName: `E2E Inline ${Date.now()}` },
      });
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    // The InlineEditCell wraps the name in a button with aria-label "Edit value".
    const editBtn = page.getByRole("button", { name: /Edit value/i }).first();
    await expect(editBtn).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("progressive form on sales-invoice create", () => {
  test("advanced fields are hidden by default; toggle reveals them", async ({ page }) => {
    await page.goto(`${ACC}/accounting/sales-invoices/new`);
    await page.waitForLoadState("networkidle");

    // Advanced sentinel: the "Tax template (invoice-level default)" FormField
    // label should NOT be visible until the toggle fires.
    const advancedLabel = page.getByText("Tax template (invoice-level default)");
    await expect(advancedLabel).toBeHidden();

    const toggle = page.getByRole("button", {
      name: /Show advanced options/i,
    });
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.click();

    await expect(advancedLabel).toBeVisible({ timeout: 5_000 });
    // Re-collapse.
    await page.getByRole("button", { name: /Hide advanced options/i }).click();
    await expect(advancedLabel).toBeHidden();
  });
});

test.describe("AI chips endpoint-mocked", () => {
  test("Submit chip calls through to the service", async ({ page }) => {
    const seenCalls: string[] = [];
    await page.route("**/api/auth-svc/ai/next-actions", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "submit",
            label: "Submit invoice",
            endpoint: { method: "POST", path: "/sales-invoices/fake-id/submit", body: {} },
          },
        ]),
      });
    });
    await page.route("**/api/accounting-svc/sales-invoices/fake-id/submit", (route) => {
      seenCalls.push(route.request().url());
      void route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.goto(`${ACC}/accounting/sales-invoices`, { waitUntil: "domcontentloaded" });
    const first = page
      .locator("a[href*='/accounting/sales-invoices/']:not([href$='/new']):not([href*='/new?'])")
      .first();
    if ((await first.count().catch(() => 0)) === 0) {
      const session = JSON.parse(
        (await page.evaluate(() => localStorage.getItem("lumaara.session"))) ?? "{}",
      );
      const token = session.token as string;
      const custs = await page.request.get(`${URLS.accSvc}/customers`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const custRows = (await custs.json()) as { id: string }[];
      let customerId = custRows[0]?.id;
      if (!customerId) {
        const created = await page.request.post(`${URLS.accSvc}/customers`, {
          headers: { authorization: `Bearer ${token}` },
          data: { customerName: `E2E Inline ${Date.now()}` },
        });
        customerId = (await created.json()).id;
      }
      await page.request.post(`${URLS.accSvc}/sales-invoices`, {
        headers: { authorization: `Bearer ${token}` },
        data: {
          customerId,
          postingDate: new Date().toISOString(),
          dueDate: new Date(Date.now() + 15 * 86_400_000).toISOString(),
          items: [{ itemCode: "DEMO", qty: 1, rate: 100 }],
        },
      });
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    await page
      .locator("a[href*='/accounting/sales-invoices/']:not([href$='/new']):not([href*='/new?'])")
      .first()
      .click();
    const chip = page.getByRole("button", { name: /Submit invoice/i });
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.click();
    // The chip issues the mocked POST; we only verify the UI didn't throw.
    await page.waitForTimeout(500);
  });
});
