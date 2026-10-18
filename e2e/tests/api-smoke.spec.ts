import { test, expect } from "@playwright/test";
import { URLS } from "./_ports";

// Backend API smoke suite. These tests don't open a browser — they hit the
// accounting-service directly with the storageState session's JWT. Fast
// (~5s total), covers every endpoint added in the design-partner-prep pass
// so an ops-side breaking change gets caught before it reaches production.
//
// Prerequisites: the standard E2E stack must be running (postgres +
// scripts/start-all-services.sh) + seed has populated the demo tenant.

const ACC = URLS.accSvc;
const SHELL = URLS.shell;

async function getToken(page: import("@playwright/test").Page): Promise<string> {
  const raw = await page.evaluate(() => localStorage.getItem("lumaara.session"));
  if (!raw) throw new Error("no session in storageState");
  const s = JSON.parse(raw) as { token?: string };
  if (!s.token) throw new Error("no token in session");
  return s.token;
}

test.describe("API smoke: TDS/TCS reports", () => {
  test("GET /reports/tds-26q returns a well-shaped JSON dataset", async ({ page }) => {
    await page.goto(`${SHELL}/`);
    const token = await getToken(page);
    const r = await page.request.get(`${ACC}/reports/tds-26q?date=2026-08-15`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status(), await r.text()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty("quarter");
    expect(body).toHaveProperty("fyLabel");
    expect(body).toHaveProperty("rows");
    expect(body).toHaveProperty("totals");
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.totals).toHaveProperty("totalTdsAmount");
  });

  test("GET /reports/tds-26q?format=csv returns text/csv with NSDL columns", async ({ page }) => {
    await page.goto(`${SHELL}/`);
    const token = await getToken(page);
    const r = await page.request.get(
      `${ACC}/reports/tds-26q?date=2026-08-15&format=csv`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("text/csv");
    const body = await r.text();
    // Header row must contain the CA-facing column names
    expect(body).toContain("Section");
    expect(body).toContain("DeducteeName");
    expect(body).toContain("PAN");
    expect(body).toContain("TotalTDSAmount");
  });

  test("GET /reports/tcs-27eq returns TCS dataset", async ({ page }) => {
    await page.goto(`${SHELL}/`);
    const token = await getToken(page);
    const r = await page.request.get(`${ACC}/reports/tcs-27eq?date=2026-08-15`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty("quarter");
    expect(body.totals).toHaveProperty("totalTcsAmount");
  });

  test("GET /reports/tds-monthly-due returns FY breakdown", async ({ page }) => {
    await page.goto(`${SHELL}/`);
    const token = await getToken(page);
    const r = await page.request.get(
      `${ACC}/reports/tds-monthly-due?date=2026-08-15`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty("rows");
    expect(Array.isArray(body.rows)).toBe(true);
  });

  test("GET /reports/tds-26q/quarter-of returns quarter metadata", async ({ page }) => {
    await page.goto(`${SHELL}/`);
    const token = await getToken(page);
    const r = await page.request.get(
      `${ACC}/reports/tds-26q/quarter-of?date=2026-08-15`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.quarter).toBe(2);
    expect(body.fyLabel).toBe("2026-27");
  });

  test("bad date on /reports/tds-26q returns 400", async ({ page }) => {
    await page.goto(`${SHELL}/`);
    const token = await getToken(page);
    const r = await page.request.get(
      `${ACC}/reports/tds-26q?date=not-a-date`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(r.status()).toBe(400);
  });
});

test.describe("API smoke: TDS challans CRUD", () => {
  let createdId: string | null = null;
  let categoryId: string | null = null;

  test.beforeAll(async ({ browser }) => {
    // Reserve a category on first use; we'll create a fresh one if none exist.
    const ctx = await browser.newContext({ storageState: "storageState.json" });
    const page = await ctx.newPage();
    await page.goto(`${SHELL}/`, { waitUntil: "domcontentloaded" });
    const token = await getToken(page);
    const cats = await page.request.get(`${ACC}/tax-withholding-categories`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = (await cats.json()) as { id: string }[];
    if (rows.length > 0) {
      categoryId = rows[0].id;
    } else {
      // Seed one so downstream TDS challan tests don't skip.
      const created = await page.request.post(`${ACC}/tax-withholding-categories`, {
        headers: { authorization: `Bearer ${token}` },
        data: {
          categoryName: `E2E-TDS-${Date.now()}`,
          rate: 10,
          threshold: 0,
          sectionCode: "194J",
        },
      });
      if (created.ok()) {
        categoryId = (await created.json()).id;
      }
    }
    await ctx.close();
  });

  test("GET /tds-challans (empty or has rows)", async ({ page }) => {
    await page.goto(`${SHELL}/`);
    const token = await getToken(page);
    const r = await page.request.get(`${ACC}/tds-challans`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status()).toBe(200);
    expect(Array.isArray(await r.json())).toBe(true);
  });

  test("POST /tds-challans with valid data returns 201", async ({ page }) => {
    test.skip(!categoryId, "No TDS category seeded — skipping challan create test");
    await page.goto(`${SHELL}/`);
    const token = await getToken(page);
    const stamp = Date.now();
    const r = await page.request.post(`${ACC}/tds-challans`, {
      headers: { authorization: `Bearer ${token}` },
      data: {
        categoryId,
        bsrCode: "0510308",
        challanSerialNo: `TEST-${stamp}`,
        paidDate: new Date().toISOString(),
        amountPaid: 1000,
      },
    });
    expect(r.status(), await r.text()).toBe(201);
    const body = await r.json();
    expect(body.id).toBeTruthy();
    createdId = body.id;
  });

  test("POST /tds-challans with invalid BSR returns 400", async ({ page }) => {
    test.skip(!categoryId, "No TDS category seeded");
    await page.goto(`${SHELL}/`);
    const token = await getToken(page);
    const r = await page.request.post(`${ACC}/tds-challans`, {
      headers: { authorization: `Bearer ${token}` },
      data: {
        categoryId,
        bsrCode: "not-7-digits",
        challanSerialNo: "X",
        paidDate: new Date().toISOString(),
        amountPaid: 100,
      },
    });
    expect(r.status()).toBe(400);
  });

  test("DELETE /tds-challans/:id cleans up", async ({ page }) => {
    test.skip(!createdId, "No challan created — skipping delete test");
    await page.goto(`${SHELL}/`);
    const token = await getToken(page);
    const r = await page.request.delete(`${ACC}/tds-challans/${createdId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status()).toBe(204);
  });
});

test.describe("API smoke: tax-collection-categories CRUD", () => {
  test("GET /tax-collection-categories returns array", async ({ page }) => {
    await page.goto(`${SHELL}/`);
    const token = await getToken(page);
    const r = await page.request.get(`${ACC}/tax-collection-categories`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status()).toBe(200);
    expect(Array.isArray(await r.json())).toBe(true);
  });
});

test.describe("API smoke: backups + verification", () => {
  test("GET /backups includes lastVerify field per row", async ({ page }) => {
    await page.goto(`${SHELL}/`);
    const token = await getToken(page);
    const r = await page.request.get(`${ACC}/backups`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status()).toBe(200);
    const rows = (await r.json()) as { lastVerify: unknown }[];
    // Every row should have the field, even if null
    for (const row of rows) {
      expect(row).toHaveProperty("lastVerify");
    }
  });

  test("POST /backups/:id/verify on a non-existent job returns 404", async ({ page }) => {
    await page.goto(`${SHELL}/`);
    const token = await getToken(page);
    const r = await page.request.post(
      `${ACC}/backups/non-existent-id/verify`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(r.status()).toBe(404);
  });
});

test.describe("API smoke: e-invoice IRN", () => {
  test("POST /sales-invoices/:id/einvoice/generate on non-existent SI returns 404 or error body", async ({
    page,
  }) => {
    await page.goto(`${SHELL}/`);
    const token = await getToken(page);
    const r = await page.request.post(
      `${ACC}/sales-invoices/nope-does-not-exist/einvoice/generate`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    // Route returns a JSON error body — status is 400/404, not 500.
    expect(r.status(), await r.text()).toBeLessThan(500);
  });
});
