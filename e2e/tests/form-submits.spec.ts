import { test, expect } from "@playwright/test";
import { URLS } from "./_ports";

// Form-submit smoke — one create-flow per master doctype the app exposes.
// Not exhaustive (critical-flows.spec.ts already covers Customer + Lead)
// — this file adds Supplier, Item, Warehouse, TDS challan, TCS category.
//
// Pattern: navigate → open drawer → fill required fields → assert POST
// returned 2xx → assert the created row shows in the list. API cleanup
// at the end to keep the DB hermetic.

const ACC = URLS.accSvc;
const STOCK = URLS.stockSvc;
const ACC_WEB = URLS.accountingWeb;
const BUY_WEB = URLS.buyingWeb;
const STOCK_WEB = URLS.stockWeb;
const SHELL = URLS.shell;

async function getToken(page: import("@playwright/test").Page): Promise<string> {
  const raw = await page.evaluate(() => localStorage.getItem("lumaara.session"));
  if (!raw) throw new Error("no session");
  return JSON.parse(raw).token as string;
}

test.describe("form submits: master data", () => {
  test("Supplier create → list → delete via API", async ({ page }) => {
    const stamp = Date.now();
    const name = `E2E Supplier ${stamp}`;

    await page.goto(`${BUY_WEB}/buying/suppliers`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /new supplier/i }).click();

    await page.getByLabel(/supplier name/i).first().fill(name);
    const emailInput = page.locator('input[type="email"]').first();
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill(`e2e-supplier-${stamp}@example.com`);
    }

    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/suppliers") && r.request().method() === "POST",
        { timeout: 10_000 },
      ),
      page.getByRole("button", { name: /^(save|create|update)/i }).last().click(),
    ]);
    expect(saveResp.ok(), `save was ${saveResp.status()}`).toBeTruthy();
    await page.reload();
    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 });

    // Cleanup
    const token = await getToken(page);
    const list = await page.request.get(`${ACC}/suppliers`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = (await list.json()) as { id: string; supplierName: string }[];
    const created = rows.find((r) => r.supplierName === name);
    if (created) {
      await page.request.delete(`${ACC}/suppliers/${created.id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    }
  });

  test("Item create → list → delete via API", async ({ page }) => {
    const stamp = Date.now();
    const itemCode = `E2E-ITM-${stamp}`;

    await page.goto(`${ACC_WEB}/accounting/items`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /new item/i }).click();

    // Item code + name are typically both required.
    const codeInput = page.getByLabel(/item code/i).first();
    await codeInput.fill(itemCode);
    const nameInput = page.getByLabel(/item name/i).first();
    await nameInput.fill(`E2E Test Item ${stamp}`);

    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/items") && r.request().method() === "POST",
        { timeout: 10_000 },
      ),
      page.getByRole("button", { name: /^(save|create|update)/i }).last().click(),
    ]);
    expect(saveResp.ok(), `save was ${saveResp.status()}`).toBeTruthy();
    await page.reload();
    await expect(page.getByText(itemCode)).toBeVisible({ timeout: 10_000 });

    const token = await getToken(page);
    const list = await page.request.get(`${ACC}/items`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = (await list.json()) as { id: string; itemCode: string }[];
    const created = rows.find((r) => r.itemCode === itemCode);
    if (created) {
      await page.request.delete(`${ACC}/items/${created.id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    }
  });

  test("Warehouse create → list → delete via API", async ({ page }) => {
    test.setTimeout(60_000);
    const stamp = Date.now();
    const name = `E2E-WH-${stamp}`;

    await page.goto(`${STOCK_WEB}/stock/warehouses`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /new warehouse/i }).click();

    await page.getByLabel(/warehouse name/i).first().fill(name);

    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/warehouses") && r.request().method() === "POST",
        { timeout: 10_000 },
      ),
      page.getByRole("button", { name: /^(save|create|update)/i }).last().click(),
    ]);
    expect(saveResp.ok(), `save was ${saveResp.status()}`).toBeTruthy();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 });

    const token = await getToken(page);
    const list = await page.request.get(`${STOCK}/warehouses`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = (await list.json()) as { id: string; warehouseName: string }[];
    const created = rows.find((r) => r.warehouseName === name);
    if (created) {
      await page.request.delete(`${STOCK}/warehouses/${created.id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    }
  });
});

test.describe("form submits: admin CRUD", () => {
  test("TDS challan admin: create via form → delete via API", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`${SHELL}/admin/reports/tds-challans`, { waitUntil: "domcontentloaded" });

    // Skip if no TDS categories exist (add-form's select is empty).
    const token = await getToken(page);
    const cats = await page.request.get(`${ACC}/tax-withholding-categories`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const catRows = (await cats.json()) as { id: string }[];
    test.skip(catRows.length === 0, "No TDS categories seeded");

    // Open the add-form drawer.
    await page.getByRole("button", { name: /add challan/i }).click();

    // Fill required fields — the form binds to controlled state so the
    // select needs a real category option to be present.
    await page.getByLabel(/category/i).first().selectOption(catRows[0].id);
    await page.getByLabel(/bsr code/i).fill("0510308");
    const stamp = Date.now();
    await page.getByLabel(/challan serial/i).fill(`E2E-${stamp}`);
    await page.getByLabel(/amount paid/i).fill("1000");

    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/tds-challans") && r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      page.getByRole("button", { name: /save challan/i }).click(),
    ]);
    expect(saveResp.ok(), `save was ${saveResp.status()}`).toBeTruthy();

    // Cleanup — the returned body has the id.
    const created = await saveResp.json();
    if (created?.id) {
      await page.request.delete(`${ACC}/tds-challans/${created.id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    }
  });
});

test.describe("form submits: TDS 26Q + TCS 27EQ admin pages render + download", () => {
  test("/admin/reports/tds-26q renders + Download CSV button works", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(`${SHELL}/admin/reports/tds-26q`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /TDS 26Q/i })).toBeVisible({ timeout: 20_000 });

    // Click Download CSV — Playwright intercepts the download event.
    // 30s accounts for cold-compile of the CSV endpoint on accounting-service.
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      page.getByRole("button", { name: /download csv/i }).click(),
    ]);
    const fname = download.suggestedFilename();
    expect(fname).toMatch(/26Q-.*-Q\d\.csv$/);
  });

  test("/admin/reports/tcs-27eq renders + Download CSV button works", async ({
    page,
  }) => {
    await page.goto(`${SHELL}/admin/reports/tcs-27eq`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /TCS 27EQ/i })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 10_000 }),
      page.getByRole("button", { name: /download csv/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/27EQ-.*-Q\d\.csv$/);
  });
});
