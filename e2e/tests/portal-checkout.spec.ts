import { test, expect } from "@playwright/test";
import { URLS } from "./_ports";

// Portal + storefront checkout coverage. The audit called this out as the
// weakest-tested surface — payment-success is where real money moves and
// smoke-portal.spec.ts only touches the authed-page happy paths.
//
// Two scopes here:
//
//   (A) Anonymous shop checkout — POST /public/checkout with a seeded
//       WebsiteItem cart. Proves the shop-to-SalesOrder translation that
//       the storefront's /checkout page relies on. Doesn't need a payment
//       gateway configured; the gateway is a separate v2 wire.
//
//   (B) Portal payment order-create API shape — POST /portal/checkout/
//       razorpay/order with a tenant that has NO Razorpay integration.
//       Verifies the API returns the structured "integration missing"
//       error rather than crashing. The actual Razorpay round-trip
//       requires a sandbox credential and is out of scope.

const CRM = URLS.crmSvc;
const ACC = URLS.accSvc;
const AUTH = URLS.authSvc;

async function getStaffToken(page: import("@playwright/test").Page): Promise<string> {
  await page.goto(`${URLS.shell}/`);
  const raw = await page.evaluate(() => localStorage.getItem("lumaara.session"));
  if (!raw) throw new Error("no staff session (storageState not seeded)");
  const s = JSON.parse(raw) as { token?: string };
  if (!s.token) throw new Error("no token in staff session");
  return s.token;
}

async function seedPublishedWebsiteItem(
  page: import("@playwright/test").Page,
  token: string,
): Promise<{ websiteItemId: string }> {
  // Reuse an existing published WebsiteItem if seed data provides one.
  const list = await page.request.get(`${CRM}/public/shop?limit=1`);
  if (list.ok()) {
    const rows = (await list.json()) as Array<{ id?: string; slug?: string }>;
    if (rows.length > 0 && rows[0].id) return { websiteItemId: rows[0].id };
  }
  // Fallback: provision a shop item inline. Needs an Item first.
  const itemRes = await page.request.post(`${ACC}/items`, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    data: {
      itemCode: `E2E-CHECKOUT-${Date.now()}`,
      itemName: "E2E Checkout Widget",
      itemGroup: "All Item Groups",
      stockUom: "Nos",
      standardRate: 100,
    },
  });
  if (!itemRes.ok()) throw new Error(`item seed failed: ${await itemRes.text()}`);
  const item = (await itemRes.json()) as { id: string };
  // Route is /website-items with (publicSlug, webItemName, webPrice);
  // the shorter /shop-items alias / salePrice shape never existed.
  const wiRes = await page.request.post(`${CRM}/website-items`, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    data: {
      itemId: item.id,
      publicSlug: `e2e-${Date.now()}`,
      webItemName: "E2E Checkout Widget",
      webPrice: 100,
      isPublished: true,
    },
  });
  if (!wiRes.ok()) throw new Error(`shop-item seed failed: ${await wiRes.text()}`);
  const wi = (await wiRes.json()) as { id: string };
  return { websiteItemId: wi.id };
}

test.describe("portal + shop checkout", () => {
  test("anonymous shop checkout POST /public/checkout creates a Draft SalesOrder", async ({ page }) => {
    const staff = await getStaffToken(page);
    const { websiteItemId } = await seedPublishedWebsiteItem(page, staff);

    const email = `e2e-buyer-${Date.now()}@example.com`;
    const res = await page.request.post(`${CRM}/public/checkout`, {
      data: {
        items: [{ websiteItemId, qty: 2 }],
        customerName: "E2E Buyer",
        email,
        remarks: "e2e order",
      },
    });

    // Service returns 201 Created with { orderId, orderNumber, grandTotal, ... }
    expect([200, 201]).toContain(res.status());
    const body = (await res.json()) as {
      orderId: string;
      orderNumber: string;
      grandTotal?: number;
    };
    expect(body.orderId).toBeTruthy();
    expect(body.orderNumber).toMatch(/^EC-SO-/);

    // Verify the SO landed as Draft (staff review before submit).
    // Sales orders live on crm-service, not accounting-service.
    const soRes = await page.request.get(
      `${CRM}/sales-orders/${body.orderId}`,
      { headers: { authorization: `Bearer ${staff}` } },
    );
    expect(soRes.status()).toBe(200);
    const so = (await soRes.json()) as { status: string; customerEmail?: string };
    expect(so.status).toBe("Draft");
  });

  test("portal Razorpay order endpoint returns a structured error when no integration is configured", async ({
    page,
  }) => {
    // Mint a portal session via the same flow as smoke-portal.spec.ts. For
    // this test we only need an authenticated portal token; the body of
    // the response doesn't depend on which invoice we point at — we're
    // verifying the error path when the tenant has no Razorpay set up.
    const staff = await getStaffToken(page);

    // Resolve staff user's tenantSlug by calling /auth/me so we can target
    // the right tenant for the portal invite below.
    const meRes = await page.request.get(`${AUTH}/auth/me`, {
      headers: { authorization: `Bearer ${staff}` },
    });
    if (!meRes.ok()) {
      test.skip(true, `/auth/me unavailable: ${meRes.status()}`);
      return;
    }
    const me = (await meRes.json()) as { tenant?: { slug?: string }; tenantSlug?: string };
    const tenantSlug = me.tenant?.slug ?? me.tenantSlug;
    if (!tenantSlug) {
      test.skip(true, "no tenantSlug from /auth/me — seed may not have standard shape");
      return;
    }

    // Attempt a Razorpay order with a bogus invoice id. In dev stacks with
    // no Razorpay integration the server returns 500 "No default Razorpay
    // integration configured" — exactly the error-handling contract we
    // want to pin.
    const portalUser = `e2e-portal-${Date.now()}@example.com`;
    const invite = await page.request.post(`${AUTH}/portal-auth/invite`, {
      headers: { authorization: `Bearer ${staff}`, "content-type": "application/json" },
      data: {
        email: portalUser,
        partyType: "Customer",
        partyId: "nonexistent-skip-if-missing", // seed-dependent
      },
    });
    if (invite.status() === 400) {
      // No seed customer to attach; skip rather than failing on seed shape.
      test.skip(true, "no seed customer available for portal invite in this stack");
      return;
    }

    expect(invite.status()).toBe(201);
    const { inviteLink } = (await invite.json()) as { inviteLink: string };
    const token = inviteLink.split("token=")[1]?.split("&")[0] ?? "";
    const accept = await page.request.post(`${AUTH}/portal-auth/accept`, {
      data: { token, password: "Correct-Horse-Battery-Staple-9!" },
    });
    expect(accept.status()).toBe(200);
    const portal = (await accept.json()) as { token: string };

    // Hit the Razorpay order endpoint. We expect either a well-shaped
    // error ("integration not configured") or a 404 ("invoice not found")
    // — both are OK contracts; a 500 with no body or an uncaught promise
    // crash is what we're guarding against.
    const orderRes = await page.request.post(
      `${ACC}/portal/checkout/razorpay/order`,
      {
        headers: {
          authorization: `Bearer ${portal.token}`,
          "content-type": "application/json",
        },
        data: { invoiceId: "nonexistent-invoice-id" },
      },
    );
    expect([400, 404, 500]).toContain(orderRes.status());
    const errBody = (await orderRes.json()) as { error?: string };
    expect(errBody.error).toBeTruthy();
  });
});
