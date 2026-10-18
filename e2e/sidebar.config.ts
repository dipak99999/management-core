import { defineConfig, devices } from "@playwright/test";

// Standalone config for the sidebar-links smoke test. Skips the global-setup
// project (which targets the old port scheme 4101/3100-3107) and uses the
// current lean-dev setup (shell 4556, module apps 3001-3006, auth 4001).
export default defineConfig({
  testDir: "./tests",
  testMatch: /sidebar-links\.spec\.ts/,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-sidebar" }]],
  fullyParallel: true,
  workers: 3,
  retries: 1,
  use: {
    baseURL: "http://localhost:4556",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
