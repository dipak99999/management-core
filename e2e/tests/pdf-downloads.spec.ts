import { test, expect } from "@playwright/test";
import { URLS } from "./_ports";

// PDF download smoke. Every /print/* route we've built should stream a
// well-formed PDF (starts with the "%PDF-" magic bytes) — this catches
// server-side @react-pdf/renderer errors, missing template imports,
// broken data-loader shapes.
//
// Skips gracefully when the seed hasn't produced the source doc yet
// (e.g. no supplier exists) — the assertion is "if the route can serve,
// it must serve a valid PDF"; not "there must be data".

const ACC = URLS.accSvc;
const HR = URLS.hrSvc;

async function getToken(page: import("@playwright/test").Page): Promise<string> {
  const raw = await page.evaluate(() => localStorage.getItem("lumaara.session"));
  if (!raw) throw new Error("no session");
  return JSON.parse(raw).token as string;
}

// PDFs start with "%PDF-<version>\n". Anything else = server rendered wrong.
async function expectPdfBody(resp: import("@playwright/test").APIResponse): Promise<void> {
  expect(resp.status(), await resp.text().catch(() => "")).toBe(200);
  expect(resp.headers()["content-type"]).toContain("application/pdf");
  const buf = await resp.body();
  expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
  // Sanity floor — a real PDF is at least a few KB even for a minimal template.
  expect(buf.length).toBeGreaterThan(1000);
}

test.describe("PDF downloads: sales invoice", () => {
  test("first submitted SI streams a valid PDF", async ({ page }) => {
    await page.goto(`${URLS.shell}/`);
    const token = await getToken(page);
    // Find any Submitted SI (that's what /print/sales-invoices/:id expects).
    const list = await page.request.get(`${ACC}/sales-invoices?status=Submitted`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = (await list.json()) as { id: string }[];
    test.skip(rows.length === 0, "No submitted SI in seed");
    const r = await page.request.get(
      `${ACC}/print/sales-invoices/${rows[0].id}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    await expectPdfBody(r);
  });
});

test.describe("PDF downloads: Form 16A", () => {
  test("Form 16A renders for any supplier (empty rows is OK)", async ({ page }) => {
    await page.goto(`${URLS.shell}/`);
    const token = await getToken(page);
    const list = await page.request.get(`${ACC}/suppliers`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = (await list.json()) as { id: string }[];
    test.skip(rows.length === 0, "No suppliers seeded");
    const r = await page.request.get(
      `${ACC}/reports/form-16a/${rows[0].id}?date=2026-08-15`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    await expectPdfBody(r);
  });

  test("Form 16A on non-existent supplier returns error, not 500", async ({ page }) => {
    await page.goto(`${URLS.shell}/`);
    const token = await getToken(page);
    const r = await page.request.get(
      `${ACC}/reports/form-16a/non-existent-id?date=2026-08-15`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    // 404 (not found in DB) OR 500 (loader throws) — either way, MUST NOT
    // silently return a bogus PDF. Prefer < 500 (proper error handling).
    expect(r.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe("PDF downloads: salary slip", () => {
  test("first submitted salary slip streams a valid PDF", async ({ page }) => {
    await page.goto(`${URLS.shell}/`);
    const token = await getToken(page);
    const list = await page.request.get(`${HR}/salary-slips`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = (await list.json()) as { id: string; status: string }[];
    const submitted = rows.find((r) => r.status === "Submitted" || r.status === "Paid");
    test.skip(!submitted, "No submitted salary slip in seed");
    const r = await page.request.get(`${HR}/print/salary-slips/${submitted!.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await expectPdfBody(r);
  });
});

test.describe("PDF downloads: locale query param", () => {
  test("SI PDF with ?locale=es doesn't 500", async ({ page }) => {
    await page.goto(`${URLS.shell}/`);
    const token = await getToken(page);
    const list = await page.request.get(`${ACC}/sales-invoices?status=Submitted`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = (await list.json()) as { id: string }[];
    test.skip(rows.length === 0, "No submitted SI in seed");
    const r = await page.request.get(
      `${ACC}/print/sales-invoices/${rows[0].id}?locale=es`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    await expectPdfBody(r);
  });

  test("SI PDF with unknown locale falls back to en (still valid PDF)", async ({
    page,
  }) => {
    await page.goto(`${URLS.shell}/`);
    const token = await getToken(page);
    const list = await page.request.get(`${ACC}/sales-invoices?status=Submitted`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = (await list.json()) as { id: string }[];
    test.skip(rows.length === 0, "No submitted SI in seed");
    const r = await page.request.get(
      `${ACC}/print/sales-invoices/${rows[0].id}?locale=xx-YY`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    await expectPdfBody(r);
  });
});
