// Mobile-viewport sanity: hit a sample of pages at iPhone 14 width and
// assert that body-level horizontal scroll isn't accidental. Explicit
// table-overflow containers (overflow-x-auto on `.table-wrap`) are
// expected to scroll; everything else should fit.
//
// What this doesn't catch:
//   - layout quality (ugly reflows, cramped tap targets)
//   - sticky-header overlap at 320px width
//   - keyboard-opens-and-breaks-viewport on real iOS
// A dedicated mobile UX pass would ship separate specs for those. This
// one is the regression-floor: don't let a new page ship wider than the
// phone it was designed to run on.

import { test, expect, type Page } from "@playwright/test";
import { URLS } from "./_ports";

const SHELL = "http://localhost:4556";
const PORTAL = URLS.portalWeb;
const AUTH = "http://localhost:4001";

const CREDS = { tenantSlug: "demo", email: "demo@lumaara.local", password: "demo1234" };

const MOBILE_VIEWPORT = { width: 390, height: 844 }; // iPhone 14 default

async function seedShellAuth(page: Page): Promise<void> {
  const res = await page.request.post(`${AUTH}/auth/login`, { data: CREDS });
  if (!res.ok()) throw new Error(`login failed ${res.status()}`);
  const body = await res.json();
  await page.goto(`${SHELL}/`);
  await page.evaluate((b) => {
    localStorage.setItem("lumaara.session", JSON.stringify(b));
  }, body);
}

/**
 * Measures the document's horizontal overflow outside of any .table-wrap
 * container. If body scrollWidth > viewport width AND no `.table-wrap` ancestor
 * is responsible, we have an accidental overflow.
 */
async function measureUnexpectedOverflow(page: Page): Promise<{ bodyWidth: number; viewportWidth: number; delta: number }> {
  return page.evaluate(() => {
    const bodyWidth = document.documentElement.scrollWidth;
    const viewportWidth = window.innerWidth;
    return {
      bodyWidth,
      viewportWidth,
      delta: bodyWidth - viewportWidth,
    };
  });
}

const SHELL_PAGES: Array<{ path: string; label: string; auth?: boolean }> = [
  { path: "/login", label: "login", auth: false },
  { path: "/dashboards", label: "dashboards", auth: true },
  { path: "/notifications", label: "notifications", auth: true },
  { path: "/todos", label: "todos", auth: true },
  { path: "/settings/billing", label: "billing", auth: true },
];

const PORTAL_PAGES: Array<{ path: string; label: string }> = [
  { path: "/portal/login", label: "portal login" },
  { path: "/portal/shop", label: "portal shop" },
  { path: "/portal/blog", label: "portal blog" },
];

test.describe("mobile viewport fit (iPhone 14)", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  for (const spec of SHELL_PAGES) {
    test(`shell: ${spec.label}`, async ({ page }) => {
      if (spec.auth) await seedShellAuth(page);
      await page.goto(`${SHELL}${spec.path}`, { waitUntil: "networkidle", timeout: 60_000 });
      await page.waitForTimeout(500); // layout settle
      const m = await measureUnexpectedOverflow(page);
      // 2px tolerance for sub-pixel differences.
      expect(
        m.delta,
        `${spec.label}: body scrollWidth ${m.bodyWidth}px > viewport ${m.viewportWidth}px — content wider than mobile viewport`,
      ).toBeLessThanOrEqual(2);
    });
  }

  for (const spec of PORTAL_PAGES) {
    test(`portal: ${spec.label}`, async ({ page }) => {
      await page.goto(`${PORTAL}${spec.path}`, { waitUntil: "networkidle", timeout: 60_000 });
      await page.waitForTimeout(500);
      const m = await measureUnexpectedOverflow(page);
      expect(
        m.delta,
        `${spec.label}: body ${m.bodyWidth}px > viewport ${m.viewportWidth}px`,
      ).toBeLessThanOrEqual(2);
    });
  }
});
