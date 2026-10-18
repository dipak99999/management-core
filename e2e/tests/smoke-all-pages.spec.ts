import { test, expect } from "@playwright/test";
import pages from "../pages.json";
import { PORTS } from "./_ports";

// pages.json records the HARNESS port for each app (3100-3107). Translate
// to whatever the current runtime layout uses so the smoke suite works
// against DEV too (shell=4556, modules=3001-3007). Keep the harness
// numbers as the canonical identity in the json; map only here.
const HARNESS_TO_RUNTIME: Record<number, string> = {
  3100: PORTS.shell,
  3101: PORTS.accountingWeb,
  3102: PORTS.buyingWeb,
  3103: PORTS.stockWeb,
  3104: PORTS.crmWeb,
  3105: PORTS.hrWeb,
  3106: PORTS.projectsWeb,
  3107: PORTS.portalWeb,
};

// Smoke test every static route as a signed-in staff user.
//
// A "pass" means:
//   1. HTTP response is not a 5xx (server crash)
//   2. Page body has visible text content (rules out a completely blank page
//      or Next's "Application error" boundary)
//   3. No uncaught JS error was thrown into `pageerror`
//
// Console `error` messages are logged but do not fail the test — many
// are React dev-mode warnings (missing keys) or 4xx on optional data fetches.
//
// Portal-web is excluded — those pages need portal-auth, not staff-auth,
// and are covered by a separate suite.

type PageEntry = { app: string; port: number; route: string; dynamic: boolean };
const staticPages = (pages as PageEntry[]).filter(
  (p) => !p.dynamic && p.app !== "portal-web",
);

// Routes that need query params to render meaningfully. Marked here so the
// smoke test just verifies the route exists + doesn't 500, without asserting
// content.
const NEEDS_QUERY_PARAMS = new Set<string>(["/oauth/consent"]);

// Next dev-mode cold-compile of a never-before-visited heavy page (stock
// production plans, quality inspections, …) can take 40-60s. Default 30s
// test timeout is too tight when running against DEV mode's on-demand
// compilation — bump to 60s so first-visit timeouts don't swamp the real
// signal (actual render errors).
test.describe("smoke: every static staff page renders", () => {
  test.setTimeout(60_000);
  for (const p of staticPages) {
    const port = HARNESS_TO_RUNTIME[p.port] ?? String(p.port);
    const url = `http://localhost:${port}${p.route}`;
    test(`${p.app} ${p.route || "/"}`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));

      const resp = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      const status = resp?.status() ?? 0;
      expect(status, `got ${status} at ${url}`).toBeLessThan(500);

      if (!NEEDS_QUERY_PARAMS.has(p.route)) {
        // Wait for hydration + first client-side data fetch. The shell
        // dashboard in particular is fully client-rendered and needs
        // longer than a 400ms blind wait — poll instead.
        await expect
          .poll(async () => (await page.locator("body").innerText()).trim().length, {
            timeout: 10_000,
            intervals: [100, 250, 500, 1000],
          })
          .toBeGreaterThan(3);
        const body = await page.locator("body").innerText();
        expect(body).not.toContain("Application error");
      }

      expect(
        pageErrors,
        `uncaught JS error at ${url}:\n${pageErrors.join("\n")}`,
      ).toEqual([]);
    });
  }
});
