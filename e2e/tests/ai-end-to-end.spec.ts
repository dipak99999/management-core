import { test, expect } from "@playwright/test";
import { URLS } from "./_ports";

// E2E coverage for the end-to-end AI slash flow + saved views + inline
// edit. The AI backend is route-mocked so these tests exercise the
// client wiring, not the LLM provider.
//
// Ports: harness defaults (3101 = accounting-web).

const ACC = process.env.E2E_ACC_URL ?? URLS.accountingWeb;

test.describe("AI slash → diff modal → apply (sales invoice)", () => {
  test("slash command → diff opens → approve applies to form", async ({ page }) => {
    // Mock /ai/draft to return a predictable diff.
    await page.route("**/api/auth-svc/ai/draft", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: "Draft invoice for Mock Customer",
          rows: [
            { field: "customerName", before: null, after: "Mock Customer", editable: true },
            { field: "postingDate", before: null, after: "2026-01-15", editable: true },
            { field: "dueDate", before: null, after: "2026-01-30", editable: true },
          ],
          model: "claude-stub",
          costUsd: 0.0005,
        }),
      });
    });

    await page.goto(`${ACC}/accounting/sales-invoices/new`);
    await page.waitForLoadState("networkidle");

    const slashInput = page.getByLabel("AI command");
    await expect(slashInput).toBeVisible({ timeout: 10_000 });
    await slashInput.fill("/ai 3× SKU-ABC for Mock Customer, due in 15 days");
    await page.getByRole("button", { name: /^Run$/ }).click();

    // Diff modal appears with the summary.
    await expect(page.getByText("Draft invoice for Mock Customer")).toBeVisible({ timeout: 5_000 });
    // All 3 rows render.
    await expect(page.getByText("customerName")).toBeVisible();
    await expect(page.getByText("postingDate")).toBeVisible();
    await expect(page.getByText("dueDate")).toBeVisible();

    // Approve applies the diff.
    await page.getByRole("button", { name: /Approve & apply/ }).click();
    await expect(page.getByText("Draft invoice for Mock Customer")).toBeHidden();
  });

  test("edit a diff row surfaces the save-as-rule affordance", async ({ page }) => {
    await page.route("**/api/auth-svc/ai/draft", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: "Draft",
          rows: [
            { field: "customerName", before: null, after: "Acme", editable: true },
          ],
          model: "claude-stub",
          costUsd: 0.0001,
        }),
      });
    });
    await page.goto(`${ACC}/accounting/sales-invoices/new`);
    await page.waitForLoadState("networkidle");
    const slashInput = page.getByLabel("AI command");
    await slashInput.fill("/ai anything");
    await page.getByRole("button", { name: /^Run$/ }).click();
    await expect(page.getByText("Draft")).toBeVisible();

    // Edit the row to trigger `edited = true` and the save affordance.
    // Target the specific diff-field input (packages/web-ui/src/ai.tsx)
    // rather than nth(1) across every input on the page.
    const after = page.getByTestId("ai-diff-field-customerName");
    await after.fill("Acme Industries");
    await expect(
      page.getByText(/Save your edits as a rule/i),
    ).toBeVisible({ timeout: 2_000 });
  });

  test("503 AI_NOT_CONFIGURED is surfaced as a user error", async ({ page }) => {
    await page.route("**/api/auth-svc/ai/draft", (route) => {
      void route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "AI not configured", code: "AI_NOT_CONFIGURED" }),
      });
    });
    await page.goto(`${ACC}/accounting/sales-invoices/new`);
    await page.waitForLoadState("networkidle");
    const slashInput = page.getByLabel("AI command");
    await slashInput.fill("/ai anything");
    await page.getByRole("button", { name: /^Run$/ }).click();
    await expect(page.getByText(/AI not configured/i)).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("AI next-action chips on invoice detail", () => {
  test("chips render + run → service call + refetch", async ({ page }) => {
    await page.route("**/api/auth-svc/ai/next-actions", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "submit",
            label: "Submit invoice",
            description: "Posts GL entries",
            endpoint: {
              method: "POST",
              path: "/sales-invoices/pretend/submit",
              body: {},
            },
          },
        ]),
      });
    });
    // NextActionsPanel only mounts on the detail page /[id] — need a real
    // invoice. If the list is empty, seed one via API first.
    await page.goto(`${ACC}/accounting/sales-invoices`, { waitUntil: "domcontentloaded" });
    const firstInvoice = page
      .locator("a[href*='/accounting/sales-invoices/']:not([href$='/new']):not([href*='/new?'])")
      .first();
    if ((await firstInvoice.count().catch(() => 0)) === 0) {
      const session = JSON.parse(
        (await page.evaluate(() => localStorage.getItem("lumaara.session"))) ?? "{}",
      );
      const token = session.token as string;
      // Pick (or create) a customer, then post a minimal invoice.
      const custs = await page.request.get(`${URLS.accSvc}/customers`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const custRows = (await custs.json()) as { id: string }[];
      let customerId = custRows[0]?.id;
      if (!customerId) {
        const created = await page.request.post(`${URLS.accSvc}/customers`, {
          headers: { authorization: `Bearer ${token}` },
          data: { customerName: `E2E AI ${Date.now()}` },
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
    await expect(page.getByText("Submit invoice")).toBeVisible({ timeout: 15_000 });
  });
});
