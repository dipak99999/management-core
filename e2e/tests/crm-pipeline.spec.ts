import { test, expect, APIRequestContext } from "@playwright/test";
import { URLS } from "./_ports";

// End-to-end verification of the Lumaara CRM sales pipeline:
//   Lead → Convert → Customer  (via UI)
//     ↓
//   Quotation → Submit → Convert to Sales Order  (via UI)
//     ↓
//   Sales Order → Submit → Convert to Invoice  (via UI)
//     ↓
//   Sales Invoice exists in accounting-service DB  (API assertion)
//
// The pipeline spans 2 services (crm-service :4104 → accounting-service :4102)
// via pragmatic cross-service DB writes on the convert endpoints, so this test
// is the only thing that actually proves that seam holds. Unit tests on either
// service alone can't.

const SHELL = URLS.shell;
const CRM_WEB = URLS.crmWeb;
const CRM_API = URLS.crmSvc;
const ACC_API = URLS.accSvc;

type Session = { token: string };
type Lead = { id: string; leadName: string; status: string; convertedCustomerId: string | null };
type Item = { id: string; itemCode: string };
type Quotation = { id: string; name: string; status: string; grandTotal: string };
type SalesOrder = { id: string; name: string; status: string; grandTotal: string; invoicedAmount: string };
type SalesInvoice = { id: string; name: string; customerId: string; grandTotal: string; status: string };

async function readSession(page: import("@playwright/test").Page): Promise<Session> {
  // Shell dashboard "load" event can take >60s with cold-compile + many
  // KPI fetches; we only need localStorage, so stop at domcontentloaded.
  await page.goto(`${SHELL}/`, { waitUntil: "domcontentloaded" });
  const raw = await page.evaluate(() => localStorage.getItem("lumaara.session"));
  expect(raw, "no lumaara.session in localStorage — global-setup must run first").toBeTruthy();
  return JSON.parse(raw!) as Session;
}

async function bearer(req: APIRequestContext, session: Session, method: "get" | "post" | "delete", url: string, body?: unknown) {
  const opts = { headers: { authorization: `Bearer ${session.token}` }, data: body };
  const res = await (req as any)[method](url, opts);
  return res;
}

test.describe("CRM sales pipeline", () => {
  test("Lead → Customer → Quotation → Sales Order → Sales Invoice", async ({ page, request }) => {
    test.setTimeout(90_000);

    const stamp = Date.now();
    const leadName = `E2E Pipeline Lead ${stamp}`;
    const itemCode = `E2E-ITEM-${stamp}`;
    const unitRate = 500;
    const qty = 3;
    const expectedGrandTotal = unitRate * qty; // 1500 (no tax template)

    const session = await readSession(page);

    // ---------- Setup: create an Item via API (needed for quote/SO line) ----------
    const itemRes = await bearer(request, session, "post", `${ACC_API}/items`, {
      itemCode,
      itemName: `E2E Pipeline Item ${stamp}`,
      stockUom: "Nos",
      standardRate: unitRate,
      isStockItem: false,
    });
    expect(itemRes.ok(), `item create failed: ${itemRes.status()} ${await itemRes.text()}`).toBeTruthy();
    const item = (await itemRes.json()) as Item;

    // ---------- Setup: create a Lead via API ----------
    const leadRes = await bearer(request, session, "post", `${CRM_API}/leads`, {
      leadName,
      email: `e2e-pipeline-${stamp}@example.com`,
      source: "E2E Test",
      status: "Open",
    });
    expect(leadRes.ok(), `lead create failed: ${leadRes.status()} ${await leadRes.text()}`).toBeTruthy();
    const lead = (await leadRes.json()) as Lead;

    // ---------- UI: convert Lead to Customer ----------
    await page.goto(`${CRM_WEB}/crm/leads/${lead.id}`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(leadName);
    // convert() calls window.confirm() first; auto-accept so the POST fires.
    page.once("dialog", (d) => void d.accept());
    const [convertResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/leads/${lead.id}/convert`) && r.request().method() === "POST",
        { timeout: 15_000 },
      ),
      // The page shows two buttons with this label — a primary (big)
      // and a chip (small). Either triggers the convert flow; .first()
      // picks the primary in DOM order.
      page.getByRole("button", { name: /convert to customer/i }).first().click(),
    ]);
    expect(convertResp.ok(), `lead convert failed: ${convertResp.status()} ${await convertResp.text()}`).toBeTruthy();
    // Detail reloads and shows the converted-customer link
    await expect(page.getByText(/converted/i).first()).toBeVisible({ timeout: 10_000 });

    // Read the customerId from API (the UI populates a link but scraping it is brittle)
    const leadAfter = await (await bearer(request, session, "get", `${CRM_API}/leads/${lead.id}`)).json() as Lead;
    expect(leadAfter.status).toBe("Converted");
    expect(leadAfter.convertedCustomerId, "convert did not link a Customer").toBeTruthy();
    const customerId = leadAfter.convertedCustomerId!;

    // ---------- API: create a Draft Quotation on that Customer ----------
    // Bypassing the quote form UI keeps the test tight — the pipeline transitions
    // are what we're actually verifying, not the quote-form UX (covered elsewhere).
    const quoteCreateRes = await bearer(request, session, "post", `${CRM_API}/quotations`, {
      partyType: "Customer",
      customerId,
      quotationDate: new Date().toISOString(),
      currency: "INR",
      items: [{ itemId: item.id, qty, rate: unitRate }],
    });
    expect(quoteCreateRes.ok(), `quote create failed: ${quoteCreateRes.status()} ${await quoteCreateRes.text()}`).toBeTruthy();
    const quote = (await quoteCreateRes.json()) as Quotation;
    expect(quote.status).toBe("Draft");
    expect(Number(quote.grandTotal)).toBe(expectedGrandTotal);

    // ---------- UI: submit the Quotation ----------
    await page.goto(`${CRM_WEB}/crm/quotations/${quote.id}`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(quote.name);
    const [quoteSubmitResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/quotations/${quote.id}/submit`) && r.request().method() === "POST",
        { timeout: 15_000 },
      ),
      page.getByRole("button", { name: /^submit$/i }).click(),
    ]);
    expect(quoteSubmitResp.ok(), `quote submit failed: ${quoteSubmitResp.status()} ${await quoteSubmitResp.text()}`).toBeTruthy();

    // ---------- UI: convert Quote → Sales Order ----------
    // Handle the confirm-navigation prompt the UI shows on convert (window.confirm/prompt)
    page.on("dialog", (d) => d.accept());
    const [quoteConvertResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/quotations/${quote.id}/convert-to-sales-order`) && r.request().method() === "POST",
        { timeout: 15_000 },
      ),
      page.getByRole("button", { name: /→\s*sales order/i }).click(),
    ]);
    expect(quoteConvertResp.ok(), `quote → SO failed: ${quoteConvertResp.status()} ${await quoteConvertResp.text()}`).toBeTruthy();

    // Grab the new SO id — the convert response body contains it
    const soFromConvert = await quoteConvertResp.json() as { salesOrder: SalesOrder } | SalesOrder;
    const soId = "salesOrder" in soFromConvert ? soFromConvert.salesOrder.id : (soFromConvert as SalesOrder).id;
    expect(soId, "convert response did not return a SO id").toBeTruthy();

    // ---------- UI: submit the Sales Order ----------
    await page.goto(`${CRM_WEB}/crm/sales-orders/${soId}`, { waitUntil: "domcontentloaded" });
    const submitBtn = page.getByRole("button", { name: /^submit$/i });
    await expect(submitBtn).toBeVisible({ timeout: 20_000 });
    const [soSubmitResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/sales-orders/${soId}/submit`) && r.request().method() === "POST",
        { timeout: 15_000 },
      ),
      submitBtn.click(),
    ]);
    expect(soSubmitResp.ok(), `SO submit failed: ${soSubmitResp.status()} ${await soSubmitResp.text()}`).toBeTruthy();

    // ---------- UI: convert SO → Sales Invoice (full remaining) ----------
    const [soInvoiceResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/sales-orders/${soId}/convert-to-invoice`) && r.request().method() === "POST",
        { timeout: 15_000 },
      ),
      page.getByRole("button", { name: /→\s*invoice \(remaining\)/i }).click(),
    ]);
    expect(soInvoiceResp.ok(), `SO → Invoice failed: ${soInvoiceResp.status()} ${await soInvoiceResp.text()}`).toBeTruthy();

    // ---------- Assert the SI landed in accounting-service ----------
    // Response shape: { salesInvoice: si } — see services/crm-service/src/routes/sales-orders.ts convert-to-invoice
    const invoicePayload = await soInvoiceResp.json() as { salesInvoice: SalesInvoice };
    const si = invoicePayload.salesInvoice;
    expect(si, "convert-to-invoice did not return a salesInvoice").toBeTruthy();
    expect(si.customerId).toBe(customerId);
    expect(Number(si.grandTotal)).toBe(expectedGrandTotal);

    // Cross-check that the SI is actually persisted in accounting-service (proves the cross-service DB write)
    const siFetch = await bearer(request, session, "get", `${ACC_API}/sales-invoices/${si.id}`);
    expect(siFetch.ok(), `SI fetch from accounting-service failed: ${siFetch.status()}`).toBeTruthy();
    const siFromAcc = await siFetch.json() as SalesInvoice;
    expect(siFromAcc.customerId).toBe(customerId);

    // ---------- Assert SO is now Fully Billed ----------
    const soFinal = (await (await bearer(request, session, "get", `${CRM_API}/sales-orders/${soId}`)).json()) as SalesOrder;
    expect(soFinal.status).toMatch(/Fully Billed/i);
    expect(Number(soFinal.invoicedAmount)).toBe(expectedGrandTotal);

    // ---------- Cleanup (best-effort — a failed cleanup should not fail the test) ----------
    try {
      // SI cannot be deleted while Submitted; cancel first (best-effort)
      await bearer(request, session, "post", `${ACC_API}/sales-invoices/${si.id}/cancel`, {});
      await bearer(request, session, "delete", `${ACC_API}/sales-invoices/${si.id}`);
      await bearer(request, session, "post", `${CRM_API}/sales-orders/${soId}/cancel`, {});
      await bearer(request, session, "delete", `${CRM_API}/sales-orders/${soId}`);
      await bearer(request, session, "post", `${CRM_API}/quotations/${quote.id}/cancel`, {});
      await bearer(request, session, "delete", `${CRM_API}/quotations/${quote.id}`);
      await bearer(request, session, "delete", `${ACC_API}/customers/${customerId}`);
      await bearer(request, session, "delete", `${CRM_API}/leads/${lead.id}`);
      await bearer(request, session, "delete", `${ACC_API}/items/${item.id}`);
    } catch {
      // Ignore — the test's real assertions have already passed.
    }
  });

  test("Sales Order → Delivery Note (stock branch of the pipeline)", async ({ page, request }) => {
    test.setTimeout(60_000);

    const stamp = Date.now();
    const session = await readSession(page);

    // Setup: item + customer + SO via API, then walk the DN convert via UI
    const item = (await (await bearer(request, session, "post", `${ACC_API}/items`, {
      itemCode: `E2E-DN-ITEM-${stamp}`,
      itemName: `E2E DN Item ${stamp}`,
      stockUom: "Nos",
      standardRate: 250,
      isStockItem: true,
    })).json()) as Item;

    const customer = (await (await bearer(request, session, "post", `${ACC_API}/customers`, {
      customerName: `E2E DN Customer ${stamp}`,
      email: `e2e-dn-${stamp}@example.com`,
    })).json()) as { id: string };

    const so = (await (await bearer(request, session, "post", `${CRM_API}/sales-orders`, {
      customerId: customer.id,
      orderDate: new Date().toISOString(),
      currency: "INR",
      items: [{ itemId: item.id, qty: 2, rate: 250 }],
    })).json()) as SalesOrder;

    await bearer(request, session, "post", `${CRM_API}/sales-orders/${so.id}/submit`, {});

    // The DN convert requires a source warehouse — fetch the first one and pass its id
    const warehouses = (await (await bearer(request, session, "get", `${URLS.stockSvc}/warehouses`)).json()) as { id: string; warehouseName: string }[];
    expect(warehouses.length, "no warehouses seeded — cannot run DN convert").toBeGreaterThan(0);

    const dnConvertRes = await bearer(request, session, "post", `${CRM_API}/sales-orders/${so.id}/convert-to-delivery-note`, {
      warehouseId: warehouses[0].id,
    });
    expect(dnConvertRes.ok(), `SO → DN failed: ${dnConvertRes.status()} ${await dnConvertRes.text()}`).toBeTruthy();

    // Response shape: { deliveryNote: dn } — see services/crm-service/src/routes/sales-orders.ts convert-to-delivery-note
    const dnPayload = await dnConvertRes.json() as { deliveryNote: { id: string; customerId: string; status: string } };
    const dn = dnPayload.deliveryNote;
    expect(dn, "convert-to-DN did not return a deliveryNote").toBeTruthy();
    expect(dn.customerId).toBe(customer.id);
    expect(dn.status).toMatch(/Draft/i);

    // Cross-check that the DN is actually persisted in stock-service (proves the cross-service DB write)
    const dnFetch = await bearer(request, session, "get", `${URLS.stockSvc}/delivery-notes/${dn.id}`);
    expect(dnFetch.ok(), `DN fetch from stock-service failed: ${dnFetch.status()}`).toBeTruthy();

    // Cleanup
    try {
      // stock-service has no DELETE for DNs; skip
      await bearer(request, session, "post", `${CRM_API}/sales-orders/${so.id}/cancel`, {});
      await bearer(request, session, "delete", `${CRM_API}/sales-orders/${so.id}`);
      await bearer(request, session, "delete", `${ACC_API}/customers/${customer.id}`);
      await bearer(request, session, "delete", `${ACC_API}/items/${item.id}`);
    } catch {}
  });
});
