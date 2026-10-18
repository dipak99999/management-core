import { test, expect, request as pwRequest } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Smoke every link in the shell's sidebar. Passes when:
//   1. HTTP < 500
//   2. No `pageerror` (uncaught runtime error like "PrismaClient is unable
//      to run in this browser environment")
//   3. No failed network requests other than Next dev / HMR chatter
//   4. No "Failed to fetch" / NetworkError console messages
//
// The link list is auto-derived from apps/shell/components/shell-nav.ts so
// this test always covers the current sidebar without duplicating URLs.
//
// The auth login rate-limits at 8/15min, so we log in ONCE at file load and
// reuse the JWT across every test.

const SHELL = process.env.SHELL_URL ?? "http://localhost:4556";
const ADMIN = { tenantSlug: "demo", email: "demo@lumaara.local", password: "demo1234" };

let SESSION: { token: string } & Record<string, unknown>;

function extractLinksFromNav(): string[] {
  // The hrefs live in shell-nav-grouped.ts after the Oct-2026 refactor.
  // shell-nav.ts now only re-exports FULL_NAV, no literal href strings.
  const navPath = resolve(
    __dirname,
    "../../apps/shell/components/shell-nav-grouped.ts",
  );
  const src = readFileSync(navPath, "utf8");
  // Match every `href: "..."` value in the file.
  const matches = src.matchAll(/href:\s*"(\/[^"]+)"/g);
  const links = new Set<string>();
  for (const m of matches) links.add(m[1]);
  return [...links].sort();
}

const LINKS = extractLinksFromNav();

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext();
  const res = await ctx.post(`${SHELL}/api/auth-svc/auth/login`, { data: ADMIN });
  if (!res.ok()) throw new Error(`login failed: ${res.status()} ${await res.text()}`);
  SESSION = await res.json();
  await ctx.dispose();
});

test.beforeEach(async ({ page }) => {
  // Every link in SHELL_NAV points at a shell URL. The shell rewrites
  // module routes (/accounting/*, /hr/* …) to the module apps server-side
  // but the browser stays on the shell origin, so a single localStorage
  // seed on the shell origin covers every link in the suite.
  //
  // Earlier versions of this file iterated 3001-3006 to seed cross-origin
  // localStorage too — that caused flaky `net::ERR_ABORTED` failures when
  // the subsequent same-origin navigation raced the prior cross-origin
  // one. The sidebar nav doesn't hit module origins directly, so dropping
  // the iteration eliminates the race without reducing coverage.
  await page.goto(`${SHELL}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((session) => {
    localStorage.setItem("lumaara.session", JSON.stringify(session));
  }, SESSION);
});

// Next dev-mode cold-compile of a never-before-visited page can take 20+
// seconds. The default 30s test timeout + beforeEach login (12-15s) leaves
// too little margin, which caused ~10 pages to time out even though they
// render fine. 60s is the practical minimum when running against DEV mode.
test.describe("sidebar links render without runtime + fetch errors", () => {
  test.setTimeout(90_000);
  for (const path of LINKS) {
    test(`GET ${path}`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));

      const failedFetches: string[] = [];
      page.on("requestfailed", (req) => {
        const url = req.url();
        if (url.includes("/_next/") || url.includes("nextjs.org")) return;
        // Server-Sent Events get ERR_ABORTED every time the test navigates
        // away — that's just the EventSource closing. useRealtime
        // (packages/web-ui/src/realtime.ts) also reconnects on error, so
        // each visit emits several of these. Not a bug; filter them out.
        const err = req.failure()?.errorText ?? "";
        if (url.includes("/stream?channel=") && err.includes("ERR_ABORTED")) return;
        failedFetches.push(
          `${req.method()} ${url} — ${err || "unknown"}`,
        );
      });

      const failedFetchMsgs: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (text.includes("Failed to fetch") || text.includes("NetworkError")) {
          failedFetchMsgs.push(text);
        }
      });

      const url = `${SHELL}${path}`;
      const resp = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      const status = resp?.status() ?? 0;
      expect(status, `HTTP ${status} at ${path}`).toBeLessThan(500);

      await page.waitForTimeout(2000);

      expect(
        pageErrors,
        `runtime errors on ${path}:\n${pageErrors.join("\n")}`,
      ).toHaveLength(0);

      expect(
        failedFetches,
        `failed fetches on ${path}:\n${failedFetches.join("\n")}`,
      ).toHaveLength(0);

      expect(
        failedFetchMsgs,
        `"Failed to fetch" console errors on ${path}:\n${failedFetchMsgs.join("\n")}`,
      ).toHaveLength(0);
    });
  }
});
