import { test, expect } from "@playwright/test";
import { URLS } from "./_ports";

// Portal-web smoke suite. Two flavors:
//   PUBLIC: /portal/login, /portal/accept-invite, /portal/forgot-password —
//     these render without a session and get a plain smoke test.
//   AUTHED: everything else — needs a portal JWT. We provision a portal
//     user + customer inline (idempotent) and log in via /portal-auth/login.
//
// This suite is standalone (no shared storageState) so we can control the
// per-test session precisely.

const PORTAL = URLS.portalWeb;
const AUTH_API = URLS.authSvc;

const PUBLIC_ROUTES = [
  "/portal/login",
  "/portal/accept-invite",
  "/portal/forgot-password",
];

const AUTHED_ROUTES = [
  "/portal",              // dashboard
  "/portal/invoices",
  "/portal/statement",
  "/portal/quotations",
  "/portal/purchase-orders",
  "/portal/tickets",
  "/portal/settings",
  "/portal/dsr",
];

// Provision (idempotently) a portal user tied to a demo Customer, then log
// them in via the portal-auth endpoint. Returns the resulting portal session
// that we seed into localStorage before hitting authed pages.
//
// Product flow is invite → accept-with-password. Follow it exactly:
//   1. Staff-login (to authenticate the invite call)
//   2. Try portal-login fast path (user might already exist w/ password set)
//   3. POST /portal-auth/invite → returns `{ inviteLink: ".../accept-invite?token=X" }`
//   4. Extract the token, POST /portal-auth/accept with { token, password }
async function ensurePortalSession(
  request: import("@playwright/test").APIRequestContext,
): Promise<{ token: string; user: unknown }> {
  const portalEmail = "portal-demo@lumaara.local";
  // Must satisfy the auth-service complexity rules (upper + lower + digit).
  const portalPassword = "PortalPass1234";

  // Fast path: user already exists with password set.
  const loginTry = await request.post(`${AUTH_API}/portal-auth/login`, {
    data: { tenantSlug: "demo", email: portalEmail, password: portalPassword },
  });
  if (loginTry.ok()) return await loginTry.json();

  // Slow path: staff-authenticate, invite, accept.
  const staff = await request.post(`${AUTH_API}/auth/login`, {
    data: { tenantSlug: "demo", email: "demo@lumaara.local", password: "demo1234" },
  });
  const staffToken = (await staff.json()).token as string;
  const staffHeaders = { authorization: `Bearer ${staffToken}` };

  const custs = await request.get(`${URLS.accSvc}/customers`, {
    headers: staffHeaders,
  });
  const rows = (await custs.json()) as { id: string; customerName: string }[];
  const customer =
    rows.find((r) => r.customerName === "Acme Corp") ?? rows[0] ?? null;
  if (!customer) throw new Error("no customer to attach a portal user to");

  // Invite can take 10-15s if SMTP is configured (sends the invite email).
  // Default request timeout is 8s — bump explicitly.
  const invite = await request.post(`${AUTH_API}/portal-auth/invite`, {
    headers: staffHeaders,
    data: {
      email: portalEmail,
      partyType: "Customer",
      partyId: customer.id,
      displayName: "Portal Demo",
    },
    timeout: 30_000,
  });
  if (!invite.ok()) {
    throw new Error(`invite failed: ${invite.status()} ${await invite.text()}`);
  }
  const { inviteLink } = (await invite.json()) as { inviteLink: string };
  const token = new URL(inviteLink).searchParams.get("token");
  if (!token) throw new Error(`no token in invite link: ${inviteLink}`);

  const accept = await request.post(`${AUTH_API}/portal-auth/accept`, {
    data: { token, password: portalPassword },
    timeout: 30_000,
  });
  if (!accept.ok()) {
    throw new Error(`accept failed: ${accept.status()} ${await accept.text()}`);
  }
  return await accept.json();
}

test.describe.configure({ mode: "serial" });

test.describe("portal smoke (public)", () => {
  test.setTimeout(60_000);
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of PUBLIC_ROUTES) {
    test(`unauthed ${route} renders`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      const resp = await page.goto(`${PORTAL}${route}`, { waitUntil: "domcontentloaded" });
      expect(resp?.status()).toBeLessThan(500);
      await page.waitForTimeout(300);
      const body = await page.locator("body").innerText();
      expect(body.trim().length).toBeGreaterThan(3);
      expect(pageErrors).toEqual([]);
    });
  }
});

test.describe("portal smoke (authed)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  let session: { token: string; user: unknown } | null = null;

  test.beforeAll(async ({ request }) => {
    session = await ensurePortalSession(request);
  });

  for (const route of AUTHED_ROUTES) {
    test(`authed ${route} renders`, async ({ page }) => {
      if (!session) throw new Error("no portal session");
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));

      // Seed the portal session into localStorage on the portal-web origin,
      // then navigate to the target route.
      await page.goto(`${PORTAL}/portal/login`);
      await page.evaluate((s) => {
        localStorage.setItem("lumaara.portal", JSON.stringify(s));
      }, session);
      await page.goto(`${PORTAL}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);

      const body = await page.locator("body").innerText();
      expect(body.trim().length).toBeGreaterThan(3);
      expect(body).not.toContain("Application error");
      expect(pageErrors).toEqual([]);
    });
  }
});
