import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";

// Shared config for the lumaara browser test suite.
//
// Default assumption: the e2e test harness (services on 4101-4109, frontends
// on 3100-3107) is up — those are the ports CI boots in `scripts/*`. On a
// laptop where only the regular `pnpm dev` is running (shell on 4556, auth
// on 4001), the config auto-detects and switches the baseURL + auth URL so
// `pnpm --filter @lumaara/e2e test` just works. Explicit overrides:
//   E2E_BASE_URL   — shell/frontend base, e.g. http://localhost:4556
//   E2E_AUTH_URL   — auth service, e.g. http://localhost:4001
//
// NOTE: individual test files still hardcode harness ports for the module
// apps (3101-3106, 4102-4105). Running the full suite against pnpm-dev
// requires those too; this auto-detection unblocks the shell-only tests
// (smoke-all-pages, sidebar-links, critical-flows).
const HARNESS_SHELL = "http://localhost:3100";
const DEV_SHELL = "http://localhost:4556";
const HARNESS_AUTH = "http://localhost:4101";
const DEV_AUTH = "http://localhost:4001";

// Sync port probe — top-level `await` would compile cleanly as ESM but the
// test suite (and tsconfig) is CJS, so we shell out to bash's /dev/tcp.
// Works on darwin + linux (CI); irrelevant on Windows (we never run e2e there).
function portOpenSync(port: number): boolean {
  try {
    execSync(`bash -c 'exec 3<>/dev/tcp/localhost/${port}' 2>/dev/null`, {
      stdio: "ignore",
      timeout: 500,
    });
    return true;
  } catch {
    return false;
  }
}

const baseURL = process.env.E2E_BASE_URL
  ?? (portOpenSync(3100) ? HARNESS_SHELL : DEV_SHELL);
const authURL = process.env.E2E_AUTH_URL
  ?? (portOpenSync(4101) ? HARNESS_AUTH : DEV_AUTH);
process.env.E2E_AUTH_URL = authURL; // make it visible to global-setup

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  // fullyParallel: workers execute test files in parallel. Was previously
  // false + workers: 4 (contradictory — workers sat idle after the first
  // file). Safe to parallelize here: setup project runs once + writes
  // storageState.json; every browser test reads from that snapshot, so
  // tests never contend on login state. CI runs with 2 workers (GitHub
  // free-tier CPU allocation); local dev keeps 4.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  // Two retries so a flaky page (Next.js dev-server first-compile jitter)
  // doesn't fail the whole run. Real bugs still fail on all attempts.
  // Cold-compile of heavy detail routes can jitter 15-60s and sometimes
  // one retry isn't enough on cold cache.
  retries: 2,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Console errors surface as test failures via the check in tests/_helpers.
    actionTimeout: 8_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /global-setup\.ts/,
    },
    // Primary: Chromium runs the full suite on every CI invocation.
    // Fast, most-covered engine; catches 90% of regressions.
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "storageState.json",
      },
      dependencies: ["setup"],
    },
    // Firefox: subset of specs — critical flows + a11y + portal smoke.
    // Firefox-specific regressions (CSS Grid auto-fill differences,
    // event-ordering quirks) are rare but costly when they ship.
    // Run only this project: `--project=firefox`.
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        storageState: "storageState.json",
      },
      dependencies: ["setup"],
      // Expanded subset — covers user-visible behaviour, forms,
      // financial flows, accessibility, PDF, mobile, and the portal
      // checkout path. Still skips the exhaustive sidebar + dynamic-
      // routes smoke suites (Chromium catches those regressions).
      testMatch:
        /critical-flows\.spec\.ts|a11y\.spec\.ts|smoke-portal\.spec\.ts|form-submits\.spec\.ts|crm-pipeline\.spec\.ts|pdf-downloads\.spec\.ts|mobile-viewport\.spec\.ts|portal-checkout\.spec\.ts/,
    },
    // WebKit: same subset. WebKit is the only way to catch Safari-only
    // bugs (iOS Safari + macOS Safari share the engine). Date-input
    // behaviour, Intl.NumberFormat regional defaults, and `position:
    // sticky` quirks are the usual offenders.
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        storageState: "storageState.json",
      },
      dependencies: ["setup"],
      // Expanded subset — covers user-visible behaviour, forms,
      // financial flows, accessibility, PDF, mobile, and the portal
      // checkout path. Still skips the exhaustive sidebar + dynamic-
      // routes smoke suites (Chromium catches those regressions).
      testMatch:
        /critical-flows\.spec\.ts|a11y\.spec\.ts|smoke-portal\.spec\.ts|form-submits\.spec\.ts|crm-pipeline\.spec\.ts|pdf-downloads\.spec\.ts|mobile-viewport\.spec\.ts|portal-checkout\.spec\.ts/,
    },
  ],
});
